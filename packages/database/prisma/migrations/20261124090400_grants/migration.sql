-- Table privileges for the application roles. Hand-written.
-- C-25 (append-only) and C-81 (events cannot be rewritten) are enforced here.
--
-- Rule for later migrations: a new table gets no privileges until a migration grants
-- them. A test fails if a table has none for app_rw.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_rw, app_worker, app_ro;

DO $$
DECLARE
  t text;
  -- append-only: INSERT and SELECT only (C-25)
  append_only text[] := ARRAY[
    'audit_log','processed_event','organisation_version','md_node_version','search_synonym_version',
    'lab_site_version','accreditation_version','scope_line_version','lab_penalty','trf','booking_status_history',
    'custody_event','label_print','custody_event_photo','report_access_log','verification_event',
    'payment_transaction','ledger_journal','ledger_entry','financial_document','dispute_message','dispute_evidence'
  ];
  -- handled one by one below
  special text[] := ARRAY[
    'outbox_event','gateway_webhook_event','audit_log_chain','booking_transition','booking_line','price_item',
    'idempotency_record','otp_challenge','user_session','spatial_ref_sys'
  ];
BEGIN
  FOREACH t IN ARRAY append_only LOOP
    EXECUTE format('GRANT SELECT, INSERT ON %I TO app_rw, app_worker', t);
  END LOOP;

  -- every other table: read, insert, update. No DELETE: domain rows are never hard-deleted.
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
       AND c.relname <> ALL (append_only) AND c.relname <> ALL (special)
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO app_rw, app_worker', t);
  END LOOP;
END
$$;

-- PostGIS catalogue, read by geography functions under the calling role.
GRANT SELECT ON spatial_ref_sys, geography_columns, geometry_columns TO app_rw, app_worker, app_ro;

-- Reference data written only by migrations.
GRANT SELECT ON booking_transition TO app_rw, app_worker;

-- Lines and price items may be removed while their parent is still editable
-- (a REQUESTED booking is re-snapshotted by T-02; a DRAFT price list is edited).
-- The triggers trg_booking_line_guard and trg_price_item_guard refuse it afterwards.
GRANT SELECT, INSERT, UPDATE, DELETE ON booking_line, price_item TO app_rw, app_worker;

-- Expired rows are purged by the worker only.
GRANT SELECT, INSERT, UPDATE ON idempotency_record, otp_challenge, user_session TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_record, otp_challenge, user_session TO app_worker;

-- Outbox: the API can only add events. The payload holds tenant data and the table has
-- no tenant key, so the API cannot read it back. Use INSERT without RETURNING
-- (Prisma createMany, not create). Only the relay reads it and marks events published.
GRANT INSERT ON outbox_event TO app_rw;
GRANT SELECT, INSERT ON outbox_event TO app_worker;
GRANT UPDATE (published_at, attempts, last_error) ON outbox_event TO app_worker;

-- Webhook intake: the stored event is never rewritten; only the processing columns move.
GRANT SELECT, INSERT ON gateway_webhook_event TO app_rw, app_worker;
GRANT UPDATE (processing_status, processed_at, error) ON gateway_webhook_event TO app_rw, app_worker;

-- Audit hash chain: sealed by the worker only.
GRANT SELECT ON audit_log_chain TO app_rw;
GRANT SELECT, INSERT ON audit_log_chain TO app_worker;
