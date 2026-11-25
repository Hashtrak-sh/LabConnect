import { withDbContext } from '@labconnect/database';
import { describe, expect, it } from 'vitest';
import {
  consumeLoginOtp,
  IDENTITY_POLICY,
  type OtpConsumeOutcome,
  requestLoginOtp,
} from '../../src/index.js';
import { expectPgError, rollback } from '../../../database/test/db/helpers.js';
import { failure, PG } from './support.js';
import { uniqueEmail, useIdentity } from './identity-support.js';

// P3-03: email OTP against the real table, grants and row-level security.

describe('login OTP (otp_challenge)', () => {
  const { api, db, deps, clock, asSystem } = useIdentity();

  const request = async (email: string, ipAddress?: string) =>
    asSystem((tx) => requestLoginOtp(tx, deps, { email, ...(ipAddress && { ipAddress }) }));
  const issue = async (email: string): Promise<string> => {
    const outcome = await request(email);
    if (!outcome.ok) throw new Error('the request was throttled');
    return outcome.code;
  };
  const consume = (email: string, code: string): Promise<OtpConsumeOutcome> =>
    asSystem((tx) => consumeLoginOtp(tx, deps, { email, code }));
  const wrongCode = (code: string): string => (code === '000000' ? '000001' : '000000');

  it('stores only a keyed hash: the code is in no column of the row', async () => {
    const email = uniqueEmail();
    const outcome = await request(email, '203.0.113.50');
    if (!outcome.ok) throw new Error('throttled');
    const rows = await db().query<Record<string, unknown>>(
      'SELECT *, host(ip_address) AS ip FROM otp_challenge WHERE id = $1',
      [outcome.challengeId],
    );
    const row = rows.rows[0];
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      channel: 'EMAIL',
      purpose: 'LOGIN',
      attempts: 0,
      consumed_at: null,
      ip: '203.0.113.50',
    });
    expect((row?.expires_at as Date).toISOString()).toBe('2026-11-25T10:10:00.000Z');
    expect((row?.code_hash as Buffer).length).toBe(32);
    expect((row?.destination_hash as Buffer).length).toBe(32);
    // Nothing in the whole row, rendered as text in any common way, contains the code or the address.
    const everything =
      JSON.stringify(row) + Buffer.from(row?.code_hash as Buffer).toString('latin1');
    expect(everything).not.toContain(outcome.code);
    expect(everything).not.toContain(email);
    expect((row?.code_hash as Buffer).toString('hex')).not.toContain(outcome.code);
  });

  it('writes nothing to the audit log or the outbox', async () => {
    const before = await db().query<{ audit: string; outbox: string }>(
      'SELECT (SELECT count(*) FROM audit_log) AS audit, (SELECT count(*) FROM outbox_event) AS outbox',
    );
    const email = uniqueEmail();
    const code = await issue(email);
    await consume(email, wrongCode(code));
    await consume(email, code);
    const after = await db().query<{ audit: string; outbox: string }>(
      'SELECT (SELECT count(*) FROM audit_log) AS audit, (SELECT count(*) FROM outbox_event) AS outbox',
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('accepts the right code once (single use)', async () => {
    const email = uniqueEmail();
    const code = await issue(email);
    expect(await consume(email, code)).toMatchObject({ ok: true });
    expect(await consume(email, code)).toEqual({ ok: false, reason: 'INVALID' });
  });

  it('does not mind the case of the address', async () => {
    const email = uniqueEmail();
    const code = await issue(email.toUpperCase());
    expect(await consume(`  ${email} `, code)).toMatchObject({ ok: true });
  });

  it('answers INVALID for an address that never asked for a code, like for a wrong code', async () => {
    expect(await consume(uniqueEmail(), '123456')).toEqual({ ok: false, reason: 'INVALID' });
    const email = uniqueEmail();
    const code = await issue(email);
    expect(await consume(email, wrongCode(code))).toEqual({ ok: false, reason: 'INVALID' });
  });

  it('expires after 10 minutes, and not a second before', async () => {
    const email = uniqueEmail();
    const code = await issue(email);
    clock.advance(IDENTITY_POLICY.otpTtlSeconds * 1000 - 1000);
    // Valid until the last second. A wrong guess still counts as an attempt only.
    expect(await consume(email, wrongCode(code))).toEqual({ ok: false, reason: 'INVALID' });
    clock.advance(1000);
    expect(await consume(email, code)).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('counts wrong guesses and locks at the fifth, even against the right code afterwards', async () => {
    const email = uniqueEmail();
    const code = await issue(email);
    const wrong = wrongCode(code);
    for (let attempt = 1; attempt < IDENTITY_POLICY.otpMaxAttempts; attempt++) {
      expect(await consume(email, wrong)).toEqual({ ok: false, reason: 'INVALID' });
    }
    expect(await consume(email, wrong)).toEqual({ ok: false, reason: 'LOCKED' });
    expect(await consume(email, code)).toEqual({ ok: false, reason: 'LOCKED' });
    const row = await db().query<{ attempts: number; consumed_at: Date | null }>(
      `SELECT attempts, consumed_at FROM otp_challenge
        WHERE destination_hash = $1 ORDER BY created_at DESC LIMIT 1`,
      [deps.hasher.destination(email)],
    );
    expect(row.rows[0]).toEqual({ attempts: 5, consumed_at: null });
  });

  it('keeps the attempt limit in the database too (C-79)', async () => {
    const email = uniqueEmail();
    await issue(email);
    await rollback(db(), () =>
      expectPgError(db(), PG.check, () =>
        db().query('UPDATE otp_challenge SET attempts = 6 WHERE destination_hash = $1', [
          deps.hasher.destination(email),
        ]),
      ),
    );
  });

  it('lets a newer code replace the older one', async () => {
    const email = uniqueEmail();
    const first = await issue(email);
    clock.advance(1000);
    const second = await issue(email);
    if (first !== second) {
      expect(await consume(email, first)).toEqual({ ok: false, reason: 'INVALID' });
    }
    expect(await consume(email, second)).toMatchObject({ ok: true });
  });

  it('lets exactly one of two simultaneous correct submissions succeed', async () => {
    for (let round = 0; round < 5; round++) {
      const email = uniqueEmail();
      const code = await issue(email);
      const results = await Promise.all([consume(email, code), consume(email, code)]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: 'INVALID' }]);
    }
  });

  describe('request throttling', () => {
    it('allows 5 requests per 15 minutes for one address and then answers RATE_LIMITED', async () => {
      const email = uniqueEmail();
      for (let i = 0; i < 5; i++) {
        expect(await request(email)).toMatchObject({ ok: true });
        clock.advance(10_000);
      }
      const sixth = await request(email);
      expect(sixth.ok).toBe(false);
      if (!sixth.ok) {
        // The first request was 50 s ago: it leaves the window in 900 - 50 s.
        expect(sixth.retryAfterSeconds).toBe(850);
      }
      const stored = await db().query<{ n: string }>(
        'SELECT count(*) AS n FROM otp_challenge WHERE destination_hash = $1',
        [deps.hasher.destination(email)],
      );
      expect(stored.rows[0]?.n).toBe('5');
    });

    it('lets the window slide', async () => {
      const email = uniqueEmail();
      for (let i = 0; i < 5; i++) await request(email);
      expect((await request(email)).ok).toBe(false);
      clock.advance(900_000 + 1000);
      expect((await request(email)).ok).toBe(true);
    });

    it('counts each address on its own, and the case of an address does not dodge the limit', async () => {
      const email = uniqueEmail();
      for (let i = 0; i < 5; i++) await request(email);
      expect((await request(email.toUpperCase())).ok).toBe(false);
      expect((await request(uniqueEmail())).ok).toBe(true);
    });

    it('allows 20 requests per hour from one IP address, whatever the addresses asked for', async () => {
      const ip = '198.51.100.20';
      for (let i = 0; i < 20; i++) {
        expect(await request(uniqueEmail(), ip)).toMatchObject({ ok: true });
      }
      const over = await request(uniqueEmail(), ip);
      expect(over.ok).toBe(false);
      expect((await request(uniqueEmail(), '198.51.100.21')).ok).toBe(true);
      expect((await request(uniqueEmail())).ok).toBe(true);
      clock.advance(3600_000 + 1000);
      expect((await request(uniqueEmail(), ip)).ok).toBe(true);
    });
  });

  describe('row-level security', () => {
    it('hides the table from a tenant: the unauthenticated flow needs the system context', async () => {
      const email = uniqueEmail();
      await issue(email);
      const seen = await withDbContext(
        api(),
        { kind: 'tenant', orgId: '', userId: '018f0000-0000-7000-8000-000000000001' },
        (tx) => tx.otpChallenge.count(),
      );
      expect(seen).toBe(0);
      const attempt = await failure(() =>
        withDbContext(
          api(),
          { kind: 'tenant', orgId: '', userId: '018f0000-0000-7000-8000-000000000001' },
          (tx) => requestLoginOtp(tx, deps, { email: uniqueEmail() }),
        ),
      );
      expect(attempt.state).toBe(PG.privilege);
    });

    it('lets the system context read and write it, as the API role', async () => {
      const email = uniqueEmail();
      await issue(email);
      expect(await asSystem((tx) => tx.otpChallenge.count())).toBeGreaterThan(0);
    });

    it('gives the API role no way to delete challenges (the worker purges them)', async () => {
      const attempt = await failure(() =>
        asSystem((tx) => tx.otpChallenge.deleteMany({ where: {} })),
      );
      expect(attempt.state).toBe(PG.privilege);
    });
  });
});
