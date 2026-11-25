import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  confirmTotpEnrolment,
  hotp,
  IDENTITY_POLICY,
  IdentityError,
  startTotpEnrolment,
  timeStep,
  verifyUserTotp,
} from '../../src/index.js';
import { createCustomer, META, useIdentity } from './identity-support.js';

// P3-03: TOTP enrolment, verification, replay protection and lockout against the real tables.

describe('TOTP MFA', () => {
  const { db, deps, clock, asUser, owner } = useIdentity();

  const newUser = async (): Promise<string> => {
    const customer = await owner((tx) => createCustomer(tx));
    return customer.finance ?? '';
  };
  const start = (userId: string) =>
    asUser(userId, (tx) => startTotpEnrolment(tx, deps, { userId, meta: META }));
  const confirm = (userId: string, code: string) =>
    asUser(userId, (tx) => confirmTotpEnrolment(tx, deps, { userId, code, meta: META }));
  const verify = (userId: string, code: string) =>
    asUser(userId, (tx) => verifyUserTotp(tx, deps, { userId, code, meta: META }));
  const codeNow = (secretBase32: string, offsetSteps = 0): string =>
    hotp(base32Decode(secretBase32), timeStep(clock.now().getTime()) + offsetSteps);
  const nextStep = (): void => {
    clock.advance(IDENTITY_POLICY.totpPeriodSeconds * 1000);
  };
  const wrong = (right: string): string => (right === '000000' ? '000001' : '000000');
  const factorRow = async (userId: string) =>
    (
      await db().query<{
        id: string;
        secret_ciphertext: Buffer;
        verified_at: Date | null;
        revoked_at: Date | null;
        last_used_step: string | null;
        failed_attempts: number;
        locked_until: Date | null;
      }>(
        'SELECT * FROM mfa_factor WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC',
        [userId],
      )
    ).rows[0];

  /** A user with a verified factor, and the secret. */
  const enrolled = async () => {
    const userId = await newUser();
    const enrolment = await start(userId);
    const outcome = await confirm(userId, codeNow(enrolment.secret));
    expect(outcome.ok).toBe(true);
    nextStep();
    return { userId, secret: enrolment.secret };
  };

  describe('enrolment', () => {
    it('returns the secret and an otpauth URI, and stores the secret encrypted', async () => {
      const userId = await newUser();
      const enrolment = await start(userId);
      expect(enrolment.secret).toMatch(/^[A-Z2-7]{32}$/);
      const uri = new URL(enrolment.otpauthUri);
      expect(uri.searchParams.get('secret')).toBe(enrolment.secret);
      expect(uri.searchParams.get('issuer')).toBe('LabConnect');

      const row = await factorRow(userId);
      expect(row?.verified_at).toBeNull();
      const raw = Buffer.from(base32Decode(enrolment.secret));
      const stored = row?.secret_ciphertext ?? Buffer.alloc(0);
      expect(stored.includes(raw)).toBe(false);
      expect(stored.toString('latin1')).not.toContain(enrolment.secret);
      // It decrypts under the row's id, and only there.
      expect(Buffer.from(await deps.cipher.decrypt(stored, `mfa_factor:${row?.id ?? ''}`))).toEqual(
        raw,
      );
      await expect(deps.cipher.decrypt(stored, 'mfa_factor:other')).rejects.toThrow();
    });

    it('audits the start and the confirmation without any secret or code', async () => {
      const userId = await newUser();
      const enrolment = await start(userId);
      const code = codeNow(enrolment.secret);
      const outcome = await confirm(userId, code);
      const audit = await db().query<{ action: string }>(
        "SELECT action, before, after, reason FROM audit_log WHERE actor_user_id = $1 AND action LIKE 'auth.mfa%'",
        [userId],
      );
      expect(audit.rows.map((row) => row.action).sort()).toEqual([
        'auth.mfa_enrol_confirmed',
        'auth.mfa_enrol_started',
      ]);
      const text = JSON.stringify(audit.rows);
      expect(text).not.toContain(enrolment.secret);
      expect(text).not.toContain(code);
      if (outcome.ok)
        for (const recovery of outcome.recoveryCodes) expect(text).not.toContain(recovery);
    });

    it('replaces a pending factor when started again, so only the newest can be confirmed', async () => {
      const userId = await newUser();
      const first = await start(userId);
      const second = await start(userId);
      expect(second.secret).not.toBe(first.secret);
      const pending = await db().query<{ n: string }>(
        'SELECT count(*) AS n FROM mfa_factor WHERE user_id = $1 AND verified_at IS NULL AND revoked_at IS NULL',
        [userId],
      );
      expect(pending.rows[0]?.n).toBe('1');
      expect(await confirm(userId, codeNow(first.secret))).toEqual({
        ok: false,
        reason: 'INVALID',
      });
      expect(await confirm(userId, codeNow(second.secret))).toMatchObject({ ok: true });
    });

    it('confirms with a right code: 10 recovery codes shown once, stored only as hashes, MFA recorded on the user', async () => {
      const userId = await newUser();
      const enrolment = await start(userId);
      const outcome = await confirm(userId, codeNow(enrolment.secret));
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.recoveryCodes).toHaveLength(10);
      expect(new Set(outcome.recoveryCodes).size).toBe(10);

      const stored = await db().query<{ code_hash: Buffer; used_at: Date | null }>(
        'SELECT code_hash, used_at FROM mfa_recovery_code WHERE user_id = $1',
        [userId],
      );
      expect(stored.rows).toHaveLength(10);
      for (const row of stored.rows) {
        expect(row.used_at).toBeNull();
        expect(row.code_hash).toHaveLength(32);
        for (const code of outcome.recoveryCodes) {
          expect(row.code_hash.toString('latin1')).not.toContain(code);
        }
      }
      // Each stored hash is the HMAC of exactly one of the shown codes.
      const expected = outcome.recoveryCodes.map((code) =>
        Buffer.from(deps.hasher.recoveryCode(userId, code)).toString('hex'),
      );
      expect(stored.rows.map((row) => row.code_hash.toString('hex')).sort()).toEqual(
        expected.sort(),
      );

      const user = await db().query<{ mfa_enrolled_at: Date | null }>(
        'SELECT mfa_enrolled_at FROM app_user WHERE id = $1',
        [userId],
      );
      expect(user.rows[0]?.mfa_enrolled_at?.toISOString()).toBe(clock.now().toISOString());
      expect((await factorRow(userId))?.verified_at).not.toBeNull();
    });

    it('does not activate the factor on a wrong code, and counts the failure', async () => {
      const userId = await newUser();
      const enrolment = await start(userId);
      expect(await confirm(userId, wrong(codeNow(enrolment.secret)))).toEqual({
        ok: false,
        reason: 'INVALID',
      });
      const row = await factorRow(userId);
      expect(row?.verified_at).toBeNull();
      expect(row?.failed_attempts).toBe(1);
      const recovery = await db().query<{ n: string }>(
        'SELECT count(*) AS n FROM mfa_recovery_code WHERE user_id = $1',
        [userId],
      );
      expect(recovery.rows[0]?.n).toBe('0');
    });

    it('answers NOT_FOUND when there is nothing to confirm', async () => {
      const userId = await newUser();
      await expect(confirm(userId, '123456')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const done = await enrolled();
      await expect(confirm(done.userId, '123456')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('refuses to start again once a factor is verified (INVALID_STATE_TRANSITION)', async () => {
      const { userId } = await enrolled();
      const error = await start(userId).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(IdentityError);
      expect((error as IdentityError).code).toBe('INVALID_STATE_TRANSITION');
    });

    it('allows only one verified factor per user in the database (C-07)', async () => {
      const { userId } = await enrolled();
      await expect(
        owner((tx) =>
          tx.mfaFactor.create({
            data: {
              id: '018f0000-0000-7000-8000-0000000000aa',
              userId,
              factorType: 'TOTP',
              secretCiphertext: new Uint8Array(40),
              verifiedAt: clock.now(),
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it('retires recovery codes of an earlier factor when a new factor is confirmed', async () => {
      const { userId } = await enrolled();
      await db().query('UPDATE mfa_factor SET revoked_at = now() WHERE user_id = $1', [userId]);
      const enrolment = await start(userId);
      await confirm(userId, codeNow(enrolment.secret));
      const codes = await db().query<{ unused: string; used: string }>(
        `SELECT count(*) FILTER (WHERE used_at IS NULL) AS unused,
                count(*) FILTER (WHERE used_at IS NOT NULL) AS used
           FROM mfa_recovery_code WHERE user_id = $1`,
        [userId],
      );
      expect(codes.rows[0]).toEqual({ unused: '10', used: '10' });
    });
  });

  describe('verification', () => {
    it('answers NOT_ENROLLED without a verified factor, even with a pending one', async () => {
      const userId = await newUser();
      expect(await verify(userId, '123456')).toEqual({ ok: false, reason: 'NOT_ENROLLED' });
      await start(userId);
      expect(await verify(userId, '123456')).toEqual({ ok: false, reason: 'NOT_ENROLLED' });
    });

    it('accepts the right code, and one step either side of now', async () => {
      const { userId, secret } = await enrolled();
      expect(await verify(userId, codeNow(secret))).toEqual({ ok: true });
      nextStep();
      // The code of the step before this one was already covered by the window: fresh steps only.
      expect(await verify(userId, codeNow(secret, 1))).toEqual({ ok: true });
    });

    it('refuses a code two steps away', async () => {
      const { userId, secret } = await enrolled();
      expect(await verify(userId, codeNow(secret, 2))).toEqual({ ok: false, reason: 'INVALID' });
      expect(await verify(userId, codeNow(secret, -2))).toEqual({ ok: false, reason: 'INVALID' });
    });

    it('accepts a time step only once (replay protection), and records the step', async () => {
      const { userId, secret } = await enrolled();
      const code = codeNow(secret);
      expect(await verify(userId, code)).toEqual({ ok: true });
      expect((await factorRow(userId))?.last_used_step).toBe(
        String(timeStep(clock.now().getTime())),
      );
      expect(await verify(userId, code)).toEqual({ ok: false, reason: 'INVALID' });
      // Neither can an earlier step be used once a later one has been.
      expect(await verify(userId, codeNow(secret, -1))).toEqual({ ok: false, reason: 'INVALID' });
      // A later step is fine.
      expect(await verify(userId, codeNow(secret, 1))).toEqual({ ok: true });
      nextStep();
      expect(await verify(userId, codeNow(secret))).toEqual({ ok: false, reason: 'INVALID' });
      nextStep();
      expect(await verify(userId, codeNow(secret))).toEqual({ ok: true });
    });

    it('refuses the code that confirmed the enrolment', async () => {
      const userId = await newUser();
      const enrolment = await start(userId);
      const code = codeNow(enrolment.secret);
      await confirm(userId, code);
      expect(await verify(userId, code)).toEqual({ ok: false, reason: 'INVALID' });
      nextStep();
      expect(await verify(userId, codeNow(enrolment.secret))).toEqual({ ok: true });
    });

    it('lets exactly one of two simultaneous submissions of one code succeed', async () => {
      for (let round = 0; round < 4; round++) {
        const { userId, secret } = await enrolled();
        const code = codeNow(secret);
        const results = await Promise.all([verify(userId, code), verify(userId, code)]);
        expect(results.filter((result) => result.ok)).toHaveLength(1);
      }
    });

    it('locks the factor after 5 wrong codes in a row, even for the right code, then unlocks', async () => {
      const { userId, secret } = await enrolled();
      const right = codeNow(secret);
      for (let i = 1; i < IDENTITY_POLICY.mfaMaxFailedAttempts; i++) {
        expect(await verify(userId, wrong(right))).toEqual({ ok: false, reason: 'INVALID' });
      }
      expect(await verify(userId, wrong(right))).toEqual({
        ok: false,
        reason: 'LOCKED',
        retryAfterSeconds: 900,
      });
      const locked = await verify(userId, right);
      expect(locked).toMatchObject({ ok: false, reason: 'LOCKED' });
      clock.advance(899_000);
      expect(await verify(userId, codeNow(secret))).toMatchObject({ ok: false, reason: 'LOCKED' });
      clock.advance(1000);
      expect(await verify(userId, codeNow(secret))).toEqual({ ok: true });
      const row = await factorRow(userId);
      expect(row?.failed_attempts).toBe(0);
      expect(row?.locked_until).toBeNull();
    });

    it('starts counting again after a lock runs out', async () => {
      const { userId, secret } = await enrolled();
      for (let i = 0; i < IDENTITY_POLICY.mfaMaxFailedAttempts; i++) {
        await verify(userId, wrong(codeNow(secret)));
      }
      clock.advance(901_000);
      expect(await verify(userId, wrong(codeNow(secret)))).toEqual({
        ok: false,
        reason: 'INVALID',
      });
      expect((await factorRow(userId))?.failed_attempts).toBe(1);
    });

    it('clears the count on a right code', async () => {
      const { userId, secret } = await enrolled();
      await verify(userId, wrong(codeNow(secret)));
      await verify(userId, wrong(codeNow(secret)));
      expect((await factorRow(userId))?.failed_attempts).toBe(2);
      expect(await verify(userId, codeNow(secret))).toEqual({ ok: true });
      expect((await factorRow(userId))?.failed_attempts).toBe(0);
    });

    it('audits a lock', async () => {
      const { userId, secret } = await enrolled();
      for (let i = 0; i < IDENTITY_POLICY.mfaMaxFailedAttempts; i++) {
        await verify(userId, wrong(codeNow(secret)));
      }
      const audit = await db().query<{ action: string }>(
        "SELECT action FROM audit_log WHERE actor_user_id = $1 AND action = 'auth.mfa_locked'",
        [userId],
      );
      expect(audit.rows).toHaveLength(1);
    });

    it('keeps one user from another user’s factor (row-level security)', async () => {
      const first = await enrolled();
      const other = await newUser();
      const seen = await asUser(other, (tx) =>
        tx.mfaFactor.count({ where: { userId: first.userId } }),
      );
      expect(seen).toBe(0);
    });
  });
});
