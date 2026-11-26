import { describe, expect, it } from 'vitest';
import {
  claimOtpFailure,
  findListedSiteByCertificate,
  IDENTITY_POLICY,
  LabClaimError,
  type RequestMeta,
  requestOtp,
  startLabClaim,
  type StartLabClaimResult,
  verifyLabClaimOtp,
  type VerifyLabClaimResult,
} from '../../src/index.js';
import { CLAIM_META, type Claimant, useClaimWorld } from './labs-claims-support.js';

// I1-LAB-01 and I1-LAB-02: startLabClaim and verifyLabClaimOtp on the real schema, as the API role
// with the `system` context (the claimant is no member of the organisation they claim).

describe('lab claim: start and verify an OTP', () => {
  const w = useClaimWorld();

  const find = (certificateNo: string) =>
    findListedSiteByCertificate(w.api(), w.clock, certificateNo);
  /** Every call comes from its own address, so the per-IP limit does not couple the tests. */
  let ipCounter = 0;
  const freshMeta = () => ({
    ...CLAIM_META,
    ipAddress: `203.0.113.${String((ipCounter++ % 250) + 1)}`,
  });
  const start = (
    who: Claimant,
    siteId: string,
    meta: RequestMeta = freshMeta(),
  ): Promise<StartLabClaimResult> =>
    w.asSystem((tx) => startLabClaim(tx, w.deps, { actor: who.actor, siteId, meta }));
  const verify = (
    who: Claimant,
    claimId: string,
    code: string,
    ifMatch = 0,
  ): Promise<VerifyLabClaimResult> =>
    w.asSystem((tx) =>
      verifyLabClaimOtp(tx, w.deps, { actor: who.actor, claimId, ifMatch, code, meta: CLAIM_META }),
    );
  /** The error a call rejects with, as `{ code, status, meta }`. */
  const refused = async (work: Promise<unknown>) => {
    try {
      await work;
    } catch (error) {
      if (error instanceof LabClaimError) {
        return { code: error.code, status: error.status, meta: error.meta, error };
      }
      throw error;
    }
    return expect.fail('expected the call to be refused');
  };
  const wrong = (code: string): string => (code === '000000' ? '000001' : '000000');
  const claimRows = async (organisationId: string) =>
    (
      await w
        .db()
        .query<{ id: string; status: string; requested_by_user_id: string }>(
          'SELECT id, status, requested_by_user_id FROM lab_claim_request WHERE organisation_id = $1 ORDER BY created_at',
          [organisationId],
        )
    ).rows;
  const challengeOf = async (claimId: string) =>
    (
      await w.db().query<{
        id: string;
        purpose: string;
        attempts: number;
        consumed_at: Date | null;
        code_hash: Buffer;
        created_by_user_id: string | null;
        ip: string | null;
      }>(
        `SELECT id, purpose, attempts, consumed_at, code_hash, created_by_user_id, host(ip_address) AS ip
           FROM otp_challenge WHERE context_id = $1 ORDER BY created_at DESC, id DESC`,
        [claimId],
      )
    ).rows;

  describe('finding the lab by certificate number', () => {
    it('finds a listed site, after trimming, and nothing else', async () => {
      const lab = await w.lab();
      expect(await find(lab.certificateNo)).toEqual({ siteId: lab.siteId });
      expect(await find(`  ${lab.certificateNo}\t`)).toEqual({ siteId: lab.siteId });
      expect(await find('NO-SUCH-CERTIFICATE')).toBeNull();
      expect(await find('')).toBeNull();
      expect(await find('x'.repeat(51))).toBeNull();
      expect(await find(lab.certificateNo.toLowerCase())).toBeNull();
    });

    it('does not find a site with an expired or not VALID accreditation (OQ-205)', async () => {
      for (const accreditationStatus of ['EXPIRED', 'SUSPENDED', 'WITHDRAWN'] as const) {
        const lab = await w.lab({ accreditationStatus });
        expect(await find(lab.certificateNo), accreditationStatus).toBeNull();
      }
    });

    it('does not find a hidden or inactive site, or one of an inactive organisation', async () => {
      const hidden = await w.lab();
      await w
        .db()
        .query("UPDATE lab_site SET listing_status = 'HIDDEN' WHERE id = $1", [hidden.siteId]);
      const inactive = await w.lab();
      await w
        .db()
        .query("UPDATE lab_site SET status = 'INACTIVE' WHERE id = $1", [inactive.siteId]);
      const suspended = await w.lab();
      await w
        .db()
        .query("UPDATE organisation SET status = 'SUSPENDED' WHERE id = $1", [
          suspended.organisationId,
        ]);
      for (const lab of [hidden, inactive, suspended]) {
        expect(await find(lab.certificateNo)).toBeNull();
      }
    });

    it('does not find a certificate whose accreditation has lapsed by the clock of the test', async () => {
      const lab = await w.lab();
      expect(await find(lab.certificateNo)).not.toBeNull();
      w.clock.advance(600 * 86_400_000);
      try {
        expect(await find(lab.certificateNo)).toBeNull();
      } finally {
        w.clock.advance(-600 * 86_400_000);
      }
    });

    it('treats a number held by two listed sites as unknown, rather than guessing', async () => {
      const first = await w.lab();
      const second = await w.lab();
      const body = await w.db().query<{ id: string }>(
        `INSERT INTO accreditation_body (id, code, name, status)
         VALUES (gen_random_uuid(), 'OTHER-' || substr(md5(random()::text), 1, 8), 'Other body', 'ACTIVE')
         RETURNING id`,
      );
      await w
        .db()
        .query(
          'UPDATE accreditation SET accreditation_body_id = $1, certificate_no = $2 WHERE lab_site_id = $3',
          [body.rows[0]?.id, first.certificateNo, second.siteId],
        );
      expect(await find(first.certificateNo)).toBeNull();
    });
  });

  describe('startLabClaim', () => {
    it('opens a PENDING_OTP claim and returns the code for the NABL address, masked in the view', async () => {
      const lab = await w.lab({ email: 'Quality.Head@Example-Lab.CO.IN' });
      const who = await w.claimant();
      const result = await start(who, lab.siteId);

      expect(result.created).toBe(true);
      expect(result.delivery).toEqual({
        to: 'quality.head@example-lab.co.in',
        code: expect.stringMatching(/^\d{6}$/) as string,
        validForMinutes: 10,
      });
      expect(result.claim).toMatchObject({
        status: 'PENDING_OTP',
        method: 'EMAIL_OTP',
        otpSentTo: 'q***@***.in',
        labSite: { id: lab.siteId, siteCode: lab.sites[0]?.siteCode, name: lab.sites[0]?.name },
        reviewedAt: null,
        decisionNotes: null,
        lockVersion: 0,
      });
      const rows = await claimRows(lab.organisationId);
      expect(rows).toEqual([
        { id: result.claim.id, status: 'PENDING_OTP', requested_by_user_id: who.id },
      ]);
    });

    it('stores only a keyed hash of the code, bound to the claim and the caller', async () => {
      const lab = await w.lab();
      const who = await w.claimant();
      const { claim, delivery } = await start(who, lab.siteId, {
        ...CLAIM_META,
        ipAddress: '192.0.2.200',
      });
      const [challenge, ...others] = await challengeOf(claim.id);
      expect(others).toEqual([]);
      expect(challenge).toMatchObject({
        purpose: 'LAB_CLAIM',
        attempts: 0,
        consumed_at: null,
        created_by_user_id: who.id,
        ip: '192.0.2.200',
      });
      expect(challenge?.code_hash.length).toBe(32);
      const row = await w
        .db()
        .query<{ row: string }>(
          'SELECT row_to_json(o)::text AS row FROM otp_challenge o WHERE o.context_id = $1',
          [claim.id],
        );
      const stored = (row.rows[0]?.row ?? '') + (challenge?.code_hash.toString('latin1') ?? '');
      expect(stored).not.toContain(delivery?.code ?? 'x');
      expect(stored).not.toContain(lab.email ?? 'x');
    });

    it('leaves the organisation unclaimed and creates no membership while the claim is open (OQ-207)', async () => {
      const lab = await w.lab();
      const who = await w.claimant();
      const members = () =>
        w.db().query('SELECT 1 FROM membership WHERE organisation_id = $1', [lab.organisationId]);
      const before = (await members()).rowCount;
      await start(who, lab.siteId);
      const org = await w
        .db()
        .query<{ claim_status: string }>('SELECT claim_status FROM organisation WHERE id = $1', [
          lab.organisationId,
        ]);
      expect(org.rows[0]?.claim_status).toBe('UNCLAIMED');
      expect((await members()).rowCount).toBe(before);
    });

    it("sends a new code for the caller's open claim and returns the same claim", async () => {
      const lab = await w.lab();
      const who = await w.claimant();
      const first = await start(who, lab.siteId);
      const again = await start(who, lab.siteId);
      expect(again.created).toBe(false);
      expect(again.claim.id).toBe(first.claim.id);
      expect(again.claim.lockVersion).toBe(0);
      expect(again.delivery?.code).toMatch(/^\d{6}$/);
      expect(await claimRows(lab.organisationId)).toHaveLength(1);
      // The new code replaces the old one: exactly one open challenge, and the old code is dead.
      const challenges = await challengeOf(first.claim.id);
      expect(challenges.filter((c) => c.consumed_at === null)).toHaveLength(1);
      if (first.delivery?.code !== again.delivery?.code) {
        expect(await verify(who, first.claim.id, first.delivery?.code ?? '')).toEqual({
          ok: false,
          reason: 'INVALID',
        });
      }
      expect(await verify(who, first.claim.id, again.delivery?.code ?? '')).toMatchObject({
        ok: true,
      });
    });

    it('keeps the claim on the site it was opened with when it is started again from another site', async () => {
      const lab = await w.lab({ sites: [{}, {}] });
      const second = lab.sites[1];
      const who = await w.claimant();
      const first = await start(who, lab.siteId);
      const again = await start(who, second?.id ?? '');
      expect(again.claim.id).toBe(first.claim.id);
      expect(again.claim.labSite.id).toBe(lab.siteId);
      expect(again.delivery?.to).toBe(lab.email?.toLowerCase());
    });

    it('refuses another user while a claim is open, whoever holds it, without saying whose or how far', async () => {
      const lab = await w.lab();
      const owner = await w.claimant('owner');
      const rival = await w.claimant('rival');
      const mine = await start(owner, lab.siteId);

      const pendingOtp = await refused(start(rival, lab.siteId));
      expect(pendingOtp).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
        meta: { currentState: 'CLAIM_PENDING' },
      });

      await verify(owner, mine.claim.id, mine.delivery?.code ?? '');
      const inReview = await refused(start(rival, lab.siteId));
      expect(inReview).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        meta: { currentState: 'CLAIM_PENDING' },
      });
      expect(JSON.stringify(inReview.error)).not.toContain(owner.id);
      expect(JSON.stringify(inReview.meta)).not.toContain(mine.claim.id);
      expect(await claimRows(lab.organisationId)).toHaveLength(1);
      // The rival has no claim and received no code.
      const rows = await w
        .db()
        .query('SELECT 1 FROM lab_claim_request WHERE requested_by_user_id = $1', [rival.id]);
      expect(rows.rowCount).toBe(0);
    });

    it('tells the caller their own claim is already in review (409, currentState PENDING_REVIEW)', async () => {
      const lab = await w.lab();
      const who = await w.claimant();
      const mine = await start(who, lab.siteId);
      await verify(who, mine.claim.id, mine.delivery?.code ?? '');
      expect(await refused(start(who, lab.siteId))).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
        meta: { currentState: 'PENDING_REVIEW' },
      });
    });

    it('refuses an organisation that is already CLAIMED (409, currentState CLAIMED)', async () => {
      const lab = await w.lab({ onboarded: true });
      const who = await w.claimant();
      expect(await find(lab.certificateNo)).toEqual({ siteId: lab.siteId });
      expect(await refused(start(who, lab.siteId))).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
        meta: { currentState: 'CLAIMED' },
      });
      expect(await claimRows(lab.organisationId)).toEqual([]);
    });

    it('refuses an organisation whose claim_status is CLAIM_PENDING without an open claim', async () => {
      const lab = await w.lab();
      await w
        .db()
        .query("UPDATE organisation SET claim_status = 'CLAIM_PENDING' WHERE id = $1", [
          lab.organisationId,
        ]);
      const who = await w.claimant();
      expect(await refused(start(who, lab.siteId))).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        meta: { currentState: 'CLAIM_PENDING' },
      });
    });

    it('allows a new claim after the earlier one was rejected or expired', async () => {
      const lab = await w.lab();
      const first = await w.claimant('first');
      const second = await w.claimant('second');
      const opened = await start(first, lab.siteId);
      await w
        .db()
        .query("UPDATE lab_claim_request SET status = 'REJECTED' WHERE id = $1", [opened.claim.id]);
      const next = await start(second, lab.siteId);
      expect(next.created).toBe(true);
      expect(next.claim.id).not.toBe(opened.claim.id);
    });

    it('refuses an id that is not a listed site (the same 422 as an unknown certificate)', async () => {
      const who = await w.claimant();
      const hidden = await w.lab();
      await w
        .db()
        .query("UPDATE lab_site SET listing_status = 'HIDDEN' WHERE id = $1", [hidden.siteId]);
      for (const siteId of [hidden.siteId, '0190d6a2-7c4e-7a1b-9c3d-000000000000']) {
        expect(await refused(start(who, siteId))).toMatchObject({
          code: 'VALIDATION_FAILED',
          status: 422,
        });
      }
    });

    it('refuses platform staff (RR-5), by the actor and by the user row, and writes nothing', async () => {
      const lab = await w.lab();
      const staff = await w.staffWithoutMembership();
      const ordinary = await w.claimant();
      const asPlatformActor = { ...ordinary, actor: { ...ordinary.actor, isPlatform: true } };
      for (const who of [staff, asPlatformActor]) {
        expect(await refused(start(who, lab.siteId))).toMatchObject({
          code: 'FORBIDDEN',
          status: 403,
        });
      }
      expect(await claimRows(lab.organisationId)).toEqual([]);
      const otp = await w
        .db()
        .query(
          "SELECT 1 FROM otp_challenge WHERE purpose = 'LAB_CLAIM' AND created_by_user_id = $1",
          [staff.id],
        );
      expect(otp.rowCount).toBe(0);
    });

    it('lets two users race for one organisation: exactly one wins, the other gets 409', async () => {
      for (let round = 0; round < 6; round++) {
        const lab = await w.lab();
        const a = await w.claimant('racer-a');
        const b = await w.claimant('racer-b');
        const results = await Promise.allSettled([start(a, lab.siteId), start(b, lab.siteId)]);
        const won = results.filter((r) => r.status === 'fulfilled');
        const lost = results.filter((r) => r.status === 'rejected');
        expect(won, `round ${String(round)}`).toHaveLength(1);
        expect(lost).toHaveLength(1);
        const reason = (lost[0] as PromiseRejectedResult).reason as LabClaimError;
        expect(reason).toBeInstanceOf(LabClaimError);
        expect(reason).toMatchObject({
          code: 'INVALID_STATE_TRANSITION',
          meta: { currentState: 'CLAIM_PENDING' },
        });
        const rows = await claimRows(lab.organisationId);
        expect(rows).toHaveLength(1);
        // The loser has neither a claim nor a code.
        const loser = rows[0]?.requested_by_user_id === a.id ? b : a;
        const stray = await w
          .db()
          .query('SELECT 1 FROM otp_challenge WHERE created_by_user_id = $1', [loser.id]);
        expect(stray.rowCount).toBe(0);
      }
    });

    it('lets the same user send the request twice at once: one claim, both get a code', async () => {
      const lab = await w.lab();
      const who = await w.claimant();
      const results = await Promise.all([start(who, lab.siteId), start(who, lab.siteId)]);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect(new Set(results.map((r) => r.claim.id)).size).toBe(1);
      expect(await claimRows(lab.organisationId)).toHaveLength(1);
    });
  });

  describe('a site with no NABL address', () => {
    it('opens a MANUAL claim, sends nothing and shows no address', async () => {
      for (const email of [null, 'not-an-address', '   ']) {
        const lab = await w.lab({ email });
        const who = await w.claimant();
        const result = await start(who, lab.siteId);
        expect(result.created).toBe(true);
        expect(result.delivery).toBeNull();
        expect(result.claim).toMatchObject({
          status: 'PENDING_OTP',
          method: 'MANUAL',
          otpSentTo: null,
        });
        expect(await challengeOf(result.claim.id)).toEqual([]);
        // Starting again sends nothing either, and no code can be verified.
        const again = await start(who, lab.siteId);
        expect(again).toMatchObject({ created: false, delivery: null });
        expect(await verify(who, result.claim.id, '123456')).toEqual({
          ok: false,
          reason: 'INVALID',
        });
      }
    });
  });

  describe('limits', () => {
    it('allows 5 codes per 15 minutes per address, then 429 RATE_LIMITED, and leaves no new claim behind', async () => {
      const shared = 'shared.inbox@lab-group.example.test';
      const first = await w.lab({ email: shared });
      const second = await w.lab({ email: shared });
      const a = await w.claimant();
      const b = await w.claimant();
      await start(a, first.siteId);
      for (let i = 0; i < 4; i++) {
        expect((await start(a, first.siteId)).delivery).not.toBeNull();
      }
      const limited = await refused(start(b, second.siteId));
      expect(limited).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      expect(limited.error.retryAfterSeconds).toBeGreaterThan(0);
      expect(limited.error.retryAfterSeconds).toBeLessThanOrEqual(900);
      // The refused request left nothing: no claim for the second lab, no code.
      expect(await claimRows(second.organisationId)).toEqual([]);
      // And the owner of the open claim is limited too.
      expect(await refused(start(a, first.siteId))).toMatchObject({ code: 'RATE_LIMITED' });

      w.clock.advance(15 * 60_000 + 1_000);
      const later = await start(b, second.siteId);
      expect(later.created).toBe(true);
    });

    it('counts the per-address limit per purpose: sign-in codes do not use up claim codes', async () => {
      const lab = await w.lab();
      const who = await w.claimant();
      for (let i = 0; i < 5; i++) {
        const outcome = await w.asSystem((tx) =>
          requestOtp(tx, w.deps, { purpose: 'LOGIN', email: lab.email ?? '' }),
        );
        expect(outcome.ok).toBe(true);
      }
      expect((await start(who, lab.siteId)).created).toBe(true);
    });

    it('applies the per-IP limit of the sign-in code (20 per hour) to claim codes as well', async () => {
      const ip = '198.51.100.77';
      const who = await w.claimant();
      for (let i = 0; i < IDENTITY_POLICY.otpRequestsPerIp.max; i++) {
        const outcome = await w.asSystem((tx) =>
          requestOtp(tx, w.deps, {
            purpose: 'LOGIN',
            email: `ip-limit-${String(i)}@example.test`,
            ipAddress: ip,
          }),
        );
        expect(outcome.ok).toBe(true);
      }
      const lab = await w.lab();
      const over = await refused(
        w.asSystem((tx) =>
          startLabClaim(tx, w.deps, {
            actor: who.actor,
            siteId: lab.siteId,
            meta: { ...CLAIM_META, ipAddress: ip },
          }),
        ),
      );
      expect(over).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      expect(await claimRows(lab.organisationId)).toEqual([]);
    });
  });

  describe('verifyLabClaimOtp', () => {
    const opened = async () => {
      const lab = await w.lab();
      const who = await w.claimant();
      const result = await start(who, lab.siteId);
      return { lab, who, claim: result.claim, code: result.delivery?.code ?? '' };
    };

    it('moves the claim to PENDING_REVIEW on the right code and bumps the lock version', async () => {
      const { lab, who, claim, code } = await opened();
      const outcome = await verify(who, claim.id, code);
      expect(outcome).toMatchObject({
        ok: true,
        claim: {
          id: claim.id,
          status: 'PENDING_REVIEW',
          method: 'EMAIL_OTP',
          otpSentTo: claim.otpSentTo,
          lockVersion: 1,
        },
      });
      const rows = await w
        .db()
        .query<{ status: string; lock_version: number; reviewed_at: Date | null }>(
          'SELECT status, lock_version, reviewed_at FROM lab_claim_request WHERE id = $1',
          [claim.id],
        );
      expect(rows.rows[0]).toMatchObject({ status: 'PENDING_REVIEW', lock_version: 1 });
      expect(rows.rows[0]?.reviewed_at).toBeNull();
      expect((await challengeOf(claim.id))[0]?.consumed_at).toBeInstanceOf(Date);
      // No decision was made: the organisation is still unclaimed and nobody joined it.
      const org = await w
        .db()
        .query<{ claim_status: string }>('SELECT claim_status FROM organisation WHERE id = $1', [
          lab.organisationId,
        ]);
      expect(org.rows[0]?.claim_status).toBe('UNCLAIMED');
      const members = await w.db().query('SELECT 1 FROM membership WHERE user_id = $1', [who.id]);
      expect(members.rowCount).toBe(0);
    });

    it('is 409 INVALID_STATE_TRANSITION when the claim is not PENDING_OTP, whatever If-Match says', async () => {
      const { who, claim, code } = await opened();
      await verify(who, claim.id, code);
      for (const ifMatch of [0, 1, 7]) {
        expect(await refused(verify(who, claim.id, code, ifMatch))).toMatchObject({
          code: 'INVALID_STATE_TRANSITION',
          status: 409,
          meta: { currentState: 'PENDING_REVIEW' },
        });
      }
      for (const status of ['APPROVED', 'REJECTED', 'EXPIRED']) {
        const next = await opened();
        await w
          .db()
          .query('UPDATE lab_claim_request SET status = $1::claim_request_status WHERE id = $2', [
            status,
            next.claim.id,
          ]);
        expect(await refused(verify(next.who, next.claim.id, next.code))).toMatchObject({
          code: 'INVALID_STATE_TRANSITION',
          meta: { currentState: status },
        });
      }
    });

    it("is 404 for another user's claim and for an unknown id, with the same answer", async () => {
      const { claim, code } = await opened();
      const stranger = await w.claimant('stranger');
      const unknown = '0190d6a2-7c4e-7a1b-9c3d-000000000000';
      const foreign = await refused(verify(stranger, claim.id, code));
      const missing = await refused(verify(stranger, unknown, code));
      expect(foreign).toMatchObject({ code: 'NOT_FOUND', status: 404 });
      expect(missing).toMatchObject({ code: 'NOT_FOUND', status: 404 });
      expect(foreign.error.message).toBe(missing.error.message);
      // The stranger's attempt neither spent the code nor counted as a guess.
      const [challenge] = await challengeOf(claim.id);
      expect(challenge).toMatchObject({ attempts: 0, consumed_at: null });
      const state = await w
        .db()
        .query<{ status: string }>('SELECT status FROM lab_claim_request WHERE id = $1', [
          claim.id,
        ]);
      expect(state.rows[0]?.status).toBe('PENDING_OTP');
    });

    it('is 412 CONCURRENT_MODIFICATION when If-Match is not the lock version, before a guess is spent', async () => {
      const { who, claim, code } = await opened();
      for (const ifMatch of [1, 2, 99]) {
        expect(await refused(verify(who, claim.id, wrong(code), ifMatch))).toMatchObject({
          code: 'CONCURRENT_MODIFICATION',
          status: 412,
        });
      }
      const [challenge] = await challengeOf(claim.id);
      expect(challenge).toMatchObject({ attempts: 0, consumed_at: null });
      expect(await verify(who, claim.id, code, 0)).toMatchObject({ ok: true });
    });

    it('counts wrong codes and locks at the fifth, even for the right code afterwards', async () => {
      const { who, claim, code } = await opened();
      for (let i = 1; i <= 4; i++) {
        expect(await verify(who, claim.id, wrong(code))).toEqual({ ok: false, reason: 'INVALID' });
        expect((await challengeOf(claim.id))[0]?.attempts).toBe(i);
      }
      expect(await verify(who, claim.id, wrong(code))).toEqual({ ok: false, reason: 'LOCKED' });
      expect(await verify(who, claim.id, code)).toEqual({ ok: false, reason: 'LOCKED' });
      const state = await w
        .db()
        .query<{ status: string }>('SELECT status FROM lab_claim_request WHERE id = $1', [
          claim.id,
        ]);
      expect(state.rows[0]?.status).toBe('PENDING_OTP');
      // The way out is the contract's: start again for a new code.
      const fresh = await start(who, claim.labSite.id);
      expect(fresh.created).toBe(false);
      expect(await verify(who, claim.id, fresh.delivery?.code ?? '')).toMatchObject({ ok: true });
    });

    it('rejects an expired code (10 minutes) and accepts it just before', async () => {
      const early = await opened();
      w.clock.advance(10 * 60_000 - 1_000);
      expect(await verify(early.who, early.claim.id, early.code)).toMatchObject({ ok: true });

      const late = await opened();
      w.clock.advance(10 * 60_000 + 1_000);
      expect(await verify(late.who, late.claim.id, late.code)).toEqual({
        ok: false,
        reason: 'EXPIRED',
      });
    });

    it('does not expire a PENDING_OTP claim by itself within 24 hours: it can be continued (OQ-206; the 24-hour rule is in labs-claims-limits.test.ts)', async () => {
      const { who, claim } = await opened();
      w.clock.advance(23 * 3_600_000);
      const state = await w
        .db()
        .query<{ status: string }>('SELECT status FROM lab_claim_request WHERE id = $1', [
          claim.id,
        ]);
      expect(state.rows[0]?.status).toBe('PENDING_OTP');
      const again = await start(who, claim.labSite.id);
      expect(again).toMatchObject({ created: false });
      expect(await verify(who, claim.id, again.delivery?.code ?? '')).toMatchObject({ ok: true });
    });

    it('lets exactly one of two simultaneous correct submissions win, the other is 409', async () => {
      const { who, claim, code } = await opened();
      const results = await Promise.allSettled([
        verify(who, claim.id, code),
        verify(who, claim.id, code),
      ]);
      const won = results.filter((r) => r.status === 'fulfilled' && r.value.ok);
      expect(won).toHaveLength(1);
      const other = results.find((r) => r !== won[0]);
      expect(other?.status).toBe('rejected');
      expect((other as PromiseRejectedResult).reason).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        meta: { currentState: 'PENDING_REVIEW' },
      });
      const state = await w
        .db()
        .query<{ status: string; lock_version: number }>(
          'SELECT status, lock_version FROM lab_claim_request WHERE id = $1',
          [claim.id],
        );
      expect(state.rows[0]).toEqual({ status: 'PENDING_REVIEW', lock_version: 1 });
    });

    it('rolls the spent code back when the conditional update finds the claim changed (412)', async () => {
      const { who, claim, code } = await opened();
      // The claim changes between the checks and the update: simulated by a trigger-free change
      // of the lock version from inside the same transaction, after the code was consumed.
      const result = await refused(
        w.asSystem(async (tx) => {
          const spy = new Proxy(tx, {
            get(target, property) {
              const value: unknown = Reflect.get(target, property);
              if (property !== 'labClaimRequest') return value;
              return new Proxy(value as object, {
                get(model, name) {
                  const method: unknown = Reflect.get(model, name);
                  if (name !== 'updateMany' || typeof method !== 'function') return method;
                  return async (args: unknown) => {
                    await tx.$executeRaw`UPDATE lab_claim_request SET lock_version = lock_version + 1 WHERE id = ${claim.id}::uuid`;
                    return (method as (a: unknown) => Promise<unknown>).call(model, args);
                  };
                },
              });
            },
          });
          return verifyLabClaimOtp(spy, w.deps, {
            actor: who.actor,
            claimId: claim.id,
            ifMatch: 0,
            code,
            meta: CLAIM_META,
          });
        }),
      );
      expect(result).toMatchObject({ code: 'CONCURRENT_MODIFICATION', status: 412 });
      // Nothing was saved: the code is still usable and the claim unchanged.
      const [challenge] = await challengeOf(claim.id);
      expect(challenge).toMatchObject({ consumed_at: null });
      expect(await verify(who, claim.id, code)).toMatchObject({ ok: true });
    });

    it('maps each rejected code to its catalogued error', () => {
      expect(claimOtpFailure('INVALID')).toMatchObject({ code: 'OTP_INVALID', status: 422 });
      expect(claimOtpFailure('EXPIRED')).toMatchObject({ code: 'OTP_EXPIRED', status: 422 });
      expect(claimOtpFailure('LOCKED')).toMatchObject({ code: 'OTP_LOCKED', status: 429 });
    });
  });

  describe('audit and events', () => {
    const everythingAbout = async (claimId: string): Promise<string> => {
      const audit = await w
        .db()
        .query<{ row: string }>(
          'SELECT row_to_json(a)::text AS row FROM audit_log a WHERE a.entity_id = $1 ORDER BY a.occurred_at, a.id',
          [claimId],
        );
      const outbox = await w
        .db()
        .query<{ row: string }>(
          'SELECT row_to_json(o)::text AS row FROM outbox_event o WHERE o.aggregate_id = $1 ORDER BY o.occurred_at, o.id',
          [claimId],
        );
      return [...audit.rows, ...outbox.rows].map((r) => r.row).join('\n');
    };

    it('records the start and the verification with ids and states only: no address, no code', async () => {
      const lab = await w.lab({ email: 'secret.person@private-lab.example.test' });
      const who = await w.claimant();
      // The clock moves between steps so the rows have a defined order (ids are time-ordered).
      const started = await start(who, lab.siteId);
      const code = started.delivery?.code ?? '';
      w.clock.advance(1_000);
      await start(who, lab.siteId);
      w.clock.advance(1_000);
      const wrongTry = await verify(who, started.claim.id, wrong(code));
      expect(wrongTry.ok).toBe(false);
      w.clock.advance(1_000);
      const final = await start(who, lab.siteId);
      w.clock.advance(1_000);
      await verify(who, started.claim.id, final.delivery?.code ?? '');

      const audit = await w
        .db()
        .query<{ action: string; actor_user_id: string; request_id: string; after: unknown }>(
          'SELECT action, actor_user_id, request_id, after FROM audit_log WHERE entity_id = $1 ORDER BY occurred_at, id',
          [started.claim.id],
        );
      expect(audit.rows.map((row) => row.action)).toEqual([
        'lab_claim.start',
        'lab_claim.code_resend',
        'lab_claim.code_resend',
        'lab_claim.verify_otp',
      ]);
      for (const row of audit.rows) {
        expect(row.actor_user_id).toBe(who.id);
        expect(row.request_id).toBe(CLAIM_META.requestId);
      }
      expect(audit.rows[0]?.after).toEqual({
        status: 'PENDING_OTP',
        method: 'EMAIL_OTP',
        labSiteId: lab.siteId,
        organisationId: lab.organisationId,
        codeSent: true,
      });

      const events = await w
        .db()
        .query<{ event_type: string; aggregate_type: string; payload: unknown }>(
          'SELECT event_type, aggregate_type, payload FROM outbox_event WHERE aggregate_id = $1 ORDER BY occurred_at, id',
          [started.claim.id],
        );
      expect(events.rows.map((row) => row.event_type)).toEqual([
        'lab_claim.started',
        'lab_claim.pending_review',
      ]);
      expect(events.rows[1]?.payload).toEqual({
        actor: { userId: who.id },
        data: {
          claimId: started.claim.id,
          organisationId: lab.organisationId,
          labSiteId: lab.siteId,
          status: 'PENDING_REVIEW',
        },
      });

      const text = await everythingAbout(started.claim.id);
      expect(text).not.toContain('secret.person');
      expect(text).not.toContain('private-lab');
      for (const delivered of [code, final.delivery?.code ?? '']) {
        expect(text).not.toMatch(new RegExp(`["\\s:]${delivered}["\\s,}]`));
      }
    });

    it('writes nothing for a refused or rolled-back start', async () => {
      const lab = await w.lab();
      const who = await w.claimant();
      const rival = await w.claimant();
      await start(who, lab.siteId);
      const before = await w
        .db()
        .query<{ n: string }>('SELECT count(*) AS n FROM audit_log WHERE actor_user_id = $1', [
          rival.id,
        ]);
      await refused(start(rival, lab.siteId));
      const after = await w
        .db()
        .query<{ n: string }>('SELECT count(*) AS n FROM audit_log WHERE actor_user_id = $1', [
          rival.id,
        ]);
      expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    });
  });
});
