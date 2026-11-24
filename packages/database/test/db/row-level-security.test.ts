import { beforeAll, describe, expect, it } from 'vitest';
import { advanceTo, type Booking, createBooking, createWorld, type World } from './fixtures.js';
import {
  count,
  type Db,
  expectPgError,
  insert,
  PG,
  rollback,
  setLocal,
  update,
  useDatabase,
  uuid,
} from './helpers.js';

interface Actor {
  org?: string;
  user?: string;
  platform?: boolean;
  system?: boolean;
  role?: 'app_rw' | 'app_worker';
}

/** Becomes an application role with the session settings the API or worker would set. */
async function actAs(db: Db, actor: Actor): Promise<void> {
  await db.query(`SET LOCAL ROLE ${actor.role ?? 'app_rw'}`);
  if (actor.org) await setLocal(db, 'app.org_id', actor.org);
  if (actor.user) await setLocal(db, 'app.user_id', actor.user);
  if (actor.platform) await setLocal(db, 'app.is_platform', 'true');
  if (actor.system) await setLocal(db, 'app.is_system', 'true');
}

const trf = (booking: Booking, user: string) => ({
  ...booking.keys,
  version_no: 1,
  schema_version: 'trf.v1',
  form: { item: 'DEMO' },
  conformity_required: false,
  submitted_by_user_id: user,
});

describe('row-level security (C-38, C-39: the tenant keys the policies rely on)', () => {
  const { db } = useDatabase();
  let world: World;
  let a: Booking; // customer one  ↔ lab one
  let b: Booking; // customer two  ↔ lab two
  let draftList: string;
  let draftItem: string;

  beforeAll(async () => {
    const client = db();
    await client.query('BEGIN');
    world = await createWorld(client);
    a = await createBooking(client, world);
    b = await createBooking(client, world, {
      customerOrg: world.orgs.otherCustomer,
      lab: world.otherLab,
    });
    await insert(client, 'trf', trf(a, world.users.customerAdmin));
    await insert(client, 'trf', trf(b, world.users.otherCustomerAdmin));

    draftList = await insert(client, 'price_list', {
      organisation_id: world.orgs.lab,
      lab_site_id: world.lab.site,
      version_no: 2,
    });
    draftItem = await insert(client, 'price_item', {
      organisation_id: world.orgs.lab,
      price_list_id: draftList,
      scope_line_id: world.lab.scopeLine,
      price_paise: 90_000,
      sample_qty: 1,
      sample_unit_node_id: world.nodes.unit,
      tat_days: 4,
    });

    await advanceTo(client, a.id, 'REPORT_RELEASED');
    const dispute = await insert(client, 'dispute', {
      ...a.keys,
      dispute_no: 'D-1001',
      type_node_id: world.nodes.disputeType,
      raised_by_user_id: world.users.customerAdmin,
      raised_by_party: 'CUSTOMER',
      description: 'DEMO',
    });
    const message = {
      customer_org_id: a.customerOrg,
      lab_org_id: a.labOrg,
      dispute_id: dispute,
      author_user_id: world.users.ops,
      author_party: 'PLATFORM',
      body: 'DEMO',
    };
    await insert(client, 'dispute_message', { ...message, visibility: 'ALL' });
    await insert(client, 'dispute_message', { ...message, visibility: 'PLATFORM_ONLY' });
    await insert(client, 'rating', {
      ...a.keys,
      direction: 'CUSTOMER_TO_LAB',
      rated_by_user_id: world.users.customerAdmin,
      score_overall: 4,
      is_public: true,
    });
    await insert(client, 'rating', {
      ...a.keys,
      direction: 'LAB_TO_CUSTOMER',
      rated_by_user_id: world.users.checker,
      score_overall: 2,
      is_public: false,
    });
    await insert(client, 'organisation_private', {
      organisation_id: world.orgs.customer,
      pan_last4: '123A',
      trust_flags: { no_pay_count: 2 },
    });
    await insert(client, 'organisation_private', {
      organisation_id: world.orgs.lab,
      pan_last4: '456B',
    });
    await client.query('COMMIT');
  });
  const inTx = (body: () => Promise<void>) => () => rollback(db(), body);
  const visible = (table: string) => count(db(), `SELECT 1 FROM ${table}`);
  const ids = async (table: string) =>
    (await db().query<{ id: string }>(`SELECT id FROM ${table}`)).rows.map((row) => row.id);

  it(
    'shows each party only the bookings it is part of, and their children',
    inTx(async () => {
      await actAs(db(), { org: world.orgs.customer, user: world.users.customerAdmin });
      expect(await ids('booking')).toEqual([a.id]);
      expect(await visible('trf')).toBe(1);
      expect(await visible('booking_line')).toBe(1);
      await db().query('RESET ROLE');

      await actAs(db(), { org: world.orgs.otherLab, user: world.users.otherChecker });
      expect(await ids('booking')).toEqual([b.id]);
      expect(await visible('booking_line')).toBe(1);
      expect(await visible('dispute')).toBe(0);
    }),
  );

  it(
    'shows nothing when the settings are missing or empty, without raising an error',
    inTx(async () => {
      await db().query('SET LOCAL ROLE app_rw');
      expect(await visible('booking')).toBe(0);
      // a pooled connection that carried settings before returns '' for them
      await setLocal(db(), 'app.org_id', '');
      await setLocal(db(), 'app.user_id', '');
      await setLocal(db(), 'app.is_platform', '');
      expect(await visible('booking')).toBe(0);
      expect(await visible('trf')).toBe(0);
      expect(await visible('app_user')).toBe(0);
    }),
  );

  it(
    'shows everything to platform staff and to system jobs, and keeps the two apart',
    inTx(async () => {
      await actAs(db(), { platform: true, user: world.users.ops, org: world.orgs.platform });
      expect((await ids('booking')).sort()).toEqual([a.id, b.id].sort());
      // platform staff are not a system job: they cannot read the timer queue
      await insert(db(), 'timer', {
        timer_type: 'PAYMENT_DUE',
        aggregate_type: 'booking',
        aggregate_id: a.id,
        due_at: new Date(),
      });
      expect(await visible('timer')).toBe(0);
      await db().query('RESET ROLE');

      await actAs(db(), { role: 'app_worker', system: true });
      expect(await visible('booking')).toBe(2);
      expect(await visible('timer')).toBe(1);
    }),
  );

  it(
    'stops a tenant writing into another tenant’s booking',
    inTx(async () => {
      await actAs(db(), { org: world.orgs.customer, user: world.users.customerAdmin });
      // with the other booking's own keys: refused by the policy
      await expectPgError(db(), PG.privilege, () =>
        insert(db(), 'trf', { ...trf(b, world.users.customerAdmin), version_no: 2 }),
      );
      // with its own organisation swapped in: refused by the tenant-key foreign key
      await expectPgError(db(), PG.foreignKey, () =>
        insert(db(), 'trf', {
          ...trf(b, world.users.customerAdmin),
          version_no: 2,
          customer_org_id: world.orgs.customer,
        }),
      );
      // updates simply find no row
      const result = await db().query(`UPDATE booking SET item_name = 'hijacked' WHERE id = $1`, [
        b.id,
      ]);
      expect(result.rowCount).toBe(0);
      // and it cannot re-home its own booking to another customer
      await expectPgError(db(), PG.privilege, () =>
        update(db(), 'booking', a.id, { customer_org_id: world.orgs.otherCustomer }),
      );
    }),
  );

  it(
    'keeps a price-list draft private to its lab while published lists stay public',
    inTx(async () => {
      await actAs(db(), { org: world.orgs.otherLab, user: world.users.otherChecker });
      const lists = await ids('price_list');
      expect(lists).not.toContain(draftList);
      expect(lists).toContain(world.lab.priceList);
      const items = await ids('price_item');
      expect(items).not.toContain(draftItem);
      expect(items).toContain(world.lab.priceItem);
      await db().query('RESET ROLE');

      // an anonymous visitor sees published prices only
      await db().query('SET LOCAL ROLE app_rw');
      expect((await ids('price_list')).sort()).toEqual(
        [world.lab.priceList, world.otherLab.priceList].sort(),
      );
      await db().query('RESET ROLE');

      await actAs(db(), { org: world.orgs.lab, user: world.users.checker });
      expect(await ids('price_list')).toContain(draftList);
      expect(await ids('price_item')).toContain(draftItem);
    }),
  );

  it(
    'hides platform-only dispute messages and lab-to-customer ratings from the parties (E-05)',
    inTx(async () => {
      await actAs(db(), { org: world.orgs.customer, user: world.users.customerAdmin });
      expect(await count(db(), 'SELECT 1 FROM dispute_message')).toBe(1);
      expect(await count(db(), `SELECT 1 FROM rating WHERE direction = 'LAB_TO_CUSTOMER'`)).toBe(0);
      expect(await visible('rating')).toBe(1);
      await db().query('RESET ROLE');

      await actAs(db(), { org: world.orgs.lab, user: world.users.checker });
      expect(await count(db(), 'SELECT 1 FROM dispute_message')).toBe(1);
      expect(await visible('rating')).toBe(2);
      await db().query('RESET ROLE');

      await actAs(db(), { platform: true, user: world.users.ops });
      expect(await count(db(), 'SELECT 1 FROM dispute_message')).toBe(2);
    }),
  );

  it(
    'keeps private organisation data and other organisations’ users out of reach (E-04)',
    inTx(async () => {
      await actAs(db(), { org: world.orgs.lab, user: world.users.checker });
      // the counterparty's name is public, its PAN and trust flags are not
      expect(
        await count(db(), 'SELECT 1 FROM organisation WHERE id = $1', [world.orgs.customer]),
      ).toBe(1);
      const privateRows = await db().query<{ organisation_id: string }>(
        'SELECT organisation_id FROM organisation_private',
      );
      expect(privateRows.rows.map((row) => row.organisation_id)).toEqual([world.orgs.lab]);
      // it sees its own colleagues, not the customer's users
      const emails = (
        await db().query<{ email: string }>('SELECT email FROM app_user ORDER BY 1')
      ).rows.map((row) => row.email);
      expect(emails).toEqual(['checker@example.test', 'maker@example.test']);
    }),
  );

  it(
    'lets any request write an audit row while only the platform reads the log',
    inTx(async () => {
      await actAs(db(), { org: world.orgs.customer, user: world.users.customerAdmin });
      await db().query(
        `INSERT INTO audit_log (id, occurred_at, actor_user_id, actor_org_id, action, entity_type, entity_id) VALUES ($1, now(), $2, $3, 'booking.view', 'booking', $4)`,
        [uuid(), world.users.customerAdmin, world.orgs.customer, a.id],
      );
      expect(await visible('audit_log')).toBe(0);
      await db().query('RESET ROLE');
      await actAs(db(), { platform: true, user: world.users.ops });
      expect(await visible('audit_log')).toBe(1);
    }),
  );

  it(
    'shows a lab its own master-data proposals and nobody else’s (E-09)',
    inTx(async () => {
      const proposal = await insert(db(), 'md_change_set', {
        title: 'Pin correction',
        source: 'LAB_PROPOSAL',
        prepared_by_user_id: world.users.checker,
        proposed_by_org_id: world.orgs.lab,
      });
      await insert(db(), 'md_change_item', {
        change_set_id: proposal,
        target_type: 'LAB_SITE',
        target_id: world.lab.site,
        operation: 'UPDATE',
        proposed: {},
        validation_status: 'VALID',
      });
      await actAs(db(), { org: world.orgs.lab, user: world.users.checker });
      expect(await ids('md_change_set')).toEqual([proposal]);
      expect(await visible('md_change_item')).toBe(1);
      await db().query('RESET ROLE');
      await actAs(db(), { org: world.orgs.otherLab, user: world.users.otherChecker });
      expect(await visible('md_change_set')).toBe(0);
      expect(await visible('md_change_item')).toBe(0);
    }),
  );

  it(
    'shows a file to its owner and to the parties of its booking only (E-07)',
    inTx(async () => {
      const file = {
        bucket: 'demo',
        declared_content_type: 'application/pdf',
        size_bytes: 1,
        retention_class: 'REPORT',
      };
      const report = await insert(db(), 'file_object', {
        ...file,
        object_key: 'report.pdf',
        purpose: 'REPORT_ORIGINAL',
        owner_org_id: a.labOrg,
        customer_org_id: a.customerOrg,
        lab_org_id: a.labOrg,
      });
      const kyc = await insert(db(), 'file_object', {
        ...file,
        object_key: 'kyc.pdf',
        purpose: 'KYC_DOCUMENT',
        owner_org_id: a.labOrg,
      });
      await actAs(db(), { org: world.orgs.customer, user: world.users.customerAdmin });
      expect(await ids('file_object')).toEqual([report]);
      await db().query('RESET ROLE');
      await actAs(db(), { org: world.orgs.lab, user: world.users.checker });
      expect((await ids('file_object')).sort()).toEqual([report, kyc].sort());
      await db().query('RESET ROLE');
      await actAs(db(), { org: world.orgs.otherCustomer, user: world.users.otherCustomerAdmin });
      expect(await visible('file_object')).toBe(0);
    }),
  );
});
