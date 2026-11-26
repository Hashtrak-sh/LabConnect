import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type ClaimDeps,
  consumeLoginOtp,
  type IdentityDeps,
  IDENTITY_POLICY,
  isPlatformStaff,
  type OtpConsumeOutcome,
  parseDemoOtpSettings,
  requestLoginOtp,
  signInWithVerifiedEmail,
  startLabClaim,
  type StartLabClaimResult,
  verifyLabClaimOtp,
} from '../../src/index.js';
import { createCustomer, createPlatformTeam, createUser, META } from './identity-support.js';
import { CLAIM_META, type Claimant, useClaimWorld } from './labs-claims-support.js';

// Demo one-time codes (UAT only): the fixed code of demo destinations, and everything that must
// stay as it is. The setting is passed through the dependencies, as the API does after it has
// validated the environment.

const CODE = '444444';
const DEMO_DOMAIN = 'demo.labconnect.test';
const demoOtp = parseDemoOtpSettings({ DEMO_OTP_CODE: CODE });
if (demoOtp === undefined) throw new Error('the demo setting must parse');

const label = (): string => randomBytes(4).toString('hex');
const demoEmail = (name = 'demo'): string => `${name}.${label()}@${DEMO_DOMAIN}`;

describe('demo one-time codes', () => {
  const w = useClaimWorld();
  const on: IdentityDeps = { ...w.deps, demoOtp };
  const onClaims: ClaimDeps = { ...w.deps, demoOtp };
  const off: IdentityDeps = w.deps;

  let ipCounter = 0;
  const freshIp = (): string =>
    `198.18.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
  const user = (email: string, platformStaff = false): Promise<string> =>
    w.owner((tx) => createUser(tx, { email, fullName: 'DEMO user', platformStaff }));
  const request = (deps: IdentityDeps, email: string, ipAddress = freshIp()) =>
    w.asSystem((tx) => requestLoginOtp(tx, deps, { email, ipAddress }));
  const issued = async (deps: IdentityDeps, email: string) => {
    const outcome = await request(deps, email);
    if (!outcome.ok) throw new Error('throttled');
    return outcome;
  };
  const consume = (email: string, code: string): Promise<OtpConsumeOutcome> =>
    w.asSystem((tx) => consumeLoginOtp(tx, on, { email, code }));
  const wrong = (code: string): string => (code === '000000' ? '000001' : '000000');
  const challenge = async (id: string) =>
    (
      await w
        .db()
        .query<{ code_hash: Buffer; attempts: number }>(
          'SELECT code_hash, attempts FROM otp_challenge WHERE id = $1',
          [id],
        )
    ).rows[0];
  const auditRows = async (entityId: string) =>
    (
      await w
        .db()
        .query<{ action: string; after: unknown; before: unknown; reason: string | null }>(
          'SELECT action, after, before, reason FROM audit_log WHERE entity_id = $1 ORDER BY occurred_at',
          [entityId],
        )
    ).rows;

  describe('with the setting absent (the default)', () => {
    it('gives a demo-domain user a random code, marks nothing, and writes no audit row', async () => {
      const email = demoEmail();
      await user(email);
      const outcome = await issued(off, email);
      expect('demo' in outcome).toBe(false);
      expect(outcome.code).toMatch(/^\d{6}$/);
      // Not the fixed code: the stored hash is the hash of the random one.
      const row = await challenge(outcome.challengeId);
      expect(
        Buffer.compare(
          row?.code_hash ?? Buffer.alloc(0),
          Buffer.from(off.hasher.otpCode(outcome.challengeId, outcome.code)),
        ),
      ).toBe(0);
      expect(
        Buffer.compare(
          row?.code_hash ?? Buffer.alloc(0),
          Buffer.from(off.hasher.otpCode(outcome.challengeId, CODE)),
        ),
      ).not.toBe(0);
      expect(await auditRows(outcome.challengeId)).toEqual([]);
      // 444444 opens nothing, and five tries lock the code.
      expect(await consume(email, CODE === outcome.code ? wrong(CODE) : CODE)).toEqual({
        ok: false,
        reason: 'INVALID',
      });
    });

    it('does the same for the lab claim code of a demo-domain site', async () => {
      const lab = await w.lab({ email: `site.${label()}@${DEMO_DOMAIN}` });
      const who = await w.claimant();
      const started = await w.asSystem((tx) =>
        startLabClaim(tx, w.deps, {
          actor: who.actor,
          siteId: lab.siteId,
          meta: { ...CLAIM_META, ipAddress: freshIp() },
        }),
      );
      expect(started.delivery).not.toBeNull();
      expect(started.delivery).not.toHaveProperty('demo');
      expect(started.delivery?.to).toBe(lab.email);
      const rows = await auditRows(started.claim.id);
      expect(rows[0]?.after).not.toHaveProperty('demoCode');
    });
  });

  describe('sign-in code of a demo user', () => {
    it('is the fixed code, stored only as a keyed hash, and is single use', async () => {
      const email = demoEmail();
      await user(email);
      const outcome = await issued(on, email);
      expect(outcome).toMatchObject({ ok: true, code: CODE, demo: true });
      const row = await challenge(outcome.challengeId);
      expect(
        Buffer.compare(
          row?.code_hash ?? Buffer.alloc(0),
          Buffer.from(on.hasher.otpCode(outcome.challengeId, CODE)),
        ),
      ).toBe(0);
      const stored = await w
        .db()
        .query('SELECT * FROM otp_challenge WHERE id = $1', [outcome.challengeId]);
      expect(JSON.stringify(stored.rows[0])).not.toContain(CODE);
      expect(await consume(email, CODE)).toMatchObject({ ok: true });
      expect(await consume(email, CODE)).toEqual({ ok: false, reason: 'INVALID' });
    });

    it('works in any letter case and with surrounding spaces, as the normalisation allows', async () => {
      const email = demoEmail('Mixed.Case');
      await user(email.toLowerCase());
      const outcome = await issued(on, `  ${email.toUpperCase()} `);
      expect(outcome).toMatchObject({ code: CODE, demo: true });
      expect(await consume(email, CODE)).toMatchObject({ ok: true });
    });

    it('is marked in an audit entry that holds the flag and the purpose, never the code or the address', async () => {
      const email = demoEmail();
      const id = await user(email);
      const outcome = await issued(on, email);
      const rows = await auditRows(outcome.challengeId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'auth.otp_request',
        after: { purpose: 'LOGIN', demoCode: true },
      });
      const text = JSON.stringify(rows);
      expect(text).not.toContain(CODE);
      expect(text).not.toContain(email);
      const actor = await w
        .db()
        .query<{ actor_user_id: string }>(
          'SELECT actor_user_id FROM audit_log WHERE entity_id = $1',
          [outcome.challengeId],
        );
      expect(actor.rows[0]?.actor_user_id).toBe(id);
    });

    it('does not apply to an address of a user who is not in the demo domain (platform staff included)', async () => {
      const staff = `ops.${label()}@labconnect.in`;
      const customer = `someone.${label()}@example.test`;
      await user(staff, true);
      await user(customer);
      for (const email of [staff, customer]) {
        const outcome = await issued(on, email);
        expect('demo' in outcome).toBe(false);
        expect(outcome.code).toMatch(/^\d{6}$/);
        expect(await auditRows(outcome.challengeId)).toEqual([]);
        expect(await consume(email, outcome.code === CODE ? wrong(CODE) : CODE)).toEqual({
          ok: false,
          reason: 'INVALID',
        });
      }
    });

    it('does not apply to near misses of the domain, even for users that exist at those addresses', async () => {
      const near = [
        `x.${label()}@sub.${DEMO_DOMAIN}`,
        `x.${label()}@${DEMO_DOMAIN}.evil.example`,
        `x.${label()}@evil${DEMO_DOMAIN}`,
        `x.${label()}@labconnect.test`,
        `x.${label()}@${DEMO_DOMAIN}.`,
      ];
      for (const email of near) {
        await user(email);
        const outcome = await issued(on, email);
        expect('demo' in outcome, email).toBe(false);
        expect(await auditRows(outcome.challengeId)).toEqual([]);
        expect(await consume(email, outcome.code === CODE ? wrong(CODE) : CODE), email).toEqual({
          ok: false,
          reason: 'INVALID',
        });
      }
    });

    it('does not apply to an address that has no account: nobody can mint a demo-domain account with the fixed code', async () => {
      const email = demoEmail('nobody');
      const outcome = await issued(on, email);
      expect('demo' in outcome).toBe(false);
      expect(await consume(email, outcome.code === CODE ? wrong(CODE) : CODE)).toEqual({
        ok: false,
        reason: 'INVALID',
      });
      const users = await w
        .db()
        .query<{ n: string }>('SELECT count(*) AS n FROM app_user WHERE email = $1', [email]);
      expect(users.rows[0]?.n).toBe('0');
      // And a seeded address is not available to be taken first through sign-in either.
      const signIn = await w.asSystem(async (tx) => {
        const consumed = await consumeLoginOtp(tx, on, { email, code: CODE });
        return consumed.ok ? signInWithVerifiedEmail(tx, on, { email, meta: META }) : consumed;
      });
      expect(signIn).toEqual({ ok: false, reason: 'INVALID' });
    });

    it('keeps the attempt lockout: five wrong guesses lock the code although the right one is known', async () => {
      const email = demoEmail();
      await user(email);
      await issued(on, email);
      for (let attempt = 1; attempt < IDENTITY_POLICY.otpMaxAttempts; attempt++) {
        expect(await consume(email, wrong(CODE))).toEqual({ ok: false, reason: 'INVALID' });
      }
      expect(await consume(email, wrong(CODE))).toEqual({ ok: false, reason: 'LOCKED' });
      expect(await consume(email, CODE)).toEqual({ ok: false, reason: 'LOCKED' });
      // A new request replaces the locked code and the fixed code works again.
      await issued(on, email);
      expect(await consume(email, CODE)).toMatchObject({ ok: true });
    });

    it('keeps the expiry: the fixed code stops working after 10 minutes', async () => {
      const email = demoEmail();
      await user(email);
      await issued(on, email);
      w.clock.advance(IDENTITY_POLICY.otpTtlSeconds * 1000 + 1000);
      expect(await consume(email, CODE)).toEqual({ ok: false, reason: 'EXPIRED' });
    });

    it('keeps the request limits: 5 per 15 minutes per destination, 20 per hour per IP', async () => {
      const email = demoEmail();
      await user(email);
      for (let i = 0; i < IDENTITY_POLICY.otpRequestsPerDestination.max; i++)
        await issued(on, email);
      const sixth = await request(on, email);
      expect(sixth).toMatchObject({ ok: false, reason: 'RATE_LIMITED' });
      const stored = await w
        .db()
        .query<{ n: string }>(
          `SELECT count(*) AS n FROM otp_challenge WHERE purpose = 'LOGIN' AND destination_hash = $1`,
          [Buffer.from(on.hasher.destination(email))],
        );
      expect(stored.rows[0]?.n).toBe('5');

      const ip = freshIp();
      const emails = Array.from({ length: IDENTITY_POLICY.otpRequestsPerIp.max + 1 }, () =>
        demoEmail('ip'),
      );
      await w.owner(async (tx) => {
        for (const address of emails)
          await createUser(tx, { email: address, fullName: 'DEMO user' });
      });
      for (const address of emails.slice(0, IDENTITY_POLICY.otpRequestsPerIp.max)) {
        expect(await request(on, address, ip)).toMatchObject({ ok: true, demo: true });
      }
      expect(
        await request(on, emails[IDENTITY_POLICY.otpRequestsPerIp.max] ?? '', ip),
      ).toMatchObject({
        ok: false,
        reason: 'RATE_LIMITED',
      });
    });
  });

  describe('the authenticator step is untouched', () => {
    const signIn = (email: string) =>
      w.asSystem(async (tx) => {
        const issuedCode = await requestLoginOtp(tx, on, { email, ipAddress: freshIp() });
        if (!issuedCode.ok) throw new Error('throttled');
        const consumed = await consumeLoginOtp(tx, on, { email, code: CODE });
        if (!consumed.ok) throw new Error('the fixed code was refused');
        return signInWithVerifiedEmail(tx, on, { email, meta: META });
      });
    const emailOf = async (userId: string): Promise<string> =>
      (await w.db().query<{ email: string }>('SELECT email FROM app_user WHERE id = $1', [userId]))
        .rows[0]?.email ?? '';

    it('gives a demo Checker only a partial session, without a refresh token', async () => {
      const lab = await w.lab({ onboarded: true, checkers: 1, makers: 1 });
      const email = await emailOf(lab.checkers[0] ?? '');
      expect(email.endsWith(`@${DEMO_DOMAIN}`)).toBe(true);
      const outcome = await signIn(email);
      expect(outcome).toMatchObject({ ok: true, mfaRequired: true, mfaEnrolled: false });
      if (outcome.ok) expect(outcome.issued.refreshToken).toBeNull();
    });

    it('gives every demo platform role, and the demo customer finance user, a partial session', async () => {
      const team = await w.owner((tx) => createPlatformTeam(tx));
      const customer = await w.owner((tx) => createCustomer(tx));
      for (const id of [team.ops, team.steward, team.finance, team.admin, customer.finance ?? '']) {
        const email = await emailOf(id);
        expect(email.endsWith(`@${DEMO_DOMAIN}`)).toBe(true);
        expect(await signIn(email), email).toMatchObject({ ok: true, mfaRequired: true });
      }
      expect(await w.asSystem((tx) => isPlatformStaff(tx, team.ops))).toBe(true);
    });

    it('lets a demo Maker and a demo customer admin in without it, as the roles say', async () => {
      const lab = await w.lab({ onboarded: true, checkers: 1, makers: 1 });
      const customer = await w.owner((tx) => createCustomer(tx));
      for (const id of [lab.makers[0] ?? '', customer.admin]) {
        expect(await signIn(await emailOf(id))).toMatchObject({ ok: true, mfaRequired: false });
      }
    });
  });

  describe('lab claim code of a demo lab site', () => {
    let claimIp = 0;
    const start = (
      who: Claimant,
      siteId: string,
      deps: ClaimDeps = onClaims,
    ): Promise<StartLabClaimResult> =>
      w.asSystem((tx) =>
        startLabClaim(tx, deps, {
          actor: who.actor,
          siteId,
          meta: {
            ...CLAIM_META,
            ipAddress: `198.19.${String(Math.floor(claimIp / 250))}.${String((claimIp++ % 250) + 1)}`,
          },
        }),
      );
    const verify = (who: Claimant, claimId: string, code: string, ifMatch = 0) =>
      w.asSystem((tx) =>
        verifyLabClaimOtp(tx, onClaims, {
          actor: who.actor,
          claimId,
          ifMatch,
          code,
          meta: CLAIM_META,
        }),
      );

    it('is the fixed code, not mailed (marked demo), recorded in the claim audit entry, and verifies', async () => {
      const lab = await w.lab({ email: `site.${label()}@${DEMO_DOMAIN}` });
      const who = await w.claimant();
      const started = await start(who, lab.siteId);
      expect(started.delivery).toMatchObject({ code: CODE, demo: true });
      const rows = await auditRows(started.claim.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'lab_claim.start',
        after: { codeSent: true, demoCode: true },
      });
      expect(JSON.stringify(rows)).not.toContain(CODE);
      expect(JSON.stringify(rows)).not.toContain(lab.email ?? 'no-address');
      const result = await verify(who, started.claim.id, CODE);
      expect(result).toMatchObject({ ok: true, claim: { status: 'PENDING_REVIEW' } });
    });

    it('keeps the lockout: five wrong guesses lock the claim code although the right one is known', async () => {
      const lab = await w.lab({ email: `site.${label()}@${DEMO_DOMAIN}` });
      const who = await w.claimant();
      const started = await start(who, lab.siteId);
      for (let attempt = 1; attempt < IDENTITY_POLICY.otpMaxAttempts; attempt++) {
        expect(await verify(who, started.claim.id, wrong(CODE))).toEqual({
          ok: false,
          reason: 'INVALID',
        });
      }
      expect(await verify(who, started.claim.id, wrong(CODE))).toEqual({
        ok: false,
        reason: 'LOCKED',
      });
      expect(await verify(who, started.claim.id, CODE)).toEqual({ ok: false, reason: 'LOCKED' });
    });

    it('keeps the per-destination limit: the sixth code for the claim is refused', async () => {
      const lab = await w.lab({ email: `site.${label()}@${DEMO_DOMAIN}` });
      const who = await w.claimant();
      for (let i = 0; i < IDENTITY_POLICY.otpRequestsPerDestination.max; i++) {
        expect((await start(who, lab.siteId)).delivery?.demo).toBe(true);
      }
      await expect(start(who, lab.siteId)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    });

    it.each([
      ['a real NABL address', () => `qa.${label()}@nabl-lab.co.in`],
      ['a subdomain of the demo domain', () => `site.${label()}@lab.${DEMO_DOMAIN}`],
      [
        'a look-alike that ends in the demo domain',
        () => `site.${label()}@${DEMO_DOMAIN}.evil.example`,
      ],
      ['a look-alike that starts with it', () => `site.${label()}@evil-${DEMO_DOMAIN}`],
      ['the demo domain with a trailing dot', () => `site.${label()}@${DEMO_DOMAIN}.`],
    ])('is not applied to %s: a random code, mailed, no demo mark', async (_name, address) => {
      const to = address();
      const lab = await w.lab({ email: to });
      // Only a plausible stored address is used for a claim; the trailing-dot address is not one.
      const who = await w.claimant();
      const started = await start(who, lab.siteId);
      const rows = await auditRows(started.claim.id);
      expect(rows[0]?.after).not.toHaveProperty('demoCode');
      if (started.delivery === null) return;
      expect(started.delivery).not.toHaveProperty('demo');
      expect(started.delivery.to).toBe(to);
      const row = await w
        .db()
        .query<{ code_hash: Buffer }>('SELECT code_hash FROM otp_challenge WHERE context_id = $1', [
          started.claim.id,
        ]);
      const stored = Buffer.from(row.rows[0]?.code_hash ?? []);
      expect(stored.length).toBe(32);
      if (started.delivery.code !== CODE) {
        expect(
          Buffer.compare(
            stored,
            Buffer.from(on.hasher.otpCode(await challengeIdOf(started.claim.id), CODE)),
          ),
        ).not.toBe(0);
      }
    });

    const challengeIdOf = async (claimId: string): Promise<string> =>
      (
        await w
          .db()
          .query<{ id: string }>(
            'SELECT id FROM otp_challenge WHERE context_id = $1 ORDER BY created_at DESC LIMIT 1',
            [claimId],
          )
      ).rows[0]?.id ?? '';
  });
});
