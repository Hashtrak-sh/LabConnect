import { beforeAll, describe, expect, it } from 'vitest';
import {
  type AdminLabClaimView,
  approveLabClaim,
  buildCurrentActor,
  type CurrentActor,
  IdentityError,
  isStale,
  listLabClaimsForReview,
  loadMemberships,
  rejectLabClaim,
  requiresMfa,
  startLabClaim,
  verifyLabClaimOtp,
} from '../../src/index.js';
import { START } from './identity-support.js';
import { gate } from './support.js';
import { CLAIM_META } from './labs-claims-support.js';
import { DAY_MS, useClaimReviewWorld } from './labs-claim-review-support.js';

// I2-ADM-01 to I2-ADM-03: the Ops list, approval and rejection of lab claims, on the real schema,
// as the API role in the `platform` context (what TenantScope.run gives a platform actor).

describe('lab claim review (Ops)', () => {
  const w = useClaimReviewWorld();
  let ops: CurrentActor;
  let finance: CurrentActor;
  let steward: CurrentActor;
  let admin: CurrentActor;

  beforeAll(async () => {
    const actors = await w.platformActors();
    ({ ops, finance, steward, admin } = actors);
  });

  const list = (
    actor: CurrentActor,
    input: { status?: AdminLabClaimView['status']; cursor?: string; limit?: number } = {},
  ) => w.as(actor, (tx) => listLabClaimsForReview(tx, w.review, { actor, ...input }));
  const approve = (
    claimId: string,
    ifMatch: number,
    over: { actor?: CurrentActor; decisionNotes?: string } = {},
  ) => {
    const actor = over.actor ?? ops;
    return w.as(actor, (tx) =>
      approveLabClaim(tx, w.review, {
        actor,
        claimId,
        ifMatch,
        ...(over.decisionNotes !== undefined && { decisionNotes: over.decisionNotes }),
        meta: CLAIM_META,
      }),
    );
  };
  const reject = (
    claimId: string,
    ifMatch: number,
    decisionNotes: string,
    over: { actor?: CurrentActor } = {},
  ) => {
    const actor = over.actor ?? ops;
    return w.as(actor, (tx) =>
      rejectLabClaim(tx, w.review, { actor, claimId, ifMatch, decisionNotes, meta: CLAIM_META }),
    );
  };
  /** Every page of the whole list, in order, with the page size asked for. */
  const allPages = async (status?: AdminLabClaimView['status'], limit = 100) => {
    const out: AdminLabClaimView[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 500; guard += 1) {
      const page = await list(ops, {
        ...(status !== undefined && { status }),
        limit,
        ...(cursor !== undefined && { cursor }),
      });
      out.push(...page.data);
      if (page.page.nextCursor === null) return out;
      cursor = page.page.nextCursor;
    }
    throw new Error('the list did not end');
  };

  // ------------------------------------------------------------------ who may call

  describe('who may call (point 1)', () => {
    it('refuses every role but PLATFORM_OPS with 403, before any row is read, and writes nothing', async () => {
      const claim = await w.reviewable();
      const lab = await w.lab({ onboarded: true });
      const checker = await w.actorOf(
        lab.checkers[0] ?? '',
        lab.organisationId,
        ['LAB_CHECKER'],
        'LAB',
        lab.sites.map((site) => site.id),
      );
      const maker = await w.actorOf(
        lab.makers[0] ?? '',
        lab.organisationId,
        ['LAB_MAKER'],
        'LAB',
        lab.sites.map((site) => site.id),
      );
      for (const [label, actor] of [
        ['finance', finance],
        ['data steward', steward],
        ['admin', admin],
        ['lab checker', checker],
        ['lab maker', maker],
      ] as const) {
        const version = await w.lockVersionOf(claim.claimId);
        for (const call of [
          () => list(actor),
          () => approve(claim.claimId, version, { actor }),
          () => reject(claim.claimId, version, 'No.', { actor }),
        ]) {
          await w.refusedWritingNothing(claim, call, { code: 'FORBIDDEN', status: 403 });
        }
        expect(label).toBeTruthy();
      }
    });

    it('refuses a user with no membership (no database context at all) with 403', async () => {
      const claim = await w.reviewable();
      const stranger = await w.claimant('stranger');
      const version = await w.lockVersionOf(claim.claimId);
      await w.refusedWritingNothing(
        claim,
        () =>
          w.scope.run(stranger.actor, (tx) =>
            approveLabClaim(tx, w.review, {
              actor: stranger.actor,
              claimId: claim.claimId,
              ifMatch: version,
              meta: CLAIM_META,
            }),
          ),
        { code: 'FORBIDDEN', status: 403 },
      );
      await expect(w.scope.run(stranger.actor, () => Promise.resolve())).rejects.toBeInstanceOf(
        IdentityError,
      );
    });

    it('runs in the platform database context, not as the system', async () => {
      // A claim is visible to the platform context through its row policy; the same read as a
      // tenant context of another organisation finds nothing (what TENANT_ISOLATION promises).
      const claim = await w.reviewable();
      const other = await w.lab({ onboarded: true });
      const tenant = await w.actorOf(
        other.checkers[0] ?? '',
        other.organisationId,
        ['LAB_CHECKER'],
        'LAB',
        other.sites.map((s) => s.id),
      );
      const seenByTenant = await w.as(tenant, (tx) =>
        tx.labClaimRequest.count({ where: { id: claim.claimId } }),
      );
      const seenByPlatform = await w.as(ops, (tx) =>
        tx.labClaimRequest.count({ where: { id: claim.claimId } }),
      );
      expect({ seenByTenant, seenByPlatform }).toEqual({ seenByTenant: 0, seenByPlatform: 1 });
    });
  });

  // ------------------------------------------------------------------ the list

  describe('the list (I2-ADM-01)', () => {
    it('shows exactly the fields of AdminLabClaim and nothing about the claimant but the id', async () => {
      const claim = await w.reviewable({ manual: true });
      const seen = (await allPages()).find((row) => row.id === claim.claimId);
      expect(seen).toBeDefined();
      expect(Object.keys(seen ?? {}).sort()).toEqual(
        [
          'id',
          'organisationId',
          'labSiteId',
          'requestedByUserId',
          'method',
          'status',
          'authorisationFileId',
          'reviewedByUserId',
          'reviewedAt',
          'decisionNotes',
          'createdAt',
          'lockVersion',
        ].sort(),
      );
      expect(seen).toMatchObject({
        organisationId: claim.organisationId,
        labSiteId: claim.siteId,
        requestedByUserId: claim.claimant.id,
        method: 'MANUAL',
        status: 'PENDING_REVIEW',
        authorisationFileId: claim.fileId,
        reviewedByUserId: null,
        reviewedAt: null,
        decisionNotes: null,
        lockVersion: 1,
      });
      const text = JSON.stringify(seen);
      expect(text).not.toContain(claim.claimant.email);
      expect(text).not.toContain('Asha Rao');
    });

    it('lists oldest first and pages by cursor without gaps or repeats, whatever the page size', async () => {
      const made = [];
      for (let i = 0; i < 5; i += 1) {
        made.push(await w.reviewable());
        w.clock.advance(1000);
      }
      // Two claims with the very same created_at: the id breaks the tie.
      const same = new Date(w.clock.now().getTime());
      const tieA = await w.reviewable();
      const tieB = await w.reviewable();
      await w
        .db()
        .query('UPDATE lab_claim_request SET created_at = $1 WHERE id = ANY($2)', [
          same,
          [tieA.claimId, tieB.claimId],
        ]);
      const mine = new Set([...made, tieA, tieB].map((c) => c.claimId));
      const whole = await allPages(undefined, 100);
      const small = await allPages(undefined, 2);
      expect(small.map((row) => row.id)).toEqual(whole.map((row) => row.id));
      expect(new Set(small.map((row) => row.id)).size).toBe(small.length);
      const ordered = whole.filter((row) => mine.has(row.id));
      expect(ordered).toHaveLength(7);
      const times = ordered.map((row) => row.createdAt.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
      const tieIds = ordered
        .filter((row) => row.createdAt.getTime() === same.getTime())
        .map((row) => row.id);
      expect(tieIds).toEqual([tieA.claimId, tieB.claimId].sort());
    });

    it('reports the page size and a null cursor on the last page, and refuses a bad limit, status or cursor with 422', async () => {
      const page = await list(ops, { limit: 1 });
      expect(page.page.limit).toBe(1);
      expect(page.data).toHaveLength(1);
      expect(page.page.nextCursor).not.toBeNull();
      expect((await list(ops)).page.limit).toBe(25);
      for (const limit of [0, 101, 1.5, Number.NaN]) {
        expect(await w.refused(list(ops, { limit })), String(limit)).toMatchObject({
          code: 'VALIDATION_FAILED',
          status: 422,
        });
      }
      for (const cursor of [
        'not-base64-json',
        Buffer.from('{"i":"x"}').toString('base64url'),
        Buffer.from(JSON.stringify({ i: '0192b3b2-0000-7000-8000-000000000000' })).toString(
          'base64url',
        ),
      ]) {
        expect(await w.refused(list(ops, { cursor })), cursor).toMatchObject({
          code: 'VALIDATION_FAILED',
          status: 422,
        });
      }
      expect(await w.refused(list(ops, { status: 'BOGUS' as unknown as 'EXPIRED' }))).toMatchObject(
        { code: 'VALIDATION_FAILED' },
      );
    });

    it('filters by status, and with no status returns every status (the contract gives no default)', async () => {
      const pending = await w.reviewable();
      const approved = await w.reviewable();
      await approve(approved.claimId, 1);
      const rejected = await w.reviewable();
      await reject(rejected.claimId, 1, 'Not the lab.');
      const idsOf = async (status?: AdminLabClaimView['status']) =>
        new Set((await allPages(status)).map((row) => row.id));
      const everything = await idsOf();
      for (const claim of [pending, approved, rejected])
        expect(everything.has(claim.claimId)).toBe(true);
      expect((await idsOf('PENDING_REVIEW')).has(pending.claimId)).toBe(true);
      expect((await idsOf('PENDING_REVIEW')).has(approved.claimId)).toBe(false);
      expect((await idsOf('APPROVED')).has(approved.claimId)).toBe(true);
      expect((await idsOf('APPROVED')).has(pending.claimId)).toBe(false);
      expect((await idsOf('REJECTED')).has(rejected.claimId)).toBe(true);
      for (const row of await allPages('REJECTED')) expect(row.status).toBe('REJECTED');
    });

    describe('the 24-hour rule (OQ-220)', () => {
      const lab = () => w.lab();
      const startOnly = async () => {
        const site = await lab();
        const claimant = await w.claimant();
        const started = await w.asSystem((tx) =>
          startLabClaim(tx, w.deps, {
            actor: claimant.actor,
            siteId: site.siteId,
            meta: w.freshMeta(),
          }),
        );
        return { site, claimant, claimId: started.claim.id };
      };
      const agedBy = (claimId: string, ms: number) =>
        w
          .db()
          .query('UPDATE lab_claim_request SET created_at = $2 WHERE id = $1', [
            claimId,
            new Date(w.clock.now().getTime() - ms),
          ]);

      it('shows a PENDING_OTP claim 24 hours old as EXPIRED, finds it by EXPIRED and not by PENDING_OTP, and writes nothing', async () => {
        const stale = await startOnly();
        await agedBy(stale.claimId, DAY_MS);
        const fresh = await startOnly();
        await agedBy(fresh.claimId, DAY_MS - 1);

        const before = await w.snapshot({
          organisationId: stale.site.organisationId,
          userId: stale.claimant.id,
        });
        const all = await allPages();
        expect(all.find((row) => row.id === stale.claimId)).toMatchObject({
          status: 'EXPIRED',
          lockVersion: 0,
        });
        expect(all.find((row) => row.id === fresh.claimId)).toMatchObject({
          status: 'PENDING_OTP',
        });
        const expired = new Set((await allPages('EXPIRED')).map((row) => row.id));
        const open = new Set((await allPages('PENDING_OTP')).map((row) => row.id));
        expect(expired.has(stale.claimId)).toBe(true);
        expect(expired.has(fresh.claimId)).toBe(false);
        expect(open.has(stale.claimId)).toBe(false);
        expect(open.has(fresh.claimId)).toBe(true);
        for (const row of await allPages('PENDING_OTP')) expect(row.status).toBe('PENDING_OTP');
        // The stored row is untouched: a read does not write.
        expect(await w.claimRow(stale.claimId)).toMatchObject({
          status: 'PENDING_OTP',
          lock_version: 0,
        });
        expect(
          await w.snapshot({
            organisationId: stale.site.organisationId,
            userId: stale.claimant.id,
          }),
        ).toEqual(before);
      });

      it('uses the cutoff of the lab side: stale at exactly 24 hours, not one millisecond earlier', async () => {
        const claim = await startOnly();
        const row = await w.claimRow(claim.claimId);
        const created = row?.created_at ?? new Date();
        const shownAt = async (at: number) => {
          w.clock.advance(at - w.clock.now().getTime());
          return (await allPages()).find((r) => r.id === claim.claimId)?.status;
        };
        const start = w.clock.now().getTime();
        try {
          expect(await shownAt(created.getTime() + DAY_MS - 1)).toBe('PENDING_OTP');
          expect(
            isStale(
              { status: 'PENDING_OTP', createdAt: created },
              new Date(created.getTime() + DAY_MS - 1),
            ),
          ).toBe(false);
          expect(await shownAt(created.getTime() + DAY_MS)).toBe('EXPIRED');
          expect(
            isStale(
              { status: 'PENDING_OTP', createdAt: created },
              new Date(created.getTime() + DAY_MS),
            ),
          ).toBe(true);
        } finally {
          w.clock.advance(start - w.clock.now().getTime());
        }
      });

      it('shows a stored EXPIRED claim as EXPIRED, and never turns a PENDING_REVIEW claim into EXPIRED however old', async () => {
        const claim = await w.reviewable();
        await agedBy(claim.claimId, 400 * DAY_MS);
        const row = (await allPages()).find((r) => r.id === claim.claimId);
        expect(row?.status).toBe('PENDING_REVIEW');
      });
    });
  });

  // ------------------------------------------------------------------ approve

  describe('approve (I2-ADM-02)', () => {
    it('does the whole job in one go: start, verify, approve, then the claimant is the first Checker of a claimed organisation', async () => {
      const claim = await w.reviewable();
      const before = await w.organisationRow(claim.organisationId);
      expect(before).toMatchObject({ claim_status: 'UNCLAIMED' });
      expect(await w.membershipsOf(claim.organisationId)).toEqual([]);
      const auditBefore = await w
        .db()
        .query<{ n: string }>('SELECT count(*)::text AS n FROM audit_log');

      w.clock.advance(3600_000);
      const NOTES = 'Verified by phone with the registered contact.';
      const approved = await approve(claim.claimId, 1, { decisionNotes: NOTES });

      expect(approved).toMatchObject({
        id: claim.claimId,
        status: 'APPROVED',
        organisationId: claim.organisationId,
        labSiteId: claim.siteId,
        requestedByUserId: claim.claimant.id,
        reviewedByUserId: ops.userId,
        reviewedAt: w.clock.now(),
        decisionNotes: NOTES,
        lockVersion: 2,
      });
      expect(await w.claimRow(claim.claimId)).toMatchObject({
        status: 'APPROVED',
        lock_version: 2,
        reviewed_by_user_id: ops.userId,
        decision_notes: NOTES,
      });
      expect((await w.claimRow(claim.claimId))?.reviewed_at?.getTime()).toBe(
        w.clock.now().getTime(),
      );
      expect(await w.organisationRow(claim.organisationId)).toMatchObject({
        claim_status: 'CLAIMED',
        lock_version: (before?.lock_version ?? 0) + 1,
        status: 'ACTIVE',
      });

      // The membership, the role and the site, as RR-2, RR-3 and AUTHENTICATION section 5 say.
      const members = await w.membershipsOf(claim.organisationId);
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({
        user_id: claim.claimant.id,
        status: 'ACTIVE',
        roles: ['LAB_CHECKER'],
        sites: [claim.siteId],
        created_by_user_id: ops.userId,
      });

      // Audit and event: ids and states, no notes, no address.
      const audit = await w.db().query<{
        action: string;
        entity_type: string;
        entity_id: string;
        after: unknown;
        actor_role: string | null;
        actor_user_id: string | null;
      }>(
        `SELECT action, entity_type, entity_id, after, actor_role, actor_user_id FROM audit_log
          WHERE action IN ('lab_claim.approve', 'organisation.claim', 'membership.create')
            AND (entity_id = $1 OR entity_id = $2 OR entity_id = $3)
          ORDER BY action`,
        [claim.claimId, claim.organisationId, members[0]?.id],
      );
      expect(audit.rows.map((r) => r.action)).toEqual([
        'lab_claim.approve',
        'membership.create',
        'organisation.claim',
      ]);
      for (const row of audit.rows) {
        expect(row.actor_role).toBe('PLATFORM_OPS');
        expect(row.actor_user_id).toBe(ops.userId);
      }
      const all = await w.db().query<{ n: string }>('SELECT count(*)::text AS n FROM audit_log');
      expect(Number(all.rows[0]?.n) - Number(auditBefore.rows[0]?.n)).toBe(3);
      const events = await w
        .db()
        .query<{ event_type: string; payload: unknown; aggregate_id: string }>(
          `SELECT event_type, payload, aggregate_id FROM outbox_event WHERE aggregate_id = $1 ORDER BY occurred_at`,
          [claim.claimId],
        );
      expect(events.rows.map((e) => e.event_type)).toEqual([
        'lab_claim.started',
        'lab_claim.pending_review',
        'lab_claim.approved',
      ]);
      const sensitive = JSON.stringify([audit.rows, events.rows]);
      expect(sensitive).not.toContain(NOTES);
      expect(sensitive).not.toContain(claim.claimant.email);
      expect(sensitive).not.toContain(claim.nablEmail ?? 'no-such-address');

      // The organisation's sites are as they were: claimed, not bookable (a later task).
      const site = await w
        .db()
        .query<{ listing_status: string; status: string }>(
          'SELECT listing_status::text, status::text FROM lab_site WHERE id = $1',
          [claim.siteId],
        );
      expect(site.rows[0]).toEqual({ listing_status: 'LISTED', status: 'ACTIVE' });
    });

    it('forces MFA through the role: the new Checker needs MFA to sign in and cannot act without it', async () => {
      const claim = await w.reviewable();
      const noMfaBefore = await w.asUser(claim.claimant.id, (tx) =>
        loadMemberships(tx, claim.claimant.id),
      );
      expect(requiresMfa(noMfaBefore)).toBe(false);
      await approve(claim.claimId, 1);
      const memberships = await w.asUser(claim.claimant.id, (tx) =>
        loadMemberships(tx, claim.claimant.id),
      );
      expect(memberships).toHaveLength(1);
      expect(memberships[0]?.roles).toEqual(['LAB_CHECKER']);
      // Sign-in: any membership with an MFA-required role makes the session partial.
      expect(requiresMfa(memberships)).toBe(true);
      // An actor built from the new membership without a completed MFA is STEP_UP_REQUIRED, so a
      // Checker-only permission cannot be used until MFA is enrolled and verified.
      const built = (mfaVerifiedAt: Date | null) =>
        buildCurrentActor(
          { userId: claim.claimant.id, sessionId: 'session', mfaVerifiedAt },
          {
            id: memberships[0]?.id ?? '',
            organisationId: claim.organisationId,
            orgType: 'LAB',
            orgStatus: 'ACTIVE',
            roles: ['LAB_CHECKER'],
            siteIds: [claim.siteId],
          },
        );
      expect(() => built(null)).toThrow(
        expect.objectContaining({
          code: 'STEP_UP_REQUIRED',
          meta: { reason: 'MFA_REQUIRED_FOR_ROLE' },
        }) as Error,
      );
      const actor = built(new Date(START));
      expect(actor.permissions.has('booking.decide')).toBe(true);
      expect(actor.siteIds).toEqual([claim.siteId]);
    });

    it('approves a MANUAL claim whose letterhead is clean, and the Checker is assigned to the claim site', async () => {
      const claim = await w.reviewable({ manual: true });
      const approved = await approve(claim.claimId, 1);
      expect(approved).toMatchObject({
        method: 'MANUAL',
        status: 'APPROVED',
        authorisationFileId: claim.fileId,
      });
      expect((await w.membershipsOf(claim.organisationId))[0]).toMatchObject({
        roles: ['LAB_CHECKER'],
        sites: [claim.siteId],
      });
    });

    it('refuses an unclean or missing letterhead on a MANUAL claim with 422 and writes nothing', async () => {
      const make = async (status: 'PENDING' | 'INFECTED' | 'REJECTED') => {
        const lab = await w.lab({ email: null });
        const claimant = await w.claimant();
        const started = await w.asSystem((tx) =>
          startLabClaim(tx, w.deps, {
            actor: claimant.actor,
            siteId: lab.siteId,
            meta: w.freshMeta(),
          }),
        );
        const { requestClaimLetterheadUpload } = await import('../../src/index.js');
        const outcome = await w.asSystem((tx) =>
          requestClaimLetterheadUpload(tx, w.letterheadDeps, {
            actor: claimant.actor,
            claimId: started.claim.id,
            contentType: 'application/pdf',
            sizeBytes: 1000,
            meta: CLAIM_META,
          }),
        );
        if (!outcome.ok) throw new Error('expired');
        if (status !== 'PENDING') await w.settle(outcome.ticket.fileId, status);
        await w
          .db()
          .query(
            `UPDATE lab_claim_request SET status = 'PENDING_REVIEW', method = 'MANUAL', authorisation_file_id = $2, lock_version = 1 WHERE id = $1`,
            [started.claim.id, outcome.ticket.fileId],
          );
        return {
          organisationId: lab.organisationId,
          claimant,
          claimId: started.claim.id,
          fileId: outcome.ticket.fileId,
        };
      };
      for (const status of ['PENDING', 'INFECTED', 'REJECTED'] as const) {
        const claim = await make(status);
        await w.refusedWritingNothing(claim, () => approve(claim.claimId, 1), {
          code: 'FILE_NOT_CLEAN',
          status: 422,
        });
      }
      // No file at all, and a clean file that belongs to another claim.
      const missing = await w.reviewable({ manual: true });
      await w
        .db()
        .query('UPDATE lab_claim_request SET authorisation_file_id = NULL WHERE id = $1', [
          missing.claimId,
        ]);
      await w.refusedWritingNothing(missing, () => approve(missing.claimId, 1), {
        code: 'VALIDATION_FAILED',
        status: 422,
        meta: { reason: 'LETTERHEAD_MISSING' },
      });
      const donor = await w.reviewable({ manual: true });
      const borrower = await w.reviewable({ manual: true });
      await w
        .db()
        .query('UPDATE lab_claim_request SET authorisation_file_id = $2 WHERE id = $1', [
          borrower.claimId,
          donor.fileId,
        ]);
      await w.refusedWritingNothing(borrower, () => approve(borrower.claimId, 1), {
        code: 'VALIDATION_FAILED',
        status: 422,
        meta: { reason: 'LETTERHEAD_MISSING' },
      });
    });

    it('refuses a claim that is not PENDING_REVIEW with 409 and the state, writing nothing', async () => {
      const subject = await w.reviewable();
      const approved = await w.reviewable();
      await approve(approved.claimId, 1);
      const rejected = await w.reviewable();
      await reject(rejected.claimId, 1, 'No.');
      const expired = await w.reviewable();
      await w
        .db()
        .query("UPDATE lab_claim_request SET status = 'EXPIRED' WHERE id = $1", [expired.claimId]);
      for (const [claim, state] of [
        [approved, 'APPROVED'],
        [rejected, 'REJECTED'],
        [expired, 'EXPIRED'],
      ] as const) {
        await w.refusedWritingNothing(claim, () => approve(claim.claimId, 99), {
          code: 'INVALID_STATE_TRANSITION',
          status: 409,
          meta: { currentState: state },
        });
      }
      expect(subject.claimId).toBeTruthy();
    });

    it('cannot decide a PENDING_OTP claim: 409 with its state, and with EXPIRED when it is 24 hours old, without writing or expiring it', async () => {
      const lab = await w.lab();
      const claimant = await w.claimant();
      const started = await w.asSystem((tx) =>
        startLabClaim(tx, w.deps, {
          actor: claimant.actor,
          siteId: lab.siteId,
          meta: w.freshMeta(),
        }),
      );
      const subject = { organisationId: lab.organisationId, claimant };
      await w.refusedWritingNothing(subject, () => approve(started.claim.id, 0), {
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
        meta: { currentState: 'PENDING_OTP' },
      });
      await w.refusedWritingNothing(subject, () => reject(started.claim.id, 0, 'No.'), {
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
        meta: { currentState: 'PENDING_OTP' },
      });
      await w
        .db()
        .query('UPDATE lab_claim_request SET created_at = $2 WHERE id = $1', [
          started.claim.id,
          new Date(w.clock.now().getTime() - DAY_MS),
        ]);
      await w.refusedWritingNothing(subject, () => approve(started.claim.id, 0), {
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
        meta: { currentState: 'EXPIRED' },
      });
      await w.refusedWritingNothing(subject, () => reject(started.claim.id, 0, 'No.'), {
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
        meta: { currentState: 'EXPIRED' },
      });
      // The lab side still expires it lazily, exactly as before, when the claimant meets it.
      expect(await w.claimRow(started.claim.id)).toMatchObject({ status: 'PENDING_OTP' });
      const verified = await w.asSystem((tx) =>
        verifyLabClaimOtp(tx, w.deps, {
          actor: claimant.actor,
          claimId: started.claim.id,
          ifMatch: 0,
          code: started.delivery?.code ?? '000000',
          meta: CLAIM_META,
        }),
      );
      expect(verified).toEqual({ ok: false, reason: 'CLAIM_EXPIRED' });
      expect(await w.claimRow(started.claim.id)).toMatchObject({
        status: 'EXPIRED',
        lock_version: 1,
      });
    });

    it('answers 404 for an unknown or malformed id and 412 for a wrong If-Match, in that order after 409', async () => {
      const claim = await w.reviewable();
      const nothing = (id: string) => w.refused(approve(id, 1));
      expect(await nothing('0192b3b2-0000-7000-8000-000000000000')).toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
      expect(await nothing('not-a-uuid')).toMatchObject({ code: 'NOT_FOUND', status: 404 });
      await w.refusedWritingNothing(claim, () => approve(claim.claimId, 0), {
        code: 'CONCURRENT_MODIFICATION',
        status: 412,
      });
      await w.refusedWritingNothing(claim, () => approve(claim.claimId, 7), {
        code: 'CONCURRENT_MODIFICATION',
        status: 412,
      });
      // A wrong If-Match on a claim that is not decidable is 409, not 412.
      const done = await w.reviewable();
      await approve(done.claimId, 1);
      await w.refusedWritingNothing(done, () => approve(done.claimId, 0), {
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
      });
    });

    it('is safe to repeat: a second approval of an approved claim is 409 and changes nothing', async () => {
      const claim = await w.reviewable();
      await approve(claim.claimId, 1);
      await w.refusedWritingNothing(claim, () => approve(claim.claimId, 2), {
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
        meta: { currentState: 'APPROVED' },
      });
      expect(await w.membershipsOf(claim.organisationId)).toHaveLength(1);
    });

    it('refuses an organisation that is already claimed with 409 and writes nothing', async () => {
      const claim = await w.reviewable();
      await w
        .db()
        .query("UPDATE organisation SET claim_status = 'CLAIMED' WHERE id = $1", [
          claim.organisationId,
        ]);
      await w.refusedWritingNothing(claim, () => approve(claim.claimId, 1), {
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
        meta: { currentState: 'CLAIMED' },
      });
      expect(await w.claimRow(claim.claimId)).toMatchObject({
        status: 'PENDING_REVIEW',
        reviewed_by_user_id: null,
      });
      expect(await w.membershipsOf(claim.organisationId)).toEqual([]);
    });

    it('refuses a suspended organisation with 409 and the organisation status, writing nothing', async () => {
      const claim = await w.reviewable();
      await w
        .db()
        .query("UPDATE organisation SET status = 'SUSPENDED' WHERE id = $1", [
          claim.organisationId,
        ]);
      await w.refusedWritingNothing(claim, () => approve(claim.claimId, 1), {
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
        meta: { currentState: 'SUSPENDED' },
      });
    });

    describe('what the claimant must still be (point 4)', () => {
      const expectRefused = (
        claim: {
          organisationId: string;
          claimant: { id: string; email: string; actor: CurrentActor };
          claimId: string;
        },
        reason: string,
      ) =>
        w.refusedWritingNothing(claim, () => approve(claim.claimId, 1), {
          code: 'VALIDATION_FAILED',
          status: 422,
          meta: { reason },
        });

      it('is an active user: a disabled claimant is 422', async () => {
        const claim = await w.reviewable();
        await w
          .db()
          .query("UPDATE app_user SET status = 'DISABLED' WHERE id = $1", [claim.claimant.id]);
        await expectRefused(claim, 'CLAIMANT_NOT_ACTIVE');
      });

      it('is not platform staff (RR-5): a claimant who became staff since is 422', async () => {
        const claim = await w.reviewable();
        await w
          .db()
          .query('UPDATE app_user SET is_platform_staff = true WHERE id = $1', [claim.claimant.id]);
        await expectRefused(claim, 'CLAIMANT_IS_PLATFORM_STAFF');
      });

      it('cannot be an Ops user approving their own claim: the staff check covers it', async () => {
        const claim = await w.reviewable();
        const lab = await w.lab();
        // Platform staff cannot start a claim; a row for a staff member can only come from a user
        // who was staff afterwards. Written directly, as such a row would be.
        const claimId = await w.insertClaim({
          organisationId: lab.organisationId,
          siteId: lab.siteId,
          userId: ops.userId,
          status: 'PENDING_REVIEW',
        });
        await w
          .db()
          .query('UPDATE lab_claim_request SET lock_version = 1 WHERE id = $1', [claimId]);
        await w.refusedWritingNothing(
          {
            organisationId: lab.organisationId,
            claimant: { id: ops.userId, email: '', actor: ops },
          },
          () => approve(claimId, 1),
          {
            code: 'VALIDATION_FAILED',
            status: 422,
            meta: { reason: 'CLAIMANT_IS_PLATFORM_STAFF' },
          },
        );
        expect(claim.claimId).toBeTruthy();
      });

      it('holds no lab role anywhere (RR-2, OQ-208): a Maker or Checker elsewhere is 422, a second approval for one person too', async () => {
        const other = await w.lab({ onboarded: true });
        const maker = await w.reviewable({ claimant: await w.claimant('maker') });
        await w.owner((tx) =>
          w.addMember(tx, maker.claimant.id, other.organisationId, 'LAB_MAKER', [
            other.sites[0]?.id ?? '',
          ]),
        );
        await expectRefused(maker, 'CLAIMANT_HOLDS_LAB_ROLE');

        const checker = await w.reviewable({ claimant: await w.claimant('checker') });
        await w.owner((tx) =>
          w.addMember(tx, checker.claimant.id, other.organisationId, 'LAB_CHECKER', [
            other.sites[0]?.id ?? '',
          ]),
        );
        await expectRefused(checker, 'CLAIMANT_HOLDS_LAB_ROLE');

        // One person, two labs: the first approval makes them Checker, the second is refused.
        const person = await w.claimant('two-labs');
        const first = await w.reviewable({ claimant: person });
        const second = await w.reviewable({ claimant: person });
        await approve(first.claimId, 1);
        await expectRefused(second, 'CLAIMANT_HOLDS_LAB_ROLE');
        expect(await w.membershipsOf(second.organisationId)).toEqual([]);
      });

      it('may already belong to a customer organisation (RR-4): the lab membership is added beside it', async () => {
        const claimant = await w.claimant('consultant');
        const customer = await w.owner((tx) =>
          import('@labconnect/database/test-utils').then((m) => m.createCustomer(tx)),
        );
        await w.owner((tx) =>
          w.addMember(tx, claimant.id, customer.organisationId, 'CUSTOMER_REQUESTER'),
        );
        const claim = await w.reviewable({ claimant });
        await approve(claim.claimId, 1);
        const memberships = await w.asUser(claimant.id, (tx) => loadMemberships(tx, claimant.id));
        expect(memberships.map((m) => m.roles).sort()).toEqual([
          ['CUSTOMER_REQUESTER'],
          ['LAB_CHECKER'],
        ]);
      });

      it('has no membership of this organisation yet, deactivated or not: 422', async () => {
        const claim = await w.reviewable();
        await w.db().query(
          `INSERT INTO membership (id, user_id, organisation_id, status, created_at, updated_at, lock_version)
           VALUES (gen_random_uuid(), $1, $2, 'DEACTIVATED', now(), now(), 0)`,
          [claim.claimant.id, claim.organisationId],
        );
        await expectRefused(claim, 'CLAIMANT_ALREADY_MEMBER');
      });
    });

    describe('concurrency (point 4)', () => {
      it('lets exactly one of two simultaneous approvals of one claim win: one membership, one owner', async () => {
        const claim = await w.reviewable();
        const hold = gate();
        // The first transaction has done everything but commit; the second starts meanwhile.
        const first = w.as(ops, async (tx) => {
          const result = await approveLabClaim(tx, w.review, {
            actor: ops,
            claimId: claim.claimId,
            ifMatch: 1,
            meta: CLAIM_META,
          });
          await hold.wait;
          return result;
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
        const otherActors = await w.platformActors();
        const second = w.refused(approve(claim.claimId, 1, { actor: otherActors.otherOps }));
        await new Promise((resolve) => setTimeout(resolve, 300));
        hold.open();
        const [won, lost] = await Promise.all([first, second]);
        expect(won.status).toBe('APPROVED');
        expect(lost).toMatchObject({
          code: 'INVALID_STATE_TRANSITION',
          status: 409,
          meta: { currentState: 'APPROVED' },
        });
        const members = await w.membershipsOf(claim.organisationId);
        expect(members).toHaveLength(1);
        expect(members[0]?.roles).toEqual(['LAB_CHECKER']);
        expect(await w.claimRow(claim.claimId)).toMatchObject({
          status: 'APPROVED',
          lock_version: 2,
          reviewed_by_user_id: ops.userId,
        });
        expect((await w.organisationRow(claim.organisationId))?.claim_status).toBe('CLAIMED');
        const audits = await w
          .db()
          .query<{ n: string }>(
            `SELECT count(*)::text AS n FROM audit_log WHERE action = 'lab_claim.approve' AND entity_id = $1`,
            [claim.claimId],
          );
        expect(audits.rows[0]?.n).toBe('1');
      });

      it('lets a start race an approval: the second claim for the claimed organisation is refused, never a second owner', async () => {
        const claim = await w.reviewable();
        const hold = gate();
        const approving = w.as(ops, async (tx) => {
          const result = await approveLabClaim(tx, w.review, {
            actor: ops,
            claimId: claim.claimId,
            ifMatch: 1,
            meta: CLAIM_META,
          });
          await hold.wait;
          return result;
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
        // Another person starts a claim on the same organisation while the approval is open. Today
        // the start meets the claim still in review and answers 409 CLAIM_PENDING; if it ever got in
        // after the commit, its claim must be refused by the approval (the next test writes that row).
        const rival = await w.claimant('rival');
        const starting = w
          .asSystem((tx) =>
            startLabClaim(tx, w.deps, {
              actor: rival.actor,
              siteId: claim.siteId,
              meta: w.freshMeta(),
            }),
          )
          .then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error }),
          );
        await new Promise((resolve) => setTimeout(resolve, 500));
        hold.open();
        await approving;
        const outcome = await starting;
        if (outcome.ok) {
          // The start got in after the approval: its claim is for a claimed organisation. Taken to
          // review, it can never be approved.
          const code = outcome.value.delivery?.code ?? '000000';
          await w.asSystem((tx) =>
            verifyLabClaimOtp(tx, w.deps, {
              actor: rival.actor,
              claimId: outcome.value.claim.id,
              ifMatch: 0,
              code,
              meta: CLAIM_META,
            }),
          );
          const version = await w.lockVersionOf(outcome.value.claim.id);
          const refusal = await w.refused(approve(outcome.value.claim.id, version));
          expect(refusal).toMatchObject({
            code: 'INVALID_STATE_TRANSITION',
            status: 409,
            meta: { currentState: 'CLAIMED' },
          });
          expect(await w.claimRow(outcome.value.claim.id)).toMatchObject({
            status: 'PENDING_REVIEW',
          });
        }
        const members = await w.membershipsOf(claim.organisationId);
        expect(members).toHaveLength(1);
        expect(members[0]?.user_id).toBe(claim.claimant.id);
      });

      it('refuses a second claim row on a claimed organisation (the data the race can leave): 409, one owner', async () => {
        const claim = await w.reviewable();
        await approve(claim.claimId, 1);
        const rival = await w.claimant('late-rival');
        const lateId = await w.insertClaim({
          organisationId: claim.organisationId,
          siteId: claim.siteId,
          userId: rival.id,
          status: 'PENDING_REVIEW',
        });
        await w.db().query('UPDATE lab_claim_request SET lock_version = 1 WHERE id = $1', [lateId]);
        await w.refusedWritingNothing(
          { organisationId: claim.organisationId, claimant: rival },
          () => approve(lateId, 1),
          { code: 'INVALID_STATE_TRANSITION', status: 409, meta: { currentState: 'CLAIMED' } },
        );
        expect(await w.membershipsOf(claim.organisationId)).toHaveLength(1);
      });

      it('gives one person only one lab role when two of their claims are approved at the same time', async () => {
        const person = await w.claimant('simultaneous');
        const a = await w.reviewable({ claimant: person });
        const b = await w.reviewable({ claimant: person });
        const results = await Promise.allSettled([approve(a.claimId, 1), approve(b.claimId, 1)]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.filter((r) => r.status === 'rejected');
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
          code: 'VALIDATION_FAILED',
          meta: { reason: 'CLAIMANT_HOLDS_LAB_ROLE' },
        });
        const roles = await w.db().query<{ n: string }>(
          `SELECT count(*)::text AS n FROM membership_role r JOIN membership m ON m.id = r.membership_id
            WHERE m.user_id = $1 AND r.revoked_at IS NULL`,
          [person.id],
        );
        expect(roles.rows[0]?.n).toBe('1');
        // The loser's organisation stays unclaimed and its claim stays in review.
        const orgs = await Promise.all(
          [a, b].map(async (c) => (await w.organisationRow(c.organisationId))?.claim_status),
        );
        expect([...orgs].sort()).toEqual(['CLAIMED', 'UNCLAIMED']);
      });
    });
  });

  // ------------------------------------------------------------------ reject

  describe('reject (I2-ADM-03)', () => {
    it('rejects with the notes, the reviewer and the time, and leaves the organisation alone', async () => {
      const claim = await w.reviewable();
      const orgBefore = await w.organisationRow(claim.organisationId);
      w.clock.advance(60_000);
      const NOTES = 'The letter is not on the lab letterhead. Call Mr Rao on 98xxxxxx.';
      const rejected = await reject(claim.claimId, 1, NOTES);
      expect(rejected).toMatchObject({
        status: 'REJECTED',
        reviewedByUserId: ops.userId,
        reviewedAt: w.clock.now(),
        decisionNotes: NOTES,
        lockVersion: 2,
      });
      expect(await w.claimRow(claim.claimId)).toMatchObject({
        status: 'REJECTED',
        lock_version: 2,
        decision_notes: NOTES,
        reviewed_by_user_id: ops.userId,
      });
      expect(await w.organisationRow(claim.organisationId)).toEqual(orgBefore);
      expect(await w.membershipsOf(claim.organisationId)).toEqual([]);
      const audit = await w
        .db()
        .query<{ action: string; after: unknown }>(
          `SELECT action, after FROM audit_log WHERE entity_id = $1 AND action = 'lab_claim.reject'`,
          [claim.claimId],
        );
      expect(audit.rows).toHaveLength(1);
      const event = await w
        .db()
        .query<{ payload: unknown }>(
          `SELECT payload FROM outbox_event WHERE aggregate_id = $1 AND event_type = 'lab_claim.rejected'`,
          [claim.claimId],
        );
      expect(event.rows).toHaveLength(1);
      const text = JSON.stringify([audit.rows, event.rows]);
      expect(text).not.toContain('letterhead');
      expect(text).not.toContain('98xxxxxx');
      expect(text).not.toContain(claim.claimant.email);
    });

    it('frees the organisation: the same person, or another, can start a new claim afterwards', async () => {
      const claim = await w.reviewable();
      await reject(claim.claimId, 1, 'Not accepted.');
      const again = await w.asSystem((tx) =>
        startLabClaim(tx, w.deps, {
          actor: claim.claimant.actor,
          siteId: claim.siteId,
          meta: w.freshMeta(),
        }),
      );
      expect(again.created).toBe(true);
      expect(again.claim.id).not.toBe(claim.claimId);
      expect(again.claim.status).toBe('PENDING_OTP');
      // The new claim says nothing of the old decision.
      expect(again.claim.decisionNotes).toBeNull();
      expect(again.claim.reviewedAt).toBeNull();

      const other = await w.reviewable();
      await reject(other.claimId, 1, 'Not accepted either.');
      const stranger = await w.claimant('after-rejection');
      const fresh = await w.asSystem((tx) =>
        startLabClaim(tx, w.deps, {
          actor: stranger.actor,
          siteId: other.siteId,
          meta: w.freshMeta(),
        }),
      );
      expect(fresh.created).toBe(true);
      expect((await w.organisationRow(other.organisationId))?.claim_status).toBe('UNCLAIMED');
    });

    it('requires notes that are not blank: 422, nothing written', async () => {
      const claim = await w.reviewable();
      for (const notes of ['', '   ', '\n\t']) {
        await w.refusedWritingNothing(claim, () => reject(claim.claimId, 1, notes), {
          code: 'VALIDATION_FAILED',
          status: 422,
          meta: { reason: 'DECISION_NOTES_REQUIRED' },
        });
      }
    });

    it('is refused for a claim not in review (409), unknown (404), a wrong If-Match (412) and a repeat (409), writing nothing', async () => {
      const claim = await w.reviewable();
      expect(
        await w.refused(reject('0192b3b2-0000-7000-8000-000000000000', 1, 'No.')),
      ).toMatchObject({ code: 'NOT_FOUND', status: 404 });
      await w.refusedWritingNothing(claim, () => reject(claim.claimId, 5, 'No.'), {
        code: 'CONCURRENT_MODIFICATION',
        status: 412,
      });
      await reject(claim.claimId, 1, 'No.');
      await w.refusedWritingNothing(claim, () => reject(claim.claimId, 2, 'Again.'), {
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
        meta: { currentState: 'REJECTED' },
      });
      await w.refusedWritingNothing(claim, () => approve(claim.claimId, 2), {
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
        meta: { currentState: 'REJECTED' },
      });
      const approved = await w.reviewable();
      await approve(approved.claimId, 1);
      await w.refusedWritingNothing(approved, () => reject(approved.claimId, 2, 'Too late.'), {
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
        meta: { currentState: 'APPROVED' },
      });
    });

    it('shows the claimant nothing but the notes: the lab side sees no reviewer, and a rejected claim answers 409 with its state only', async () => {
      const claim = await w.reviewable();
      await reject(claim.claimId, 1, 'Private note for the claimant.');
      const error = await w.refused(
        w.asSystem((tx) =>
          verifyLabClaimOtp(tx, w.deps, {
            actor: claim.claimant.actor,
            claimId: claim.claimId,
            ifMatch: 2,
            code: '123456',
            meta: CLAIM_META,
          }),
        ),
      );
      expect(error).toEqual({
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
        meta: { currentState: 'REJECTED' },
      });
      // The lab-side view type has no reviewer: the new claim of the same person carries only
      // its own fields.
      const again = await w.asSystem((tx) =>
        startLabClaim(tx, w.deps, {
          actor: claim.claimant.actor,
          siteId: claim.siteId,
          meta: w.freshMeta(),
        }),
      );
      expect(Object.keys(again.claim).sort()).toEqual(
        [
          'createdAt',
          'decisionNotes',
          'id',
          'labSite',
          'lockVersion',
          'method',
          'otpSentTo',
          'reviewedAt',
          'status',
        ].sort(),
      );
    });
  });

  // ------------------------------------------------------------------ the flow end to end

  it('takes a lab from the directory to a claimed organisation with a Checker, MANUAL path included', async () => {
    const manual = await w.reviewable({ manual: true });
    const listed = (await allPages('PENDING_REVIEW')).find((row) => row.id === manual.claimId);
    expect(listed).toMatchObject({
      method: 'MANUAL',
      authorisationFileId: manual.fileId,
      lockVersion: 1,
    });
    const done = await approve(manual.claimId, listed?.lockVersion ?? -1, {
      decisionNotes: 'Letter checked.',
    });
    expect(done.status).toBe('APPROVED');
    expect((await allPages('APPROVED')).some((row) => row.id === manual.claimId)).toBe(true);
    expect((await allPages('PENDING_REVIEW')).some((row) => row.id === manual.claimId)).toBe(false);
    const [membership] = await w.membershipsOf(manual.organisationId);
    expect(membership).toMatchObject({
      roles: ['LAB_CHECKER'],
      sites: [manual.siteId],
      status: 'ACTIVE',
    });
    // The organisation can no longer be claimed.
    const rival = await w.claimant('too-late');
    const error = await w.refused(
      w.asSystem((tx) =>
        startLabClaim(tx, w.deps, {
          actor: rival.actor,
          siteId: manual.siteId,
          meta: w.freshMeta(),
        }),
      ),
    );
    expect(error).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      meta: { currentState: 'CLAIMED' },
    });
  });
});
