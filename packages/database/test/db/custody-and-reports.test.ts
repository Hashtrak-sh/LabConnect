import { beforeAll, describe, it } from 'vitest';
import {
  createBooking,
  createPackage,
  createReceipt,
  createReport,
  createReportVersion,
  createWorld,
  releaseValues,
  type World,
} from './fixtures.js';
import { expectPgError, insert, PG, rollback, update, useDatabase } from './helpers.js';

describe('custody', () => {
  const { db } = useDatabase();
  let world: World;
  beforeAll(async () => {
    world = await createWorld(db());
  });
  const inTx = (body: () => Promise<void>) => () => rollback(db(), body);

  it(
    'C-23 never lets a package short code be used twice, even after the first label is voided',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const first = await createPackage(db(), world, booking, { short_code: 'ABC123' });
      await update(db(), 'package', first, { status: 'VOIDED' });
      await expectPgError(db(), PG.unique, () =>
        createPackage(db(), world, booking, { short_code: 'ABC123', label_version: 2 }),
      );
      await createPackage(db(), world, booking, { short_code: 'ABC124', label_version: 2 });
    }),
  );

  it(
    'C-24 allows one active signing key per purpose',
    inTx(async () => {
      const key = {
        purpose: 'PACKAGE',
        kms_key_arn: 'arn:aws:kms:ap-south-1:000000000000:key/demo-2',
        status: 'ACTIVE',
      };
      await expectPgError(db(), PG.unique, () =>
        insert(db(), 'qr_signing_key', { ...key, key_id: 'k2' }),
      );
      await expectPgError(db(), PG.unique, () =>
        insert(db(), 'qr_signing_key', { ...key, key_id: 'k1', purpose: 'REPORT' }),
      );
      await insert(db(), 'qr_signing_key', { ...key, key_id: 'k2', status: 'VERIFY_ONLY' });
    }),
  );

  it(
    'C-50 records a retried offline scan once',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const scan = {
        ...booking.keys,
        event_type: 'SCAN_ACCEPTED',
        device_id: 'device-1',
        client_seq: 41,
      };
      await insert(db(), 'custody_event', scan);
      await expectPgError(db(), PG.unique, () => insert(db(), 'custody_event', scan));
      await insert(db(), 'custody_event', { ...scan, client_seq: 42 });
      // events recorded online carry no device sequence and are not affected
      await insert(db(), 'custody_event', { ...booking.keys, event_type: 'QR_ISSUED' });
      await insert(db(), 'custody_event', { ...booking.keys, event_type: 'QR_ISSUED' });
    }),
  );

  it(
    'C-51 keeps a receipt decision consistent',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const receipt = await createReceipt(db(), world, booking);
      const decided = { checker_user_id: world.users.checker, decided_at: new Date() };
      // approved or on hold needs a lab sample id
      await expectPgError(db(), PG.check, () =>
        update(db(), 'receipt_record', receipt, { ...decided, decision: 'APPROVED' }),
      );
      await expectPgError(db(), PG.check, () =>
        update(db(), 'receipt_record', receipt, { ...decided, decision: 'HOLD_CONFIRMED' }),
      );
      // a decision needs a checker and a time
      await expectPgError(db(), PG.check, () =>
        update(db(), 'receipt_record', receipt, { decision: 'REJECTED_UNFIT' }),
      );
      // a discrepancy needs notes
      await expectPgError(db(), PG.check, () =>
        update(db(), 'receipt_record', receipt, { discrepancy_flag: true }),
      );
      await update(db(), 'receipt_record', receipt, { ...decided, decision: 'REJECTED_UNFIT' });
    }),
  );

  it(
    'C-52 freezes a receipt record once it is decided',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const receipt = await createReceipt(db(), world, booking);
      await update(db(), 'receipt_record', receipt, { actual_package_count: 2 });
      await update(db(), 'receipt_record', receipt, {
        checker_user_id: world.users.checker,
        decided_at: new Date(),
        decision: 'APPROVED',
        lab_sample_id: 'S-1',
      });
      await expectPgError(db(), PG.frozen, () =>
        update(db(), 'receipt_record', receipt, { actual_package_count: 3 }),
      );
      await expectPgError(db(), PG.frozen, () =>
        update(db(), 'receipt_record', receipt, { decision: 'REJECTED_UNFIT' }),
      );
    }),
  );

  it(
    'C-53 allows one open hold case per booking',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const receipt = await createReceipt(db(), world, booking);
      const hold = {
        ...booking.keys,
        receipt_record_id: receipt,
        reason_node_id: world.nodes.holdReason,
        due_at: new Date(Date.now() + 86_400_000),
      };
      const first = await insert(db(), 'hold_case', hold);
      await expectPgError(db(), PG.unique, () => insert(db(), 'hold_case', hold));
      await update(db(), 'hold_case', first, { status: 'ESCALATED' });
      await expectPgError(db(), PG.unique, () => insert(db(), 'hold_case', hold));
      await update(db(), 'hold_case', first, {
        status: 'DECIDED',
        customer_decision: 'PROCEED',
        decided_at: new Date(),
      });
      await insert(db(), 'hold_case', hold);
    }),
  );
});

describe('reports', () => {
  const { db } = useDatabase();
  let world: World;
  beforeAll(async () => {
    world = await createWorld(db());
  });
  const inTx = (body: () => Promise<void>) => () => rollback(db(), body);

  it(
    'C-21 keeps a ULR unique across reports, and a report number unique within a lab site',
    inTx(async () => {
      const first = await createBooking(db(), world);
      const second = await createBooking(db(), world);
      await createReport(db(), world, first, { ulr_no: 'TC000126000000001F', report_no: 'R-1' });
      await expectPgError(db(), PG.unique, () =>
        createReport(db(), world, second, { ulr_no: 'TC000126000000001F', report_no: 'R-2' }),
      );
      await expectPgError(db(), PG.unique, () =>
        createReport(db(), world, second, { report_no: 'R-1' }),
      );
      await createReport(db(), world, second, { ulr_no: 'TC000126000000002F', report_no: 'R-2' });
    }),
  );

  it(
    'C-22 allows one open version per report, and a new one after a return',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const report = await createReport(db(), world, booking);
      const first = await createReportVersion(db(), world, booking, report, { submitted: true });
      await expectPgError(db(), PG.unique, () =>
        createReportVersion(db(), world, booking, report, { values: { version_no: 2 } }),
      );
      // returned by the checker: the maker's resubmission is version 2 and is not an amendment
      await update(db(), 'report_version', first, {
        status: 'RETURNED',
        review_comments: 'Units missing',
        checker_user_id: world.users.checker,
        decided_at: new Date(),
      });
      await createReportVersion(db(), world, booking, report, { values: { version_no: 2 } });
    }),
  );

  it(
    'C-55 requires the submission fields from IN_REVIEW, comments on return, and a reason for an amendment',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const report = await createReport(db(), world, booking);
      const draft = await createReportVersion(db(), world, booking, report);
      await expectPgError(db(), PG.check, () =>
        update(db(), 'report_version', draft, { status: 'IN_REVIEW' }),
      );
      await expectPgError(db(), PG.check, () =>
        update(db(), 'report_version', draft, { is_amendment: true }),
      );
      await db().query('DELETE FROM report_version WHERE id = $1', [draft]);

      const submitted = await createReportVersion(db(), world, booking, report, {
        submitted: true,
      });
      await expectPgError(db(), PG.check, () =>
        update(db(), 'report_version', submitted, { status: 'RETURNED' }),
      );
      // releasing needs the checker, the MFA time and the stamped copy
      await expectPgError(db(), PG.check, () =>
        update(db(), 'report_version', submitted, { status: 'RELEASED' }),
      );
      const release = await releaseValues(db(), world);
      await expectPgError(db(), PG.check, () =>
        update(db(), 'report_version', submitted, { ...release, stamped_file_id: null }),
      );
      await expectPgError(db(), PG.check, () =>
        update(db(), 'report_version', submitted, { ...release, checker_mfa_at: null }),
      );
      await update(db(), 'report_version', submitted, release);
    }),
  );

  it(
    'C-54 C-56 allow one released version, which can only be superseded',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const report = await createReport(db(), world, booking);
      const v1 = await createReportVersion(db(), world, booking, report, { submitted: true });
      await update(db(), 'report_version', v1, await releaseValues(db(), world));

      // released: no field may change
      await expectPgError(db(), PG.frozen, () =>
        update(db(), 'report_version', v1, { issue_date: '2026-12-11' }),
      );
      await expectPgError(db(), PG.frozen, () =>
        update(db(), 'report_version', v1, { status: 'DRAFT' }),
      );
      await expectPgError(db(), PG.frozen, () =>
        update(db(), 'report_version', v1, { status: 'SUPERSEDED' }),
      );

      // an amendment: version 2 while version 1 is released
      const v2 = await createReportVersion(db(), world, booking, report, {
        submitted: true,
        values: { version_no: 2, is_amendment: true, amendment_reason: 'Typing error in result' },
      });
      const release = await releaseValues(db(), world);
      // two released versions at once are refused: supersede the old one first
      await expectPgError(db(), PG.unique, () => update(db(), 'report_version', v2, release));
      await update(db(), 'report_version', v1, {
        status: 'SUPERSEDED',
        superseded_by_version_id: v2,
      });
      await update(db(), 'report_version', v2, release);
      // superseded: never changes again
      await expectPgError(db(), PG.frozen, () =>
        update(db(), 'report_version', v1, { review_comments: 'x' }),
      );
    }),
  );

  it(
    'C-30 rejects a result for a cancelled booking line (BR-061)',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const report = await createReport(db(), world, booking);
      const version = await createReportVersion(db(), world, booking, report);
      const result = {
        ...booking.keys,
        report_version_id: version,
        booking_line_id: booking.line,
        conformity: 'CONFORMS',
      };
      await update(db(), 'booking_line', booking.line, {
        status: 'CANCELLED',
        cancelled_reason: 'Scope withdrawn',
      });
      await expectPgError(db(), PG.rule, () => insert(db(), 'report_parameter_result', result));
      await update(db(), 'booking_line', booking.line, { status: 'DONE' });
      await insert(db(), 'report_parameter_result', result);
      // and never a line of another booking (C-42)
      const other = await createBooking(db(), world);
      await expectPgError(db(), PG.foreignKey, () =>
        insert(db(), 'report_parameter_result', { ...result, booking_line_id: other.line }),
      );
    }),
  );
});
