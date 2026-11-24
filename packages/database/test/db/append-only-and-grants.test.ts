import { beforeAll, describe, expect, it } from 'vitest';
import { createBooking, createWorld, type World } from './fixtures.js';
import {
  type Db,
  expectPgError,
  insert,
  PG,
  rollback,
  setLocal,
  useDatabase,
  uuid,
} from './helpers.js';

// Tables marked AO in SCHEMA_SPECIFICATION.md.
const APPEND_ONLY = [
  'audit_log',
  'processed_event',
  'audit_log_chain',
  'organisation_version',
  'md_node_version',
  'search_synonym_version',
  'lab_site_version',
  'accreditation_version',
  'scope_line_version',
  'lab_penalty',
  'trf',
  'booking_status_history',
  'custody_event',
  'label_print',
  'custody_event_photo',
  'report_access_log',
  'verification_event',
  'payment_transaction',
  'ledger_journal',
  'ledger_entry',
  'financial_document',
  'dispute_message',
  'dispute_evidence',
];

async function asRole(
  db: Db,
  role: 'app_rw' | 'app_worker',
  settings: Record<string, string> = {},
): Promise<void> {
  await db.query(`SET LOCAL ROLE ${role}`);
  for (const [name, value] of Object.entries(settings)) await setLocal(db, name, value);
}

describe('append-only tables and role privileges', () => {
  const { db } = useDatabase();
  let world: World;
  beforeAll(async () => {
    world = await createWorld(db());
  });
  const inTx = (body: () => Promise<void>) => () => rollback(db(), body);

  it('C-25 marks the same tables append-only as the schema specification', async () => {
    const result = await db().query<{ relname: string }>(
      `SELECT DISTINCT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE t.tgname = 'trg_append_only' AND NOT c.relispartition ORDER BY 1`,
    );
    expect(result.rows.map((row) => row.relname)).toEqual([...APPEND_ONLY].sort());
  });

  it('C-25 gives neither application role UPDATE, DELETE or TRUNCATE on an append-only table', async () => {
    const result = await db().query<{ offender: string }>(
      `SELECT r.rolname || ' ' || p.privilege || ' ' || c.relname AS offender
         FROM pg_class c
         CROSS JOIN (VALUES ('app_rw'), ('app_worker')) AS r(rolname)
         CROSS JOIN (VALUES ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(privilege)
        WHERE c.relname = ANY ($1) AND c.relnamespace = 'public'::regnamespace
          AND has_table_privilege(r.rolname, c.oid, p.privilege)`,
      [APPEND_ONLY],
    );
    expect(result.rows).toEqual([]);
  });

  it(
    'C-25 refuses to change history even for the owner',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      const history = await insert(db(), 'booking_status_history', {
        ...booking.keys,
        transition_id: 'T-01',
        to_status: 'REQUESTED',
        actor_party: 'CUSTOMER',
      });
      await expectPgError(db(), PG.appendOnly, () =>
        db().query(`UPDATE booking_status_history SET reason = 'edited' WHERE id = $1`, [history]),
      );
      await expectPgError(db(), PG.appendOnly, () =>
        db().query('DELETE FROM booking_status_history WHERE id = $1', [history]),
      );
      await expectPgError(db(), PG.appendOnly, () => db().query('TRUNCATE booking_status_history'));

      // the partitioned audit log behaves the same
      await db().query(
        `INSERT INTO audit_log (id, occurred_at, action, entity_type, entity_id) VALUES ($1, now(), 'booking.transition', 'booking', $2)`,
        [uuid(), booking.id],
      );
      await expectPgError(db(), PG.appendOnly, () =>
        db().query(`UPDATE audit_log SET reason = 'edited'`),
      );
      await expectPgError(db(), PG.appendOnly, () => db().query('DELETE FROM audit_log'));
    }),
  );

  it(
    'C-25 the API role is stopped by privileges before the trigger is reached',
    inTx(async () => {
      const booking = await createBooking(db(), world);
      await insert(db(), 'trf', {
        ...booking.keys,
        version_no: 1,
        schema_version: 'trf.v1',
        form: {},
        conformity_required: false,
        submitted_by_user_id: world.users.customerAdmin,
      });
      await asRole(db(), 'app_rw', { 'app.org_id': booking.customerOrg });
      await expectPgError(db(), PG.privilege, () =>
        db().query(`UPDATE trf SET decision_rule = 'x'`),
      );
      await expectPgError(db(), PG.privilege, () => db().query('DELETE FROM trf'));
      await expectPgError(db(), PG.privilege, () => db().query('TRUNCATE trf'));
      // and it cannot hard-delete ordinary rows either
      await expectPgError(db(), PG.privilege, () => db().query('DELETE FROM booking'));
      await expectPgError(db(), PG.privilege, () => db().query('DELETE FROM organisation'));
      // reference data is read-only
      await expectPgError(db(), PG.privilege, () =>
        db().query(`UPDATE booking_transition SET to_status = 'COMPLETED'`),
      );
    }),
  );

  it(
    'C-81 lets the API add outbox events but never read or rewrite them',
    inTx(async () => {
      const event = {
        aggregate_type: 'booking',
        aggregate_id: uuid(),
        event_type: 'booking.requested',
        payload: { demo: true },
        occurred_at: new Date(),
      };
      await asRole(db(), 'app_rw', { 'app.org_id': world.orgs.customer });
      const id = await insert(db(), 'outbox_event', event);
      await expectPgError(db(), PG.privilege, () => db().query('SELECT * FROM outbox_event'));
      await expectPgError(db(), PG.privilege, () =>
        db().query('UPDATE outbox_event SET published_at = now()'),
      );

      await db().query('RESET ROLE');
      await asRole(db(), 'app_worker', { 'app.is_system': 'true' });
      // the relay marks it published, and can change nothing else
      const marked = await db().query(
        'UPDATE outbox_event SET published_at = now(), attempts = attempts + 1 WHERE id = $1',
        [id],
      );
      expect(marked.rowCount).toBe(1);
      await expectPgError(db(), PG.privilege, () =>
        db().query(`UPDATE outbox_event SET payload = '{}'`),
      );
      await expectPgError(db(), PG.privilege, () => db().query('DELETE FROM outbox_event'));
    }),
  );

  it(
    'C-81 lets a stored webhook event move through processing without its content changing',
    inTx(async () => {
      await asRole(db(), 'app_worker', { 'app.is_system': 'true' });
      await insert(db(), 'gateway_webhook_event', {
        gateway: 'FAKE',
        event_id: 'EVT-9',
        event_type: 'payment.captured',
        signature_valid: true,
        payload_ciphertext: Buffer.from('x'),
        payload_sha256: Buffer.from('y'),
      });
      const processed = await db().query(
        `UPDATE gateway_webhook_event SET processing_status = 'PROCESSED', processed_at = now() WHERE event_id = 'EVT-9'`,
      );
      expect(processed.rowCount).toBe(1);
      await expectPgError(db(), PG.privilege, () =>
        db().query(`UPDATE gateway_webhook_event SET signature_valid = false`),
      );
      await expectPgError(db(), PG.privilege, () =>
        db().query(`UPDATE gateway_webhook_event SET payload_ciphertext = 'z'`),
      );
    }),
  );

  it(
    'lets only the worker purge expired rows and seal the audit chain',
    inTx(async () => {
      const record = {
        idempotency_key: 'k',
        actor_user_id: world.users.customerAdmin,
        route: 'POST /v1/bookings',
        request_hash: Buffer.from('h'),
        status: 'COMPLETED',
        expires_at: new Date(0),
      };
      await asRole(db(), 'app_rw', { 'app.user_id': world.users.customerAdmin });
      await insert(db(), 'idempotency_record', record);
      await expectPgError(db(), PG.privilege, () => db().query('DELETE FROM idempotency_record'));
      await expectPgError(db(), PG.privilege, () =>
        insert(db(), 'audit_log_chain', {
          chain_month: '2026-11-01',
          seq: 1,
          audit_log_id: uuid(),
          audit_occurred_at: new Date(),
          hash: Buffer.from('h'),
        }),
      );

      await db().query('RESET ROLE');
      await asRole(db(), 'app_worker', { 'app.is_system': 'true' });
      const purged = await db().query('DELETE FROM idempotency_record WHERE expires_at < now()');
      expect(purged.rowCount).toBe(1);
      await insert(db(), 'audit_log_chain', {
        chain_month: '2026-11-01',
        seq: 1,
        audit_log_id: uuid(),
        audit_occurred_at: new Date(),
        hash: Buffer.from('h'),
      });
    }),
  );
});
