import { beforeAll, describe, it } from 'vitest';
import {
  createBooking,
  createPackage,
  createReceipt,
  createReport,
  createReportVersion,
  createWorld,
  type World,
} from './fixtures.js';
import { expectPgError, insert, PG, rollback, update, useDatabase, uuid } from './helpers.js';

describe('separation of duties and roles', () => {
  const { db } = useDatabase();
  let world: World;
  beforeAll(async () => {
    world = await createWorld(db());
  });
  const inTx = (body: () => Promise<void>) => () => rollback(db(), body);

  it(
    'C-01 rejects a receipt approved by its own maker',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const receipt = await createReceipt(db(), world, booking);
      const decision = { decision: 'APPROVED', decided_at: new Date(), lab_sample_id: 'S-1' };
      await expectPgError(db(), PG.check, () =>
        update(db(), 'receipt_record', receipt, {
          ...decision,
          checker_user_id: world.users.maker,
        }),
      );
      await update(db(), 'receipt_record', receipt, {
        ...decision,
        checker_user_id: world.users.checker,
      });
    }),
  );

  it(
    'C-02 rejects a report version whose checker is its maker',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const report = await createReport(db(), world, booking);
      const version = await createReportVersion(db(), world, booking, report);
      await expectPgError(db(), PG.check, () =>
        update(db(), 'report_version', version, { checker_user_id: world.users.maker }),
      );
      await update(db(), 'report_version', version, { checker_user_id: world.users.checker });
    }),
  );

  it(
    'C-03 rejects a label reprint approved by the person who printed it',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const print = {
        ...booking.keys,
        label_version: 2,
        printed_by_user_id: world.users.maker,
        printed_by_party: 'LAB',
        is_reprint: true,
      };
      await expectPgError(db(), PG.check, () =>
        insert(db(), 'label_print', { ...print, approved_by_user_id: world.users.maker }),
      );
      await insert(db(), 'label_print', { ...print, approved_by_user_id: world.users.checker });
    }),
  );

  it(
    'C-04 rejects a change set approved by the user who prepared it',
    inTx(async () => {
      await expectPgError(db(), PG.check, () =>
        update(db(), 'md_change_set', world.changeSet, { approved_by_user_id: world.users.ops }),
      );
      await update(db(), 'md_change_set', world.changeSet, {
        approved_by_user_id: world.users.admin,
      });
    }),
  );

  it(
    'C-05 C-33 allow one lab role per membership and no duplicate active role',
    inTx(async () => {
      // the maker already holds LAB_MAKER
      await expectPgError(db(), PG.unique, () =>
        insert(db(), 'membership_role', {
          membership_id: world.memberships.maker,
          role: 'LAB_CHECKER',
        }),
      );
      await expectPgError(db(), PG.unique, () =>
        insert(db(), 'membership_role', {
          membership_id: world.memberships.customerAdmin,
          role: 'CUSTOMER_ADMIN',
        }),
      );
      // a customer may hold several customer roles (RR-1)
      await insert(db(), 'membership_role', {
        membership_id: world.memberships.customerAdmin,
        role: 'CUSTOMER_FINANCE',
      });
      // after the lab role is revoked, the other one can be granted (RR-2)
      await db().query('UPDATE membership_role SET revoked_at = now() WHERE membership_id = $1', [
        world.memberships.maker,
      ]);
      await insert(db(), 'membership_role', {
        membership_id: world.memberships.maker,
        role: 'LAB_CHECKER',
      });
    }),
  );

  it(
    'C-06 rejects a role that does not belong to the organisation type',
    inTx(async () => {
      await expectPgError(db(), PG.rule, () =>
        insert(db(), 'membership_role', {
          membership_id: world.memberships.maker,
          role: 'CUSTOMER_ADMIN',
        }),
      );
      await expectPgError(db(), PG.rule, () =>
        insert(db(), 'membership_role', {
          membership_id: world.memberships.customerAdmin,
          role: 'PLATFORM_OPS',
        }),
      );
    }),
  );

  it(
    'C-07 C-34 limit site assignments to sites of the same lab, once each',
    inTx(async () => {
      await expectPgError(db(), PG.rule, () =>
        insert(db(), 'membership_site', {
          membership_id: world.memberships.maker,
          lab_site_id: world.otherLab.site,
        }),
      );
      await insert(db(), 'membership_site', {
        membership_id: world.memberships.maker,
        lab_site_id: world.lab.site,
      });
      await expectPgError(db(), PG.unique, () =>
        insert(db(), 'membership_site', {
          membership_id: world.memberships.maker,
          lab_site_id: world.lab.site,
        }),
      );
    }),
  );

  it(
    'C-31 keeps platform staff out of lab and customer organisations, and everyone else out of the platform (RR-5)',
    inTx(async () => {
      await expectPgError(db(), PG.rule, () =>
        insert(db(), 'membership', {
          user_id: world.users.ops,
          organisation_id: world.orgs.lab,
          status: 'ACTIVE',
        }),
      );
      await expectPgError(db(), PG.rule, () =>
        insert(db(), 'membership', {
          user_id: world.users.maker,
          organisation_id: world.orgs.platform,
          status: 'ACTIVE',
        }),
      );
      // a consultant may belong to two labs (RR-4)
      await insert(db(), 'membership', {
        user_id: world.users.maker,
        organisation_id: world.orgs.otherLab,
        status: 'ACTIVE',
      });
    }),
  );

  it(
    'C-32 C-57 require a second person for break-glass, and tie every break-glass access to a grant',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const report = await createReport(db(), world, booking);
      const version = await createReportVersion(db(), world, booking, report);
      const keys = {
        customer_org_id: booking.customerOrg,
        lab_org_id: booking.labOrg,
        report_version_id: version,
      };
      const grant = await insert(db(), 'break_glass_grant', {
        ...keys,
        requested_by_user_id: world.users.ops,
        reason: 'Dispute investigation',
      });
      const approval = { approved_at: new Date(), expires_at: new Date(Date.now() + 3_600_000) };
      await expectPgError(db(), PG.check, () =>
        update(db(), 'break_glass_grant', grant, {
          ...approval,
          approved_by_user_id: world.users.ops,
        }),
      );
      await expectPgError(db(), PG.check, () =>
        update(db(), 'break_glass_grant', grant, { approved_by_user_id: world.users.admin }),
      );
      await update(db(), 'break_glass_grant', grant, {
        ...approval,
        approved_by_user_id: world.users.admin,
      });

      await expectPgError(db(), PG.check, () =>
        insert(db(), 'report_access_log', {
          ...keys,
          access_type: 'BREAK_GLASS',
          accessor_user_id: world.users.ops,
        }),
      );
      await insert(db(), 'report_access_log', {
        ...keys,
        access_type: 'BREAK_GLASS',
        accessor_user_id: world.users.ops,
        grant_id: grant,
      });
    }),
  );

  it(
    'C-35 allows one active MFA factor per user',
    inTx(async () => {
      const factor = {
        user_id: world.users.checker,
        factor_type: 'TOTP',
        secret_ciphertext: Buffer.from('x'),
        verified_at: new Date(),
      };
      await insert(db(), 'mfa_factor', factor);
      await expectPgError(db(), PG.unique, () => insert(db(), 'mfa_factor', factor));
    }),
  );

  it(
    'C-36 stops a session from activating another user’s membership',
    inTx(async () => {
      const session = {
        user_id: world.users.maker,
        refresh_token_hash: Buffer.from(uuid()),
        token_family_id: uuid(),
        expires_at: new Date(Date.now() + 3_600_000),
      };
      await expectPgError(db(), PG.foreignKey, () =>
        insert(db(), 'user_session', {
          ...session,
          active_membership_id: world.memberships.checker,
        }),
      );
      await insert(db(), 'user_session', {
        ...session,
        active_membership_id: world.memberships.maker,
      });
    }),
  );

  it(
    'C-37 limits invitation sites to the inviting lab',
    inTx(async () => {
      const invitation = await insert(db(), 'invitation', {
        organisation_id: world.orgs.lab,
        email: 'new.maker@example.test',
        roles: '{LAB_MAKER}',
        token_hash: Buffer.from(uuid()),
        expires_at: new Date(Date.now() + 86_400_000),
      });
      await expectPgError(db(), PG.rule, () =>
        insert(db(), 'invitation_site', {
          invitation_id: invitation,
          lab_site_id: world.otherLab.site,
        }),
      );
      await insert(db(), 'invitation_site', {
        invitation_id: invitation,
        lab_site_id: world.lab.site,
      });
    }),
  );
});

describe('tenant keys are guaranteed by foreign keys', () => {
  const { db } = useDatabase();
  let world: World;
  beforeAll(async () => {
    world = await createWorld(db());
  });
  const inTx = (body: () => Promise<void>) => () => rollback(db(), body);

  it(
    'C-08 rejects a booking whose lab_org_id is not the organisation of its lab site',
    inTx(async () => {
      await expectPgError(db(), PG.foreignKey, () =>
        createBooking(db(), world, { overrides: { lab_org_id: world.orgs.otherLab } }),
      );
    }),
  );

  it(
    'C-38 rejects a child row whose tenant keys differ from its booking',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const trf = {
        version_no: 1,
        schema_version: 'trf.v1',
        form: {},
        conformity_required: false,
        submitted_by_user_id: world.users.customerAdmin,
      };
      await expectPgError(db(), PG.foreignKey, () =>
        insert(db(), 'trf', { ...booking.keys, ...trf, customer_org_id: world.orgs.otherCustomer }),
      );
      await expectPgError(db(), PG.foreignKey, () =>
        insert(db(), 'trf', { ...booking.keys, ...trf, lab_org_id: world.orgs.otherLab }),
      );
      await insert(db(), 'trf', { ...booking.keys, ...trf });
      // a grandchild is tied to its parent in the same way
      const packageId = await createPackage(db(), world, booking);
      const event = await insert(db(), 'custody_event', {
        ...booking.keys,
        package_id: packageId,
        event_type: 'SCAN_ACCEPTED',
      });
      const file = await insert(db(), 'file_object', {
        purpose: 'RECEIPT_PHOTO',
        bucket: 'demo',
        object_key: uuid(),
        declared_content_type: 'image/jpeg',
        size_bytes: 1,
        retention_class: 'CUSTODY',
      });
      const photo = { custody_event_id: event, file_id: file, sha256: Buffer.from('p') };
      await expectPgError(db(), PG.foreignKey, () =>
        insert(db(), 'custody_event_photo', {
          ...photo,
          customer_org_id: world.orgs.otherCustomer,
          lab_org_id: booking.labOrg,
        }),
      );
      await insert(db(), 'custody_event_photo', {
        ...photo,
        customer_org_id: booking.customerOrg,
        lab_org_id: booking.labOrg,
      });
    }),
  );

  it(
    'C-39 rejects a lab-owned row whose organisation is not the owner of its site',
    inTx(async () => {
      const hours = {
        lab_site_id: world.lab.site,
        weekday: 1,
        opens_at: '09:00',
        closes_at: '17:00',
      };
      await expectPgError(db(), PG.foreignKey, () =>
        insert(db(), 'receiving_hours', { ...hours, organisation_id: world.orgs.otherLab }),
      );
      await insert(db(), 'receiving_hours', { ...hours, organisation_id: world.orgs.lab });
    }),
  );

  it(
    'C-40 keeps a booking’s price list, slot and billing site inside the right site and customer',
    inTx(async () => {
      await expectPgError(db(), PG.foreignKey, () =>
        createBooking(db(), world, { overrides: { price_list_id: world.otherLab.priceList } }),
      );
      const otherCustomersSite = await insert(db(), 'customer_site', {
        organisation_id: world.orgs.otherCustomer,
        name: 'DEMO plant',
        address: {},
        pincode: '110002',
        state_code: 'DL',
      });
      await expectPgError(db(), PG.foreignKey, () =>
        createBooking(db(), world, { overrides: { customer_site_id: otherCustomersSite } }),
      );
      const otherLabsSlot = await insert(db(), 'slot', {
        organisation_id: world.orgs.otherLab,
        lab_site_id: world.otherLab.site,
        slot_date: '2026-12-01',
        starts_at: '2026-12-01T04:00:00Z',
        ends_at: '2026-12-01T06:00:00Z',
        capacity: 5,
      });
      await expectPgError(db(), PG.foreignKey, () =>
        createBooking(db(), world, { overrides: { slot_id: otherLabsSlot } }),
      );
    }),
  );

  it(
    'C-41 rejects a payout into another lab’s bank account',
    inTx(async () => {
      const account = await insert(db(), 'bank_account', {
        organisation_id: world.orgs.otherLab,
        account_holder_name: 'DEMO Lab Two',
        account_number_ciphertext: Buffer.from('x'),
        account_number_last4: '0002',
        ifsc: 'ICIC0000002',
      });
      await expectPgError(db(), PG.foreignKey, () =>
        insert(db(), 'payout', {
          lab_org_id: world.orgs.lab,
          bank_account_id: account,
          amount_paise: 100,
        }),
      );
      await insert(db(), 'payout', {
        lab_org_id: world.orgs.otherLab,
        bank_account_id: account,
        amount_paise: 100,
      });
    }),
  );

  it(
    'C-42 rejects a receipt line or a report bound to a package of another booking (BR-063)',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const other = await createBooking(db(), world);
      const otherPackage = await createPackage(db(), world, other);
      const ownPackage = await createPackage(db(), world, booking);
      const receipt = await createReceipt(db(), world, booking);
      const event = await insert(db(), 'custody_event', {
        ...booking.keys,
        event_type: 'SCAN_ACCEPTED',
      });
      const line = {
        ...booking.keys,
        receipt_record_id: receipt,
        scanned_at: new Date(),
        scan_event_id: event,
      };
      await expectPgError(db(), PG.foreignKey, () =>
        insert(db(), 'receipt_package', { ...line, package_id: otherPackage }),
      );
      await insert(db(), 'receipt_package', { ...line, package_id: ownPackage });

      const report = await createReport(db(), world, booking);
      const version = await createReportVersion(db(), world, booking, report);
      await expectPgError(db(), PG.foreignKey, () =>
        update(db(), 'report_version', version, { bound_package_id: otherPackage }),
      );
      await update(db(), 'report_version', version, { bound_package_id: ownPackage });
    }),
  );
});
