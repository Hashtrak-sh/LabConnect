-- P3-08 (notifications): delivery tracking for email and a narrower write path for the inbox.
-- Hand-written.
--
-- 1. `notification` is the delivery row too (one row per event x recipient x channel, status
--    QUEUED / SENT / FAILED / SUPPRESSED). Sending an email can fail and be retried, so the row
--    needs an attempt counter and the time before which it must not be tried again. The same
--    two columns carry the lease that keeps two workers from sending one email (a worker that
--    claims a row moves `next_attempt_at` into the future before it sends).
-- 2. Row-level security let a user read their own inbox rows but its WITH CHECK clause was
--    `app_is_privileged()`, so a user could not mark a notification read. A second, narrow
--    policy lets a user update their own rows, and the grant of the API role is cut down to the
--    single column that a user changes (`read_at`). Everything else on a notification is written
--    by the worker only (the worker's grant is unchanged).

ALTER TABLE "notification"
  ADD COLUMN "delivery_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "next_attempt_at" TIMESTAMPTZ(6);

CREATE INDEX "notification_channel_status_next_attempt_at_idx"
  ON "notification"("channel", "status", "next_attempt_at");

CREATE POLICY read_own ON notification FOR UPDATE
  USING (recipient_user_id = app_user_id())
  WITH CHECK (recipient_user_id = app_user_id());

REVOKE UPDATE ON notification FROM app_rw;
GRANT UPDATE (read_at) ON notification TO app_rw;
