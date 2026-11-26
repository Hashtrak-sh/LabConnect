import { type ScanStatus, withDbContext } from '@labconnect/database';
import { describe, expect, it } from 'vitest';
import {
  AuditService,
  CLAIM_LIMITS,
  claimExpiredError,
  FileService,
  type FilesConfig,
  InMemoryObjectStorage,
  LabClaimError,
  type LetterheadDeps,
  OutboxService,
  type RequestMeta,
  requestClaimLetterheadUpload,
  startLabClaim,
  type StartLabClaimResult,
  submitLabClaimLetterhead,
  verifyLabClaimOtp,
  type VerifyLabClaimResult,
} from '../../src/index.js';
import { CLAIM_META, type Claimant, useClaimWorld } from './labs-claims-support.js';

// I1-LAB-06: the three abuse limits of the lab claim flow, on the real schema, as the API role with
// the `system` context. 24-hour expiry of an unverified claim, 3 open claims per person, 5
// letterhead uploads per claim. The numbers come from CLAIM_LIMITS; the tests use the constants so
// that a change of a number is a one-line change, but every boundary is tested to the millisecond.

const TTL = CLAIM_LIMITS.unverifiedClaimTtlMs;
const MAX_OPEN = CLAIM_LIMITS.maxOpenClaimsPerUser;
const MAX_UPLOADS = CLAIM_LIMITS.maxLetterheadUploadsPerClaim;
const FILE_NAME = 'Letter from Asha Rao - private.pdf';
const files: FilesConfig = {
  bucket: 'labconnect-test',
  quarantinePrefix: 'quarantine',
  cleanPrefix: 'clean',
};

describe('lab claim: abuse limits (I1-LAB-06)', () => {
  const w = useClaimWorld();
  const fileService = new FileService({
    clock: w.clock,
    audit: new AuditService(w.clock),
    outbox: new OutboxService(w.clock),
    storage: new InMemoryObjectStorage(w.clock),
    config: () => files,
  });
  const deps: LetterheadDeps = { ...w.deps, files: fileService };

  let ipCounter = 0;
  const freshMeta = (): RequestMeta => ({
    ...CLAIM_META,
    ipAddress: `192.0.2.${String((ipCounter++ % 250) + 1)}`,
  });
  const start = (who: Claimant, siteId: string): Promise<StartLabClaimResult> =>
    w.asSystem((tx) => startLabClaim(tx, w.deps, { actor: who.actor, siteId, meta: freshMeta() }));
  /** The outcome of the function itself: a committed refusal is a value, not a throw. */
  const verifyOutcome = (
    who: Claimant,
    claimId: string,
    code: string,
    ifMatch = 0,
  ): Promise<VerifyLabClaimResult> =>
    w.asSystem((tx) =>
      verifyLabClaimOtp(tx, w.deps, { actor: who.actor, claimId, ifMatch, code, meta: CLAIM_META }),
    );
  const uploadOutcome = (who: Claimant, claimId: string, over: { contentType?: string } = {}) =>
    w.asSystem((tx) =>
      requestClaimLetterheadUpload(tx, deps, {
        actor: who.actor,
        claimId,
        contentType: over.contentType ?? 'application/pdf',
        sizeBytes: 182_044,
        fileName: FILE_NAME,
        meta: CLAIM_META,
      }),
    );
  /** As the API service does: the committed outcome of a stale claim is raised afterwards. */
  const upload = async (who: Claimant, claimId: string, over: { contentType?: string } = {}) => {
    const outcome = await uploadOutcome(who, claimId, over);
    if (!outcome.ok) throw claimExpiredError();
    return outcome.ticket;
  };
  const submitOutcome = (who: Claimant, claimId: string, fileId: string, ifMatch = 0) =>
    w.asSystem((tx) =>
      submitLabClaimLetterhead(tx, deps, {
        actor: who.actor,
        claimId,
        ifMatch,
        fileId,
        meta: CLAIM_META,
      }),
    );
  const settle = (fileId: string, status: ScanStatus) =>
    withDbContext(w.worker(), { kind: 'system' }, (tx) =>
      tx.fileObject.update({
        where: { id: fileId },
        data:
          status === 'CLEAN'
            ? {
                scanStatus: 'CLEAN',
                sha256: new Uint8Array(32).fill(7),
                detectedContentType: 'application/pdf',
              }
            : { scanStatus: status },
      }),
    );
  const refused = async (work: Promise<unknown>) => {
    type Refusal = Error & {
      code: string;
      status: number;
      meta?: unknown;
      detail?: string;
      retryAfterSeconds?: number;
    };
    try {
      await work;
    } catch (error) {
      if (error instanceof LabClaimError) {
        return {
          code: error.code,
          status: error.status,
          meta: error.meta,
          error: error as Refusal,
        };
      }
      if (error instanceof Error && 'code' in error && 'status' in error) {
        const known = error as Refusal;
        return { code: known.code, status: known.status, meta: known.meta, error: known };
      }
      throw error;
    }
    return expect.fail('expected the call to be refused');
  };
  const rowOf = async (claimId: string) =>
    (
      await w.db().query<{
        status: string;
        lock_version: number;
        authorisation_file_id: string | null;
        requested_by_user_id: string;
      }>('SELECT status, lock_version, authorisation_file_id, requested_by_user_id FROM lab_claim_request WHERE id = $1', [claimId])
    ).rows[0];
  const claimsOf = async (organisationId: string) =>
    (
      await w
        .db()
        .query<{ id: string; status: string; requested_by_user_id: string }>(
          'SELECT id, status, requested_by_user_id FROM lab_claim_request WHERE organisation_id = $1 ORDER BY created_at, id',
          [organisationId],
        )
    ).rows;
  const challengeOf = async (claimId: string) =>
    (
      await w
        .db()
        .query<{ attempts: number; consumed_at: Date | null }>(
          'SELECT attempts, consumed_at FROM otp_challenge WHERE context_id = $1 ORDER BY created_at, id',
          [claimId],
        )
    ).rows;
  const linkCount = async (claimId: string) =>
    Number(
      (
        await w
          .db()
          .query<{ n: string }>(
            "SELECT count(*) AS n FROM file_link WHERE entity_type = 'lab_claim_request' AND entity_id = $1 AND role = 'CLAIM_LETTERHEAD'",
            [claimId],
          )
      ).rows[0]?.n,
    );
  const uploadedFileCount = async (userId: string) =>
    Number(
      (
        await w
          .db()
          .query<{ n: string }>(
            'SELECT count(*) AS n FROM file_object WHERE uploaded_by_user_id = $1',
            [userId],
          )
      ).rows[0]?.n,
    );
  const auditActions = async (claimId: string) =>
    (
      await w
        .db()
        .query<{ action: string }>(
          'SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY occurred_at, id',
          [claimId],
        )
    ).rows.map((row) => row.action);
  const openClaim = async (label = 'claimant') => {
    const lab = await w.lab();
    const who = await w.claimant(label);
    const started = await start(who, lab.siteId);
    return {
      lab,
      who,
      claim: started.claim,
      claimId: started.claim.id,
      code: started.delivery?.code ?? '',
    };
  };
  /** Runs `work` and puts the shared clock back, so tests do not move each other's time. */
  const withClock = async <T>(work: (t0: number) => Promise<T>): Promise<T> => {
    const saved = w.clock.now().getTime();
    try {
      return await work(saved);
    } finally {
      w.clock.set(saved);
    }
  };

  describe('rule 1: an unverified claim expires after 24 hours', () => {
    it('keeps a claim one millisecond short of 24 hours and expires it at exactly 24 hours (inclusive)', async () => {
      await withClock(async (t0) => {
        const { who, lab, claim, claimId } = await openClaim();
        w.clock.set(t0 + TTL - 1);
        const resent = await start(who, lab.siteId);
        expect(resent).toMatchObject({ created: false });
        expect(resent.claim.id).toBe(claimId);
        expect(await rowOf(claimId)).toMatchObject({ status: 'PENDING_OTP', lock_version: 0 });

        w.clock.set(t0 + TTL);
        const replaced = await start(who, lab.siteId);
        // The caller's own stale claim gets a new claim, not a new code on the old one.
        expect(replaced.created).toBe(true);
        expect(replaced.claim.id).not.toBe(claim.id);
        expect(replaced.claim).toMatchObject({ status: 'PENDING_OTP', lockVersion: 0 });
        expect(await rowOf(claimId)).toMatchObject({ status: 'EXPIRED', lock_version: 1 });
        expect(await claimsOf(lab.organisationId)).toEqual([
          { id: claimId, status: 'EXPIRED', requested_by_user_id: who.id },
          { id: replaced.claim.id, status: 'PENDING_OTP', requested_by_user_id: who.id },
        ]);
        // The new code is bound to the new claim only.
        expect(await challengeOf(replaced.claim.id)).toHaveLength(1);
        expect(await auditActions(claimId)).toContain('lab_claim.expire');
      });
    });

    it('no longer blocks another person: 409 one millisecond before 24 hours, a new claim (created) at 24 hours', async () => {
      await withClock(async (t0) => {
        const { lab, claimId } = await openClaim('owner');
        const rival = await w.claimant('rival');
        w.clock.set(t0 + TTL - 1);
        expect(await refused(start(rival, lab.siteId))).toMatchObject({
          code: 'INVALID_STATE_TRANSITION',
          meta: { currentState: 'CLAIM_PENDING' },
        });
        expect(await rowOf(claimId)).toMatchObject({ status: 'PENDING_OTP', lock_version: 0 });

        w.clock.set(t0 + TTL);
        const next = await start(rival, lab.siteId);
        expect(next.created).toBe(true);
        expect(next.claim.id).not.toBe(claimId);
        expect(await rowOf(claimId)).toMatchObject({ status: 'EXPIRED', lock_version: 1 });
        const rows = await claimsOf(lab.organisationId);
        expect(rows.filter((r) => r.status === 'PENDING_OTP')).toHaveLength(1);
      });
    });

    it('verify on the own stale claim: 409 EXPIRED, and the expiry is committed with the refused request', async () => {
      await withClock(async (t0) => {
        const { who, claimId, code } = await openClaim();
        w.clock.set(t0 + TTL);
        // The function returns the refusal (as for a spent attempt) instead of throwing, so the
        // transaction commits; the API then raises 409 with currentState EXPIRED.
        const outcome = await verifyOutcome(who, claimId, code);
        expect(outcome).toEqual({ ok: false, reason: 'CLAIM_EXPIRED' });
        expect(await rowOf(claimId)).toMatchObject({ status: 'EXPIRED', lock_version: 1 });
        expect(await auditActions(claimId)).toEqual(['lab_claim.start', 'lab_claim.expire']);
        // The code was not consumed and no attempt was spent.
        expect(await challengeOf(claimId)).toEqual([{ attempts: 0, consumed_at: null }]);
        // From now on the claim is simply EXPIRED, whatever the code and If-Match say.
        for (const ifMatch of [0, 1]) {
          expect(await refused(verifyOutcome(who, claimId, code, ifMatch))).toMatchObject({
            code: 'INVALID_STATE_TRANSITION',
            status: 409,
            meta: { currentState: 'EXPIRED' },
          });
        }
        expect(await challengeOf(claimId)).toEqual([{ attempts: 0, consumed_at: null }]);
        expect(claimExpiredError()).toMatchObject({
          code: 'INVALID_STATE_TRANSITION',
          status: 409,
          meta: { currentState: 'EXPIRED' },
        });
      });
    });

    it('verify one millisecond before 24 hours still works on a fresh code', async () => {
      await withClock(async (t0) => {
        const { who, lab, claimId } = await openClaim();
        w.clock.set(t0 + TTL - 1);
        const again = await start(who, lab.siteId);
        expect(await verifyOutcome(who, claimId, again.delivery?.code ?? '')).toMatchObject({
          ok: true,
        });
      });
    });

    it('upload URL on the own stale claim: 409 EXPIRED, the expiry is committed and no file is made', async () => {
      await withClock(async (t0) => {
        const { who, claimId } = await openClaim();
        const first = await upload(who, claimId);
        w.clock.set(t0 + TTL - 1);
        await upload(who, claimId);
        w.clock.set(t0 + TTL);
        expect(await uploadOutcome(who, claimId)).toEqual({ ok: false, reason: 'CLAIM_EXPIRED' });
        expect(await rowOf(claimId)).toMatchObject({ status: 'EXPIRED', lock_version: 1 });
        expect(await uploadedFileCount(who.id)).toBe(2);
        expect(await linkCount(claimId)).toBe(2);
        expect(first.fileId).toBeTruthy();
        expect(await refused(upload(who, claimId))).toMatchObject({
          code: 'INVALID_STATE_TRANSITION',
          meta: { currentState: 'EXPIRED' },
        });
      });
    });

    it('letterhead submit on the own stale claim: 409 EXPIRED, the expiry is committed, the file is not attached', async () => {
      await withClock(async (t0) => {
        const { who, claimId } = await openClaim();
        const ticket = await upload(who, claimId);
        await settle(ticket.fileId, 'CLEAN');
        w.clock.set(t0 + TTL - 1);
        // One millisecond earlier the same submit would work: check on a twin claim.
        const twin = await openClaim('twin');
        const twinTicket = await upload(twin.who, twin.claimId);
        await settle(twinTicket.fileId, 'CLEAN');
        w.clock.set(t0 + TTL);
        expect(await submitOutcome(who, claimId, ticket.fileId)).toEqual({
          ok: false,
          reason: 'CLAIM_EXPIRED',
        });
        expect(await rowOf(claimId)).toMatchObject({
          status: 'EXPIRED',
          lock_version: 1,
          authorisation_file_id: null,
        });
        // The twin was created one millisecond before the shared clock reading, so it is fresh.
        const fine = await submitOutcome(twin.who, twin.claimId, twinTicket.fileId);
        expect(fine).toMatchObject({ ok: true });
      });
    });

    it('never expires a PENDING_REVIEW claim: it waits for Ops', async () => {
      await withClock(async (t0) => {
        const { who, lab, claimId, code } = await openClaim();
        expect(await verifyOutcome(who, claimId, code)).toMatchObject({ ok: true });
        const manual = await openClaim('manual');
        const ticket = await upload(manual.who, manual.claimId);
        await settle(ticket.fileId, 'CLEAN');
        expect(await submitOutcome(manual.who, manual.claimId, ticket.fileId)).toMatchObject({
          ok: true,
        });
        w.clock.set(t0 + 30 * TTL);
        const rival = await w.claimant('rival');
        expect(await refused(start(rival, lab.siteId))).toMatchObject({
          code: 'INVALID_STATE_TRANSITION',
          meta: { currentState: 'CLAIM_PENDING' },
        });
        expect(await refused(start(who, lab.siteId))).toMatchObject({
          code: 'INVALID_STATE_TRANSITION',
          meta: { currentState: 'PENDING_REVIEW' },
        });
        expect(await refused(start(rival, manual.lab.siteId))).toMatchObject({
          meta: { currentState: 'CLAIM_PENDING' },
        });
        expect(await rowOf(claimId)).toMatchObject({ status: 'PENDING_REVIEW', lock_version: 1 });
        expect(await rowOf(manual.claimId)).toMatchObject({ status: 'PENDING_REVIEW' });
        expect(await auditActions(claimId)).not.toContain('lab_claim.expire');
      });
    });

    it('writes ids and states only into the audit entry and the outbox event of an expiry', async () => {
      await withClock(async (t0) => {
        const lab = await w.lab({ email: 'secret.person@private-lab.example.test' });
        const who = await w.claimant();
        const started = await start(who, lab.siteId);
        const ticket = await upload(who, started.claim.id);
        w.clock.set(t0 + TTL);
        const rival = await w.claimant('rival');
        await start(rival, lab.siteId);

        const claimId = started.claim.id;
        const audit = await w
          .db()
          .query<{ actor_user_id: string; before: unknown; after: unknown; row: string }>(
            "SELECT actor_user_id, before, after, row_to_json(a)::text AS row FROM audit_log a WHERE entity_id = $1 AND action = 'lab_claim.expire'",
            [claimId],
          );
        expect(audit.rows).toHaveLength(1);
        expect(audit.rows[0]?.before).toEqual({ status: 'PENDING_OTP' });
        expect(audit.rows[0]?.after).toEqual({
          status: 'EXPIRED',
          labSiteId: lab.siteId,
          organisationId: lab.organisationId,
        });
        const events = await w
          .db()
          .query<{ event_type: string; payload: unknown; row: string }>(
            "SELECT event_type, payload, row_to_json(o)::text AS row FROM outbox_event o WHERE aggregate_id = $1 AND event_type = 'lab_claim.expired'",
            [claimId],
          );
        expect(events.rows).toHaveLength(1);
        expect(events.rows[0]?.payload).toEqual({
          actor: { userId: rival.id },
          data: {
            claimId,
            organisationId: lab.organisationId,
            labSiteId: lab.siteId,
            status: 'EXPIRED',
          },
        });
        const text = `${audit.rows[0]?.row ?? ''}\n${events.rows[0]?.row ?? ''}`;
        for (const secret of [
          'secret.person',
          'private-lab',
          'Asha',
          'letter',
          started.delivery?.code ?? 'x',
          ticket.fileId,
        ]) {
          expect(text, secret).not.toContain(secret);
        }
      });
    });

    it('lets two people start for one lab over a stale claim of a third: exactly one expires it, one claim is open, nobody errors out', async () => {
      await withClock(async (t0) => {
        for (let round = 0; round < 5; round++) {
          const { lab, claimId } = await openClaim('owner');
          const a = await w.claimant('racer-a');
          const b = await w.claimant('racer-b');
          w.clock.set(t0 + TTL);
          const results = await Promise.allSettled([start(a, lab.siteId), start(b, lab.siteId)]);
          const won = results.filter((r) => r.status === 'fulfilled');
          const lost = results.filter((r) => r.status === 'rejected');
          expect(won, `round ${String(round)}`).toHaveLength(1);
          expect(lost).toHaveLength(1);
          expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({
            code: 'INVALID_STATE_TRANSITION',
            meta: { currentState: 'CLAIM_PENDING' },
          });
          const rows = await claimsOf(lab.organisationId);
          expect(rows.filter((r) => r.status === 'EXPIRED').map((r) => r.id)).toEqual([claimId]);
          expect(rows.filter((r) => r.status === 'PENDING_OTP')).toHaveLength(1);
          expect(rows).toHaveLength(2);
          const expiries = (await auditActions(claimId)).filter((x) => x === 'lab_claim.expire');
          expect(expiries).toHaveLength(1);
          w.clock.set(t0);
        }
      });
    });

    it('lets the owner verify while another person starts over the same stale claim: one expiry, one open claim, no 500', async () => {
      await withClock(async (t0) => {
        for (let round = 0; round < 5; round++) {
          const { who, lab, claimId, code } = await openClaim('owner');
          const rival = await w.claimant('rival');
          w.clock.set(t0 + TTL);
          const [verified, started] = await Promise.allSettled([
            verifyOutcome(who, claimId, code),
            start(rival, lab.siteId),
          ]);
          expect(verified, `round ${String(round)}`).toMatchObject({
            status: 'fulfilled',
            value: { ok: false, reason: 'CLAIM_EXPIRED' },
          });
          expect(started).toMatchObject({ status: 'fulfilled', value: { created: true } });
          const rows = await claimsOf(lab.organisationId);
          expect(rows.map((r) => r.status).sort()).toEqual(['EXPIRED', 'PENDING_OTP']);
          expect(
            (await auditActions(claimId)).filter((x) => x === 'lab_claim.expire'),
          ).toHaveLength(1);
          w.clock.set(t0);
        }
      });
    });

    it('lets the same person start twice at once over their own stale claim: one new claim, both answered', async () => {
      await withClock(async (t0) => {
        const { who, lab, claimId } = await openClaim();
        w.clock.set(t0 + TTL);
        const results = await Promise.all([start(who, lab.siteId), start(who, lab.siteId)]);
        expect(results.filter((r) => r.created)).toHaveLength(1);
        expect(new Set(results.map((r) => r.claim.id)).size).toBe(1);
        const rows = await claimsOf(lab.organisationId);
        expect(rows).toHaveLength(2);
        expect(rows.find((r) => r.id === claimId)?.status).toBe('EXPIRED');
      });
    });
  });

  describe('rule 2: at most three open claims per person', () => {
    const openMany = async (who: Claimant, n: number) => {
      const made: { organisationId: string; claimId: string; siteId: string }[] = [];
      for (let i = 0; i < n; i++) {
        const lab = await w.lab();
        const started = await start(who, lab.siteId);
        made.push({
          organisationId: lab.organisationId,
          claimId: started.claim.id,
          siteId: lab.siteId,
        });
      }
      return made;
    };

    it('refuses the fourth start with 429 RATE_LIMITED, no Retry-After, and a text that names no lab, address or other claim', async () => {
      const who = await w.claimant();
      const mine = await openMany(who, MAX_OPEN);
      const target = await w.lab({ email: 'target.contact@hidden-lab.example.test' });
      const audits = () =>
        w
          .db()
          .query<{ n: string }>(
            'SELECT (SELECT count(*) FROM audit_log WHERE actor_user_id = $1) + (SELECT count(*) FROM otp_challenge WHERE created_by_user_id = $1) AS n',
            [who.id],
          );
      const rowsBefore = (await audits()).rows[0]?.n;
      const result = await refused(start(who, target.siteId));
      expect(result).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      expect(result.error.retryAfterSeconds).toBeUndefined();
      const text = JSON.stringify({
        message: result.error.message,
        detail: result.error.detail,
        meta: result.meta,
      });
      expect(text).toContain('maximum number of open claims');
      for (const secret of [
        target.sites[0]?.name ?? 'x',
        target.sites[0]?.siteCode ?? 'x',
        target.certificateNo,
        'hidden-lab',
        'target.contact',
        who.id,
        ...mine.map((m) => m.claimId),
        ...mine.map((m) => m.siteId),
      ]) {
        expect(text, secret).not.toContain(secret);
      }
      expect(text).not.toMatch(/\d/);
      // Nothing was left behind: no claim, no code, no audit row for the refused start.
      expect(await claimsOf(target.organisationId)).toEqual([]);
      expect((await audits()).rows[0]?.n).toBe(rowsBefore);
    });

    it('counts PENDING_REVIEW claims too, and still allows a new code for an existing open claim at the cap', async () => {
      const who = await w.claimant();
      const mine = await openMany(who, MAX_OPEN);
      // Move one claim on to PENDING_REVIEW (it stays open, so it keeps its place).
      const first = mine[0];
      const row = await rowOf(first?.claimId ?? '');
      expect(row?.status).toBe('PENDING_OTP');
      await w
        .db()
        .query("UPDATE lab_claim_request SET status = 'PENDING_REVIEW' WHERE id = $1", [
          first?.claimId,
        ]);
      const next = await w.lab();
      expect(await refused(start(who, next.siteId))).toMatchObject({ code: 'RATE_LIMITED' });
      // A new code for an open PENDING_OTP claim creates nothing, so it is allowed.
      const second = mine[1];
      const again = await start(who, second?.siteId ?? '');
      expect(again).toMatchObject({ created: false });
      expect(again.claim.id).toBe(second?.claimId);
      // The claim in review answers as before (409), not 429.
      expect(await refused(start(who, first?.siteId ?? ''))).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        meta: { currentState: 'PENDING_REVIEW' },
      });
    });

    it('answers every refusal that existed before as before: 409 CLAIMED and 409 CLAIM_PENDING come first, 422 for an unknown lab', async () => {
      const who = await w.claimant();
      const other = await w.claimant('other');
      await openMany(who, MAX_OPEN);
      const taken = await w.lab();
      await start(other, taken.siteId);
      const claimed = await w.lab();
      await w
        .db()
        .query("UPDATE organisation SET claim_status = 'CLAIMED' WHERE id = $1", [
          claimed.organisationId,
        ]);
      expect(await refused(start(who, taken.siteId))).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        meta: { currentState: 'CLAIM_PENDING' },
      });
      expect(await refused(start(who, claimed.siteId))).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        meta: { currentState: 'CLAIMED' },
      });
      expect(await refused(start(who, '0190d6a2-7c4e-7a1b-9c3d-000000000000'))).toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    });

    it('does not count claims that are expired by age, and expires them first (committed when the start succeeds)', async () => {
      await withClock(async (t0) => {
        const who = await w.claimant();
        const mine = await openMany(who, MAX_OPEN);
        w.clock.set(t0 + TTL - 1);
        const early = await w.lab();
        expect(await refused(start(who, early.siteId))).toMatchObject({ code: 'RATE_LIMITED' });
        w.clock.set(t0 + TTL);
        const late = await w.lab();
        const next = await start(who, late.siteId);
        expect(next.created).toBe(true);
        for (const claim of mine) {
          expect(await rowOf(claim.claimId)).toMatchObject({ status: 'EXPIRED', lock_version: 1 });
        }
      });
    });

    it('does not count a mix of old and new wrongly: two stale and one fresh leave two free places', async () => {
      await withClock(async (t0) => {
        const who = await w.claimant();
        await openMany(who, 2);
        w.clock.set(t0 + TTL - 1000);
        await openMany(who, 1);
        w.clock.set(t0 + TTL);
        const [a, b] = [await w.lab(), await w.lab()];
        expect((await start(who, a.siteId)).created).toBe(true);
        expect((await start(who, b.siteId)).created).toBe(true);
        expect(await refused(start(who, (await w.lab()).siteId))).toMatchObject({
          code: 'RATE_LIMITED',
        });
      });
    });

    it('does not count decided or expired claims, or the claims of other people', async () => {
      const who = await w.claimant();
      const rival = await w.claimant('rival');
      const mine = await openMany(who, MAX_OPEN);
      await openMany(rival, MAX_OPEN);
      const states = ['REJECTED', 'APPROVED', 'EXPIRED'] as const;
      for (const [i, claim] of mine.entries()) {
        await w
          .db()
          .query('UPDATE lab_claim_request SET status = $1::claim_request_status WHERE id = $2', [
            states[i],
            claim.claimId,
          ]);
      }
      const fresh = await w.lab();
      expect((await start(who, fresh.siteId)).created).toBe(true);
    });

    it('holds under concurrency: with one place left only one of two simultaneous starts for two labs passes', async () => {
      for (let round = 0; round < 6; round++) {
        const who = await w.claimant();
        await openMany(who, MAX_OPEN - 1);
        const [a, b] = [await w.lab(), await w.lab()];
        const results = await Promise.allSettled([start(who, a.siteId), start(who, b.siteId)]);
        expect(
          results.filter((r) => r.status === 'fulfilled'),
          `round ${String(round)}`,
        ).toHaveLength(1);
        const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        expect(lost.reason).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
        const open = await w
          .db()
          .query<{ n: string }>(
            "SELECT count(*) AS n FROM lab_claim_request WHERE requested_by_user_id = $1 AND status IN ('PENDING_OTP', 'PENDING_REVIEW')",
            [who.id],
          );
        expect(Number(open.rows[0]?.n)).toBe(MAX_OPEN);
      }
    });

    it('holds under concurrency from nothing: of five simultaneous starts for five labs exactly three pass', async () => {
      const who = await w.claimant();
      const labs = await Promise.all([1, 2, 3, 4, 5].map(() => w.lab()));
      const results = await Promise.allSettled(labs.map((lab) => start(who, lab.siteId)));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(MAX_OPEN);
      for (const lost of results.filter((r) => r.status === 'rejected')) {
        expect(lost.reason).toMatchObject({ code: 'RATE_LIMITED' });
      }
    });
  });

  describe('rule 3: at most five letterhead uploads per claim', () => {
    it('refuses the sixth upload URL whatever became of the earlier files, and creates no file for it', async () => {
      const { who, claimId } = await openClaim();
      const kinds: (ScanStatus | 'NEVER')[] = ['CLEAN', 'INFECTED', 'ERROR', 'REJECTED', 'NEVER'];
      expect(kinds).toHaveLength(MAX_UPLOADS);
      for (const kind of kinds) {
        const ticket = await upload(who, claimId);
        if (kind !== 'NEVER') await settle(ticket.fileId, kind);
      }
      const before = await uploadedFileCount(who.id);
      const sixth = await refused(upload(who, claimId));
      expect(sixth).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      expect(sixth.error.retryAfterSeconds).toBeUndefined();
      const text = JSON.stringify({ detail: sixth.error.detail, meta: sixth.meta });
      for (const secret of [FILE_NAME, 'Asha', claimId, who.id]) {
        expect(text, secret).not.toContain(secret);
      }
      expect(await uploadedFileCount(who.id)).toBe(before);
      expect(await linkCount(claimId)).toBe(MAX_UPLOADS);
      // A request that would fail on type does not use up a place; at the limit it is 429 first.
      expect(await refused(upload(who, claimId, { contentType: 'text/html' }))).toMatchObject({
        code: 'RATE_LIMITED',
      });
    });

    it('counts a removed link too', async () => {
      const { who, claimId } = await openClaim();
      for (let i = 0; i < MAX_UPLOADS; i++) await upload(who, claimId);
      await w
        .db()
        .query(
          "UPDATE file_link SET removed_at = now() WHERE entity_id = $1 AND role = 'CLAIM_LETTERHEAD'",
          [claimId],
        );
      expect(await refused(upload(who, claimId))).toMatchObject({ code: 'RATE_LIMITED' });
    });

    it('does not use a place for a request refused on type or size', async () => {
      const { who, claimId } = await openClaim();
      for (let i = 0; i < 3; i++) {
        expect(await refused(upload(who, claimId, { contentType: 'text/html' }))).toMatchObject({
          code: 'VALIDATION_FAILED',
        });
      }
      for (let i = 0; i < MAX_UPLOADS; i++) await upload(who, claimId);
      expect(await refused(upload(who, claimId))).toMatchObject({ code: 'RATE_LIMITED' });
    });

    it("keeps the allowance per claim: another claim, and another person's requests, do not touch it", async () => {
      const first = await openClaim('first');
      const second = await openClaim('second');
      for (let i = 0; i < MAX_UPLOADS - 1; i++) await upload(first.who, first.claimId);
      // The other person's requests (for the first claim: 404; for their own claim: their own allowance).
      for (let i = 0; i < MAX_UPLOADS + 2; i++) {
        expect(await refused(upload(second.who, first.claimId))).toMatchObject({
          code: 'NOT_FOUND',
        });
      }
      for (let i = 0; i < MAX_UPLOADS; i++) await upload(second.who, second.claimId);
      expect(await refused(upload(second.who, second.claimId))).toMatchObject({
        code: 'RATE_LIMITED',
      });
      // The first claim still has its last place, and the same person's other claim is separate.
      expect(await linkCount(first.claimId)).toBe(MAX_UPLOADS - 1);
      await upload(first.who, first.claimId);
      expect(await refused(upload(first.who, first.claimId))).toMatchObject({
        code: 'RATE_LIMITED',
      });
    });

    it('still lets one of the five files be submitted after the limit is reached', async () => {
      const { who, claimId } = await openClaim();
      const tickets = [];
      for (let i = 0; i < MAX_UPLOADS; i++) tickets.push(await upload(who, claimId));
      expect(await refused(upload(who, claimId))).toMatchObject({ code: 'RATE_LIMITED' });
      const chosen = tickets[2];
      await settle(chosen?.fileId ?? '', 'CLEAN');
      expect(await submitOutcome(who, claimId, chosen?.fileId ?? '')).toMatchObject({
        ok: true,
        claim: { status: 'PENDING_REVIEW', method: 'MANUAL' },
      });
      expect(await rowOf(claimId)).toMatchObject({ authorisation_file_id: chosen?.fileId });
    });

    it('holds under concurrency: of six simultaneous requests exactly five succeed', async () => {
      for (let round = 0; round < 3; round++) {
        const { who, claimId } = await openClaim();
        const results = await Promise.allSettled(
          Array.from({ length: MAX_UPLOADS + 1 }, () => upload(who, claimId)),
        );
        expect(
          results.filter((r) => r.status === 'fulfilled'),
          `round ${String(round)}`,
        ).toHaveLength(MAX_UPLOADS);
        const lost = results.filter((r) => r.status === 'rejected');
        expect(lost).toHaveLength(1);
        expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'RATE_LIMITED' });
        expect(await linkCount(claimId)).toBe(MAX_UPLOADS);
        expect(await uploadedFileCount(who.id)).toBe(MAX_UPLOADS);
      }
    });

    it('is refused as 409 when the claim moved on while the request waited for the claim row', async () => {
      const { who, claimId, code } = await openClaim();
      await upload(who, claimId);
      const results = await Promise.allSettled([
        verifyOutcome(who, claimId, code),
        upload(who, claimId),
        upload(who, claimId),
      ]);
      // Whatever the order, nobody gets anything but a documented answer, and every upload that
      // was accepted was accepted while the claim was still PENDING_OTP.
      for (const result of results) {
        if (result.status === 'rejected') {
          expect(result.reason).toMatchObject({
            code: 'INVALID_STATE_TRANSITION',
            meta: { currentState: 'PENDING_REVIEW' },
          });
        }
      }
      expect(await rowOf(claimId)).toMatchObject({ status: 'PENDING_REVIEW' });
    });
  });
});
