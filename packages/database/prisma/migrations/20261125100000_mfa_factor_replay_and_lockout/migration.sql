-- P3-03 (identity): per-factor state for TOTP replay protection and brute-force lockout.
--
-- RFC 6238 section 5.2 requires that a code is accepted once: the factor remembers the last
-- time step it accepted (`last_used_step`) and refuses that step and every earlier one.
-- Five consecutive wrong codes lock the factor for a while (`failed_attempts`,
-- `locked_until`), the same idea as the attempt limit of `otp_challenge` (C-79).
-- No new table and no new grant: `mfa_factor` already allows SELECT, INSERT and UPDATE.

ALTER TABLE "mfa_factor"
  ADD COLUMN "last_used_step" BIGINT,
  ADD COLUMN "failed_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" TIMESTAMPTZ(6);

ALTER TABLE "mfa_factor" ADD CONSTRAINT "ck_mfa_factor_failed_attempts"
  CHECK ("failed_attempts" >= 0);
