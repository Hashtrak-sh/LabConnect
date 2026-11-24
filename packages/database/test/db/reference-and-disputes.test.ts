import { beforeAll, describe, it } from 'vitest';
import { advanceTo, createBooking, createWorld, type World } from './fixtures.js';
import { expectPgError, insert, PG, rollback, update, useDatabase, uuid } from './helpers.js';

describe('organisations, labs and master data', () => {
  const { db } = useDatabase();
  let world: World;
  beforeAll(async () => {
    world = await createWorld(db());
  });
  const inTx = (body: () => Promise<void>) => () => rollback(db(), body);

  it(
    'C-26 C-27 require a segment for customers only, and a well-formed GSTIN unique per organisation type',
    inTx(async () => {
      const org = { legal_name: 'DEMO', display_name: 'DEMO', claim_status: 'NOT_APPLICABLE' };
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'organisation', { ...org, org_type: 'CUSTOMER' }),
      );
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'organisation', { ...org, org_type: 'LAB', customer_segment: 'BUSINESS' }),
      );
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'organisation', { ...org, org_type: 'LAB', gstin: '07ABCDE1234F1Z' }),
      );
      const gstin = '07ABCDE1234F1Z5';
      await insert(db(), 'organisation', { ...org, org_type: 'LAB', gstin });
      await expectPgError(db(), PG.unique, () =>
        insert(db(), 'organisation', { ...org, org_type: 'LAB', gstin }),
      );
      // the same legal entity may also be a customer
      await insert(db(), 'organisation', {
        ...org,
        org_type: 'CUSTOMER',
        customer_segment: 'INDUSTRY',
        gstin,
      });
    }),
  );

  it(
    'C-28 checks the IFSC format and allows one primary bank account per organisation or site',
    inTx(async () => {
      const account = {
        organisation_id: world.orgs.lab,
        account_holder_name: 'DEMO',
        account_number_ciphertext: Buffer.from('x'),
        account_number_last4: '0001',
        ifsc: 'ICIC0000001',
        is_primary: true,
      };
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'bank_account', { ...account, ifsc: 'ICIC1000001' }),
      );
      const first = await insert(db(), 'bank_account', account);
      // organisation-level accounts have no site: uniqueness must still hold
      await expectPgError(db(), PG.unique, () => insert(db(), 'bank_account', account));
      await insert(db(), 'bank_account', { ...account, lab_site_id: world.lab.site });
      await update(db(), 'bank_account', first, { retired_at: new Date() });
      await insert(db(), 'bank_account', account);
    }),
  );

  it(
    'C-59 C-60 de-duplicate active scope lines and check accreditation validity',
    inTx(async () => {
      const line = {
        organisation_id: world.orgs.lab,
        lab_site_id: world.lab.site,
        accreditation_id: world.lab.accreditation,
        discipline_node_id: world.nodes.discipline,
        parameter_node_id: world.nodes.parameter,
        site_type: 'PERMANENT',
        natural_key_hash: Buffer.from('hash-000001'),
      };
      await expectPgError(db(), PG.unique, () => insert(db(), 'scope_line', line));
      await insert(db(), 'scope_line', { ...line, status: 'INACTIVE' });
      await expectPgError(db(), PG.check, () =>
        update(db(), 'accreditation', world.lab.accreditation, { valid_to: '2025-12-31' }),
      );
      const duplicate = await db().query(
        'SELECT accreditation_body_id, standard_id FROM accreditation WHERE id = $1',
        [world.lab.accreditation],
      );
      await expectPgError(db(), PG.unique, () =>
        insert(db(), 'accreditation', {
          organisation_id: world.orgs.lab,
          lab_site_id: world.lab.site,
          accreditation_body_id: (duplicate.rows[0] as { accreditation_body_id: string })
            .accreditation_body_id,
          standard_id: (duplicate.rows[0] as { standard_id: string }).standard_id,
          lab_category: 'TESTING',
          certificate_no: 'TC-000001',
          valid_from: '2026-01-01',
          valid_to: '2027-01-01',
          status: 'VALID',
          status_as_of: '2026-11-01',
        }),
      );
    }),
  );

  it(
    'C-14 rejects a scope line under an accreditation of another site',
    inTx(async () => {
      await expectPgError(db(), PG.foreignKey, () =>
        update(db(), 'scope_line', world.lab.scopeLine, {
          accreditation_id: world.otherLab.accreditation,
        }),
      );
    }),
  );

  it(
    'C-61 keeps the two bookable flags of a lab site in step',
    inTx(async () => {
      await expectPgError(db(), PG.check, () =>
        update(db(), 'lab_site', world.lab.site, { is_bookable: true }),
      );
      await expectPgError(db(), PG.check, () =>
        update(db(), 'lab_site', world.lab.site, { listing_status: 'BOOKABLE' }),
      );
      await update(db(), 'lab_site', world.lab.site, {
        listing_status: 'BOOKABLE',
        is_bookable: true,
      });
    }),
  );

  it(
    'C-62 C-63 reject impossible or overlapping receiving hours, closures, templates and retention rules',
    inTx(async () => {
      const site = { organisation_id: world.orgs.lab, lab_site_id: world.lab.site };
      const hours = { ...site, weekday: 1, opens_at: '09:00', closes_at: '13:00' };
      await insert(db(), 'receiving_hours', hours);
      await expectPgError(db(), PG.exclusion, () =>
        insert(db(), 'receiving_hours', { ...hours, opens_at: '12:00', closes_at: '17:00' }),
      );
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'receiving_hours', {
          ...hours,
          weekday: 2,
          opens_at: '17:00',
          closes_at: '09:00',
        }),
      );
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'receiving_hours', { ...hours, weekday: 8 }),
      );
      // a split shift on the same day, and the same hours on another day, are fine
      await insert(db(), 'receiving_hours', { ...hours, opens_at: '14:00', closes_at: '17:00' });
      await insert(db(), 'receiving_hours', { ...hours, weekday: 2 });

      await expectPgError(db(), PG.check, () =>
        insert(db(), 'site_closure', {
          ...site,
          starts_on: '2026-12-25',
          ends_on: '2026-12-24',
          reason: 'x',
        }),
      );
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'slot_template', {
          ...site,
          weekday: 1,
          start_time: '10:00',
          end_time: '09:00',
          capacity: 5,
        }),
      );
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'slot_template', {
          ...site,
          weekday: 1,
          start_time: '09:00',
          end_time: '10:00',
          capacity: 0,
        }),
      );
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'retention_rule', { ...site, retention_days: 0 }),
      );
    }),
  );

  it(
    'C-64 allows one pending claim per lab organisation',
    inTx(async () => {
      const claim = {
        organisation_id: world.orgs.lab,
        lab_site_id: world.lab.site,
        requested_by_user_id: world.users.checker,
        method: 'EMAIL_OTP',
        status: 'PENDING_OTP',
      };
      const first = await insert(db(), 'lab_claim_request', claim);
      await expectPgError(db(), PG.unique, () =>
        insert(db(), 'lab_claim_request', { ...claim, method: 'MANUAL', status: 'PENDING_REVIEW' }),
      );
      await update(db(), 'lab_claim_request', first, { status: 'EXPIRED' });
      await insert(db(), 'lab_claim_request', claim);
    }),
  );

  it(
    'C-75 requires an approver for an approved change set and a time for a published one',
    inTx(async () => {
      await expectPgError(db(), PG.check, () =>
        update(db(), 'md_change_set', world.changeSet, { status: 'APPROVED' }),
      );
      const approval = { approved_by_user_id: world.users.admin, approved_at: new Date() };
      await expectPgError(db(), PG.check, () =>
        update(db(), 'md_change_set', world.changeSet, { ...approval, status: 'PUBLISHED' }),
      );
      await update(db(), 'md_change_set', world.changeSet, {
        ...approval,
        status: 'PUBLISHED',
        published_at: new Date(),
      });
    }),
  );

  it(
    'C-76 keeps the taxonomy tree coherent and fills the path',
    inTx(async () => {
      const node = { taxonomy_id: world.taxonomies.scope, name: 'x' };
      // a PARAMETER directly under a DISCIPLINE skips two levels
      await expectPgError(db(), PG.rule, () =>
        insert(db(), 'md_node', {
          ...node,
          node_type_id: world.nodeTypes.parameter,
          parent_id: world.nodes.discipline,
          code: 'SKIP',
        }),
      );
      // a parent from another taxonomy
      await expectPgError(db(), PG.rule, () =>
        insert(db(), 'md_node', {
          ...node,
          node_type_id: world.nodeTypes.group,
          parent_id: world.nodes.unit,
          code: 'CROSS',
        }),
      );
      await expectPgError(db(), PG.unique, () =>
        insert(db(), 'md_node', {
          ...node,
          node_type_id: world.nodeTypes.discipline,
          code: 'CHEMICAL',
        }),
      );
      await expectPgError(db(), PG.check, () =>
        update(db(), 'md_node', world.nodes.parameter, {
          effective_from: '2026-06-01',
          effective_to: '2026-01-01',
        }),
      );
      // a node with children cannot be moved
      await expectPgError(db(), PG.rule, () =>
        update(db(), 'md_node', world.nodes.group, { parent_id: null }),
      );

      const depth = await db().query<{ depth: number; under: boolean }>(
        `SELECT nlevel(p.path) AS depth, p.path <@ d.path AS under FROM md_node p, md_node d WHERE p.id = $1 AND d.id = $2`,
        [world.nodes.parameter, world.nodes.discipline],
      );
      if (depth.rows[0]?.depth !== 4 || !depth.rows[0].under)
        throw new Error(`unexpected path: ${JSON.stringify(depth.rows[0])}`);
    }),
  );

  it(
    'C-77 rejects a reason code or scope node taken from the wrong list',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      // a unit is not a cancellation reason
      await expectPgError(db(), PG.rule, () =>
        update(db(), 'booking', booking.id, { cancellation_code_node_id: world.nodes.unit }),
      );
      // a rejection reason is not a cancellation reason either
      await expectPgError(db(), PG.rule, () =>
        update(db(), 'booking', booking.id, {
          cancellation_code_node_id: world.nodes.rejectReason,
        }),
      );
      await update(db(), 'booking', booking.id, {
        cancellation_code_node_id: world.nodes.cancelReason,
      });
      // scope_line.parameter_node_id must be a PARAMETER, not a PRODUCT
      await expectPgError(db(), PG.rule, () =>
        update(db(), 'scope_line', world.lab.scopeLine, { parameter_node_id: world.nodes.product }),
      );
      await expectPgError(db(), PG.rule, () =>
        update(db(), 'scope_line', world.lab.scopeLine, {
          range_unit_node_id: world.nodes.condition,
        }),
      );
      await update(db(), 'scope_line', world.lab.scopeLine, {
        range_unit_node_id: world.nodes.unit,
        product_node_id: world.nodes.product,
      });
    }),
  );

  it(
    'C-78 treats "no region", "no discipline" and "no actor" as values when checking uniqueness',
    inTx(async () => {
      const holiday = { holiday_date: '2026-01-26', name: 'Republic Day' };
      await insert(db(), 'holiday_calendar', holiday);
      await expectPgError(db(), PG.unique, () => insert(db(), 'holiday_calendar', holiday));
      await insert(db(), 'holiday_calendar', { ...holiday, region_code: 'DL' });

      const rule = {
        organisation_id: world.orgs.lab,
        lab_site_id: world.lab.site,
        retention_days: 30,
      };
      await insert(db(), 'retention_rule', rule);
      await expectPgError(db(), PG.unique, () => insert(db(), 'retention_rule', rule));
      await insert(db(), 'retention_rule', { ...rule, discipline_node_id: world.nodes.discipline });

      const slot = {
        organisation_id: world.orgs.lab,
        lab_site_id: world.lab.site,
        slot_date: '2026-12-02',
        starts_at: '2026-12-02T04:00:00Z',
        ends_at: '2026-12-02T06:00:00Z',
        capacity: 1,
      };
      await insert(db(), 'slot', slot);
      await expectPgError(db(), PG.unique, () => insert(db(), 'slot', slot));

      const record = {
        idempotency_key: 'key-1',
        route: 'POST /v1/leads',
        request_hash: Buffer.from('h'),
        status: 'COMPLETED',
        expires_at: new Date(Date.now() + 86_400_000),
      };
      await insert(db(), 'idempotency_record', record);
      await expectPgError(db(), PG.unique, () => insert(db(), 'idempotency_record', record));

      const setting = {
        key: 'k',
        scope_type: 'GLOBAL',
        value: 1,
        change_reason: 'x',
        effective_from: '2027-01-01',
        effective_to: '2027-02-01',
      };
      await insert(db(), 'config_parameter', setting);
      await expectPgError(db(), PG.unique, () => insert(db(), 'config_parameter', setting));
    }),
  );

  it(
    'C-79 C-80 limit OTP attempts and keep one audit chain per month',
    inTx(async () => {
      const otp = {
        channel: 'EMAIL',
        destination_hash: Buffer.from('d'),
        purpose: 'LOGIN',
        code_hash: Buffer.from('c'),
        expires_at: new Date(Date.now() + 600_000),
      };
      const challenge = await insert(db(), 'otp_challenge', otp);
      await update(db(), 'otp_challenge', challenge, { attempts: 5 });
      await expectPgError(db(), PG.check, () =>
        update(db(), 'otp_challenge', challenge, { attempts: 6 }),
      );

      const link = {
        chain_month: '2026-11-01',
        seq: 1,
        audit_log_id: uuid(),
        audit_occurred_at: new Date(),
        hash: Buffer.from('h1'),
      };
      await insert(db(), 'audit_log_chain', link);
      await expectPgError(db(), PG.unique, () =>
        insert(db(), 'audit_log_chain', { ...link, audit_log_id: uuid() }),
      );
      await expectPgError(db(), PG.unique, () =>
        insert(db(), 'audit_log_chain', { ...link, seq: 2 }),
      );
      await insert(db(), 'audit_log_chain', {
        ...link,
        seq: 2,
        audit_log_id: uuid(),
        prev_hash: Buffer.from('h1'),
      });
    }),
  );
});

describe('disputes and ratings', () => {
  const { db } = useDatabase();
  let world: World;
  beforeAll(async () => {
    world = await createWorld(db());
  });
  const inTx = (body: () => Promise<void>) => () => rollback(db(), body);

  const openDispute = async (no: string) => {
    const booking = await createBooking(db(), world);
    await advanceTo(db(), booking.id, 'REPORT_RELEASED');
    const dispute = {
      ...booking.keys,
      dispute_no: no,
      type_node_id: world.nodes.disputeType,
      raised_by_user_id: world.users.customerAdmin,
      raised_by_party: 'CUSTOMER',
      description: 'Result looks wrong',
    };
    return { booking, dispute, id: await insert(db(), 'dispute', dispute) };
  };

  it(
    'C-72 allows one open dispute per booking and requires the decision fields',
    inTx(async () => {
      const { dispute, id } = await openDispute('D-0001');
      await expectPgError(db(), PG.unique, () =>
        insert(db(), 'dispute', { ...dispute, dispute_no: 'D-0002' }),
      );
      await expectPgError(db(), PG.unique, () => insert(db(), 'dispute', dispute));
      await update(db(), 'dispute', id, { status: 'AWAITING_LAB' });
      await expectPgError(db(), PG.unique, () =>
        insert(db(), 'dispute', { ...dispute, dispute_no: 'D-0002' }),
      );
      await expectPgError(db(), PG.check, () => update(db(), 'dispute', id, { status: 'DECIDED' }));
      await expectPgError(db(), PG.check, () =>
        update(db(), 'dispute', id, { status: 'DECIDED', decided_at: new Date() }),
      );
      await expectPgError(db(), PG.check, () =>
        update(db(), 'dispute', id, { refund_amount_paise: -1 }),
      );
      // withdrawn: the booking can be disputed again
      await update(db(), 'dispute', id, { status: 'WITHDRAWN' });
      await insert(db(), 'dispute', { ...dispute, dispute_no: 'D-0002' });
    }),
  );

  it(
    'C-73 freezes a decided dispute: it can only be closed',
    inTx(async () => {
      const { id } = await openDispute('D-0003');
      await update(db(), 'dispute', id, {
        status: 'DECIDED',
        decided_at: new Date(),
        outcome: 'NO_ACTION',
        decision_rationale: 'Report is consistent',
        decided_by_user_id: world.users.ops,
      });
      await expectPgError(db(), PG.frozen, () =>
        update(db(), 'dispute', id, { outcome: 'FULL_REFUND' }),
      );
      await expectPgError(db(), PG.frozen, () => update(db(), 'dispute', id, { status: 'OPEN' }));
      await update(db(), 'dispute', id, { status: 'CLOSED' });
    }),
  );

  it(
    'C-74 limits scores to 1–5, one rating per direction, and keeps lab-to-customer ratings private',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const rating = {
        ...booking.keys,
        direction: 'CUSTOMER_TO_LAB',
        rated_by_user_id: world.users.customerAdmin,
        score_overall: 5,
        is_public: true,
      };
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'rating', { ...rating, score_overall: 6 }),
      );
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'rating', { ...rating, score_tat: 0 }),
      );
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'rating', { ...rating, direction: 'LAB_TO_CUSTOMER' }),
      );
      await insert(db(), 'rating', rating);
      await expectPgError(db(), PG.unique, () => insert(db(), 'rating', rating));
      await insert(db(), 'rating', {
        ...rating,
        direction: 'LAB_TO_CUSTOMER',
        is_public: false,
        rated_by_user_id: world.users.checker,
      });
    }),
  );
});
