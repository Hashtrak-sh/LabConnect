import { randomUUID } from 'node:crypto';
import { type Prisma, withDbContext } from '@labconnect/database';
import { createCustomer } from '@labconnect/database/test-utils';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type AdminLabClaimView,
  approveLabClaim,
  type CurrentActor,
  getLabClaimForReview,
  getMyLabClaim,
  listLabClaimsForReview,
  listMyLabClaims,
  maskEmail,
  rejectLabClaim,
  startLabClaim,
  verifyLabClaimOtp,
} from '../../src/index.js';
import { CLAIM_META, type Claimant } from './labs-claims-support.js';
import { DAY_MS, useClaimReviewWorld } from './labs-claim-review-support.js';

// The claim reads (I2-LAB): `listMyLabClaims`, `getLabClaim` for the claimant (the `system`
// context, every query scoped by the caller's user id) and `getAdminLabClaim`, the site and the
// claimant on the Ops list (the `platform` context), on the real schema and its row-level security.

describe('lab claim reads', () => {
  const w = useClaimReviewWorld();
  let ops: CurrentActor;
  let finance: CurrentActor;
  let steward: CurrentActor;
  let admin: CurrentActor;

  beforeAll(async () => {
    ({ ops, finance, steward, admin } = await w.platformActors());
  });

  // The claimant reads run as `system`, as the API does; Ops reads run as the actor (`platform`).
  const mine = (actor: CurrentActor, input: { cursor?: string; limit?: number } = {}) =>
    w.asSystem((tx) => listMyLabClaims(tx, { clock: w.clock }, { actor, ...input }));
  const mineOne = (actor: CurrentActor, claimId: string) =>
    w.asSystem((tx) => getMyLabClaim(tx, { clock: w.clock }, { actor, claimId }));
  const opsList = (
    actor: CurrentActor,
    input: { status?: AdminLabClaimView['status']; cursor?: string; limit?: number } = {},
  ) => w.as(actor, (tx) => listLabClaimsForReview(tx, w.review, { actor, ...input }));
  const opsOne = (actor: CurrentActor, claimId: string) =>
    w.as(actor, (tx) => getLabClaimForReview(tx, w.review, { actor, claimId }));
  const approve = (claimId: string, ifMatch: number) =>
    w.as(ops, (tx) =>
      approveLabClaim(tx, w.review, { actor: ops, claimId, ifMatch, meta: CLAIM_META }),
    );
  const reject = (claimId: string, ifMatch: number, decisionNotes: string) =>
    w.as(ops, (tx) =>
      rejectLabClaim(tx, w.review, {
        actor: ops,
        claimId,
        ifMatch,
        decisionNotes,
        meta: CLAIM_META,
      }),
    );

  /** A claim still awaiting its code (`PENDING_OTP`), made through the real start. */
  const startOnly = async (claimant?: Claimant, options: { manual?: boolean } = {}) => {
    const site = await w.lab(options.manual === true ? { email: null } : {});
    const who = claimant ?? (await w.claimant());
    const started = await w.asSystem((tx) =>
      startLabClaim(tx, w.deps, { actor: who.actor, siteId: site.siteId, meta: w.freshMeta() }),
    );
    return { site, claimant: who, claimId: started.claim.id, started };
  };
  const agedBy = (claimId: string, ms: number) =>
    w
      .db()
      .query('UPDATE lab_claim_request SET created_at = $2 WHERE id = $1', [
        claimId,
        new Date(w.clock.now().getTime() - ms),
      ]);

  /** The same facts the claimant has, with a membership as a customer: the actor of that session. */
  const customerSession = async (claimant: Claimant): Promise<CurrentActor> => {
    const customer = await w.owner((tx) => createCustomer(tx, { segment: 'BUSINESS' }));
    await w.owner((tx) =>
      w.addMember(tx, claimant.id, customer.organisationId, 'CUSTOMER_REQUESTER'),
    );
    return w.actorOf(claimant.id, customer.organisationId, ['CUSTOMER_REQUESTER'], 'CUSTOMER');
  };

  const LAB_VIEW_KEYS = [
    'createdAt',
    'decisionNotes',
    'id',
    'labSite',
    'lockVersion',
    'method',
    'otpSentTo',
    'reviewedAt',
    'status',
  ];

  // ------------------------------------------------------------------ the claimant

  describe('for the claimant', () => {
    it('lists the caller own claims newest first and nothing of anyone else', async () => {
      const claimant = await w.claimant();
      const first = await startOnly(claimant);
      w.clock.advance(1000);
      const second = await startOnly(claimant);
      const stranger = await startOnly();

      const page = await mine(claimant.actor);
      expect(page.data.map((claim) => claim.id)).toEqual([second.claimId, first.claimId]);
      expect(page.page).toEqual({ nextCursor: null, limit: 25 });
      expect(JSON.stringify(page)).not.toContain(stranger.claimId);
      expect(JSON.stringify(page)).not.toContain(stranger.site.siteCode);

      const empty = await w.claimant('no-claims');
      expect(await mine(empty.actor)).toEqual({
        data: [],
        page: { nextCursor: null, limit: 25 },
      });
    });

    it('carries exactly the fields of the claimant claim and nothing about the organisation, the reviewer or the letterhead', async () => {
      const claim = await w.reviewable({ manual: true });
      const one = await mineOne(claim.claimant.actor, claim.claimId);
      expect(Object.keys(one).sort()).toEqual(LAB_VIEW_KEYS);
      expect(Object.keys(one.labSite).sort()).toEqual(['id', 'name', 'siteCode']);
      const text = JSON.stringify(one);
      for (const secret of [
        claim.organisationId,
        claim.fileId ?? 'none',
        'authorisation',
        'reviewedBy',
      ]) {
        expect(text).not.toContain(secret);
      }
      // The letterhead route has no address; the code route shows the NABL address masked, as the write does.
      expect(one).toMatchObject({ status: 'PENDING_REVIEW', method: 'MANUAL', otpSentTo: null });
      const byCode = await w.reviewable();
      const coded = await mineOne(byCode.claimant.actor, byCode.claimId);
      expect(coded.otpSentTo).toBe(maskEmail(byCode.nablEmail ?? ''));
      expect(JSON.stringify(coded)).not.toContain(byCode.nablEmail ?? 'none');
    });

    it('shows the same claim as the write answered, with the ETag the next write expects', async () => {
      const { claimId, claimant, started } = await startOnly();
      const read = await mineOne(claimant.actor, claimId);
      expect(read).toEqual(started.claim);
      const delivery = started.delivery;
      if (delivery === null) throw new Error('no code was sent');
      // A stale ETag is refused, the one of the read is accepted.
      await expect(
        w.asSystem((tx) =>
          verifyLabClaimOtp(tx, w.deps, {
            actor: claimant.actor,
            claimId,
            ifMatch: read.lockVersion + 1,
            code: delivery.code,
            meta: CLAIM_META,
          }),
        ),
      ).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' });
      const verified = await w.asSystem((tx) =>
        verifyLabClaimOtp(tx, w.deps, {
          actor: claimant.actor,
          claimId,
          ifMatch: read.lockVersion,
          code: delivery.code,
          meta: CLAIM_META,
        }),
      );
      expect(verified).toMatchObject({ ok: true, claim: { status: 'PENDING_REVIEW' } });
      expect((await mineOne(claimant.actor, claimId)).lockVersion).toBe(read.lockVersion + 1);
    });

    it('answers 404 for another user claim and for an unknown id with the same body, and never reads it in a list or cursor', async () => {
      const owner = await startOnly();
      const stranger = await w.claimant('stranger');
      const refusal = async (id: string) => {
        const error = await w.refused(mineOne(stranger.actor, id));
        return error;
      };
      const other = await refusal(owner.claimId);
      const unknown = await refusal(randomUUID());
      expect(other).toEqual(unknown);
      expect(other).toMatchObject({ code: 'NOT_FOUND', status: 404 });
      // A value that is not a UUID is the same 404 in the core (the API answers 422 before this).
      expect(await refusal('not-a-uuid')).toEqual(unknown);
      // A claim id of another kind of record (a site, an organisation, a file) is just unknown.
      expect(await refusal(owner.site.siteId)).toEqual(unknown);
      expect(await refusal(owner.site.organisationId)).toEqual(unknown);

      expect((await mine(stranger.actor)).data).toEqual([]);
      // The cursor of another user's claim is refused like any unreadable cursor.
      const cursor = Buffer.from(JSON.stringify({ i: owner.claimId }), 'utf8').toString(
        'base64url',
      );
      const bad = await w.refused(mine(stranger.actor, { cursor }));
      const garbage = await w.refused(mine(stranger.actor, { cursor: 'garbage' }));
      expect(bad).toEqual(garbage);
      expect(bad).toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    });

    it('does not tell a second claimant who holds the lab: the start answers 409 and the reads show nothing of it', async () => {
      const owner = await startOnly();
      const second = await w.claimant('second');
      expect((await mine(second.actor)).data).toEqual([]);
      await expect(
        w.asSystem((tx) =>
          startLabClaim(tx, w.deps, {
            actor: second.actor,
            siteId: owner.site.siteId,
            meta: w.freshMeta(),
          }),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
      expect((await mine(second.actor)).data).toEqual([]);
      expect((await w.refused(mineOne(second.actor, owner.claimId))).code).toBe('NOT_FOUND');
    });

    it('is refused for platform staff, by the actor and by the user row, before any claim is read', async () => {
      const claim = await w.reviewable();
      for (const actor of [ops, finance, steward, admin]) {
        expect(await w.refused(mine(actor))).toMatchObject({ code: 'FORBIDDEN', status: 403 });
        expect(await w.refused(mineOne(actor, claim.claimId))).toMatchObject({ code: 'FORBIDDEN' });
      }
      const staff = await w.staffWithoutMembership();
      expect(await w.refused(mine(staff.actor))).toMatchObject({ code: 'FORBIDDEN' });
      expect(await w.refused(mineOne(staff.actor, claim.claimId))).toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('belongs to the user, not to an organisation: the same claims under every membership, and under none', async () => {
      const claimant = await w.claimant();
      const claim = await startOnly(claimant);
      const customer = await customerSession(claimant);
      const secondCustomer = await w.owner((tx) => createCustomer(tx, { segment: 'INDIVIDUAL' }));
      await w.owner((tx) =>
        w.addMember(tx, claimant.id, secondCustomer.organisationId, 'CUSTOMER_ADMIN'),
      );
      const second = await w.actorOf(
        claimant.id,
        secondCustomer.organisationId,
        ['CUSTOMER_ADMIN'],
        'CUSTOMER',
      );
      const ids = async (actor: CurrentActor) => (await mine(actor)).data.map((c) => c.id);
      expect(await ids(claimant.actor)).toEqual([claim.claimId]);
      expect(await ids(customer)).toEqual([claim.claimId]);
      expect(await ids(second)).toEqual([claim.claimId]);
      expect((await mineOne(second, claim.claimId)).id).toBe(claim.claimId);
      // Another user in the SAME organisation sees none of it.
      const colleague = await w.claimant('colleague');
      await w.owner((tx) =>
        w.addMember(tx, colleague.id, secondCustomer.organisationId, 'CUSTOMER_REQUESTER'),
      );
      const colleagueActor = await w.actorOf(
        colleague.id,
        secondCustomer.organisationId,
        ['CUSTOMER_REQUESTER'],
        'CUSTOMER',
      );
      expect(await ids(colleagueActor)).toEqual([]);
      expect((await w.refused(mineOne(colleagueActor, claim.claimId))).code).toBe('NOT_FOUND');
    });

    it('lets a claimant who became the lab Checker after approval read the approved claim, without the approval notes', async () => {
      const claim = await w.reviewable();
      const result = await w.as(ops, (tx) =>
        approveLabClaim(tx, w.review, {
          actor: ops,
          claimId: claim.claimId,
          ifMatch: 1,
          decisionNotes: 'INTERNAL: the head of the lab is known to us, skip the visit',
          meta: CLAIM_META,
        }),
      );
      expect(result.decisionNotes).toBe(
        'INTERNAL: the head of the lab is known to us, skip the visit',
      );
      const checker = await w.actorOf(
        claim.claimant.id,
        claim.organisationId,
        ['LAB_CHECKER'],
        'LAB',
        [claim.siteId],
      );
      for (const actor of [claim.claimant.actor, checker]) {
        const one = await mineOne(actor, claim.claimId);
        expect(one).toMatchObject({ status: 'APPROVED', decisionNotes: null });
        expect(one.reviewedAt).toEqual(result.reviewedAt);
        expect(JSON.stringify(await mine(actor))).not.toContain('INTERNAL');
      }
    });

    it('shows the reason of a rejection, with the decision time, and the stored status of a decided claim', async () => {
      const claim = await w.reviewable();
      const rejected = await reject(
        claim.claimId,
        1,
        'The letterhead does not name the laboratory.',
      );
      const one = await mineOne(claim.claimant.actor, claim.claimId);
      expect(one).toMatchObject({
        status: 'REJECTED',
        decisionNotes: 'The letterhead does not name the laboratory.',
        lockVersion: 2,
      });
      expect(one.reviewedAt).toEqual(rejected.reviewedAt);
      expect(JSON.stringify(one)).not.toContain(ops.userId);
    });

    it('reports a pending claim 24 hours old as EXPIRED without writing, and the ETag it gives is refused by the next write', async () => {
      const stale = await startOnly();
      await agedBy(stale.claimId, DAY_MS);
      const fresh = await startOnly();
      await agedBy(fresh.claimId, DAY_MS - 1);
      const review = await w.reviewable();
      await agedBy(review.claimId, 10 * DAY_MS);

      const before = await w.snapshot({
        organisationId: stale.site.organisationId,
        userId: stale.claimant.id,
      });
      const auditBefore = (
        await w.db().query<{ n: string }>('SELECT count(*)::text AS n FROM audit_log')
      ).rows[0]?.n;
      const read = await mineOne(stale.claimant.actor, stale.claimId);
      expect(read).toMatchObject({ status: 'EXPIRED', lockVersion: 0, decisionNotes: null });
      expect((await mine(stale.claimant.actor)).data[0]).toMatchObject({ status: 'EXPIRED' });
      expect(await mineOne(fresh.claimant.actor, fresh.claimId)).toMatchObject({
        status: 'PENDING_OTP',
      });
      // PENDING_REVIEW waits for Ops and never expires.
      expect(await mineOne(review.claimant.actor, review.claimId)).toMatchObject({
        status: 'PENDING_REVIEW',
      });
      // Nothing was written: the row still says PENDING_OTP, and no audit row or outbox event came.
      expect(await w.claimRow(stale.claimId)).toMatchObject({
        status: 'PENDING_OTP',
        lock_version: 0,
      });
      expect(
        (await w.db().query<{ n: string }>('SELECT count(*)::text AS n FROM audit_log')).rows[0]?.n,
      ).toBe(auditBefore);
      expect(
        await w.snapshot({ organisationId: stale.site.organisationId, userId: stale.claimant.id }),
      ).toEqual(before);

      // The write meets it afterwards: expiry committed, the version moves, the read's ETag is dead.
      const delivery = stale.started.delivery;
      if (delivery === null) throw new Error('no code was sent');
      const outcome = await w.asSystem((tx) =>
        verifyLabClaimOtp(tx, w.deps, {
          actor: stale.claimant.actor,
          claimId: stale.claimId,
          ifMatch: read.lockVersion,
          code: delivery.code,
          meta: CLAIM_META,
        }),
      );
      expect(outcome).toEqual({ ok: false, reason: 'CLAIM_EXPIRED' });
      expect(await mineOne(stale.claimant.actor, stale.claimId)).toMatchObject({
        status: 'EXPIRED',
        lockVersion: 1,
      });
    });

    it('pages newest first without a repeat or a gap while claims are created', async () => {
      const claimant = await w.claimant('pager');
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        w.clock.advance(1000);
        ids.push((await startOnly(claimant)).claimId);
        // Only three claims may be open at once: decide each so the next start is allowed.
        const row = await w.claimRow(ids[i] ?? '');
        if (row?.status === 'PENDING_OTP') {
          await w
            .db()
            .query("UPDATE lab_claim_request SET status = 'REJECTED' WHERE id = $1", [ids[i]]);
        }
      }
      const expected = [...ids].reverse();
      const seen: string[] = [];
      const first = await mine(claimant.actor, { limit: 2 });
      seen.push(...first.data.map((c) => c.id));
      // A new claim is created between two pages: it is newer than every cursor.
      w.clock.advance(1000);
      const late = await startOnly(claimant);
      let cursor = first.page.nextCursor;
      while (cursor !== null) {
        const page = await mine(claimant.actor, { limit: 2, cursor });
        seen.push(...page.data.map((c) => c.id));
        cursor = page.page.nextCursor;
      }
      expect(seen).toEqual(expected);
      expect(seen).not.toContain(late.claimId);
      expect((await mine(claimant.actor, { limit: 2 })).data[0]?.id).toBe(late.claimId);
      for (const bad of [0, 101, 1.5]) {
        expect(await w.refused(mine(claimant.actor, { limit: bad }))).toMatchObject({
          code: 'VALIDATION_FAILED',
        });
      }
    });

    it('is held by the owner filter alone under `system`, and row-level security stops a wrong context', async () => {
      const owner = await startOnly();
      const other = await startOnly();
      const everyClaim = 'SELECT id::text AS id FROM lab_claim_request WHERE id = ANY($1::uuid[])';
      const ids = [owner.claimId, other.claimId];
      // As `system` (the context the claimant reads run in) the policy shows every claim: a wrong
      // WHERE clause would leak, which is why every query carries requested_by_user_id.
      const asSystem = await w.asSystem((tx) =>
        tx.$queryRawUnsafe<{ id: string }[]>(everyClaim, ids),
      );
      expect(asSystem.map((row) => row.id).sort()).toEqual([...ids].sort());
      // As a tenant of an unrelated organisation, even WITHOUT a filter the policy hides both.
      const customer = await w.owner((tx) => createCustomer(tx, { segment: 'BUSINESS' }));
      const asStranger = await withDbContext(
        w.api(),
        { kind: 'tenant', orgId: customer.organisationId, userId: owner.claimant.id },
        (tx) => tx.$queryRawUnsafe<{ id: string }[]>(everyClaim, ids),
      );
      expect(asStranger).toEqual([]);
      // The real reads, run in that wrong context, therefore find nothing, not even the owner's own claim.
      const readsInWrongContext = await withDbContext(
        w.api(),
        { kind: 'tenant', orgId: customer.organisationId, userId: owner.claimant.id },
        async (tx) => ({
          list: await listMyLabClaims(tx, { clock: w.clock }, { actor: owner.claimant.actor }),
          one: await getMyLabClaim(
            tx,
            { clock: w.clock },
            { actor: owner.claimant.actor, claimId: owner.claimId },
          ).catch((error: unknown) => (error as { code?: string }).code),
        }),
      );
      expect(readsInWrongContext.list.data).toEqual([]);
      expect(readsInWrongContext.one).toBe('NOT_FOUND');
    });
  });

  // ------------------------------------------------------------------ Ops

  describe('for Ops', () => {
    const OPS_KEYS = [
      'authorisationFileId',
      'claimant',
      'createdAt',
      'decisionNotes',
      'id',
      'labSite',
      'labSiteId',
      'lockVersion',
      'method',
      'organisationId',
      'requestedByUserId',
      'reviewedAt',
      'reviewedByUserId',
      'status',
    ];

    it('shows the site and the claimant on the list and on the one-claim read, the address masked', async () => {
      const claim = await w.reviewable({ manual: true });
      const customer = await w.owner((tx) => createCustomer(tx, { segment: 'BUSINESS' }));
      await w.owner((tx) =>
        w.addMember(tx, claim.claimant.id, customer.organisationId, 'CUSTOMER_REQUESTER'),
      );
      const certificates = await w
        .db()
        .query<{ certificate_no: string }>(
          'SELECT certificate_no FROM accreditation WHERE lab_site_id = $1',
          [claim.siteId],
        );
      const site = await w
        .db()
        .query<{ site_code: string; name: string; state_code: string; city: string | null }>(
          `SELECT site_code, name, state_code, address->>'city' AS city FROM lab_site WHERE id = $1`,
          [claim.siteId],
        );
      const person = await w
        .db()
        .query<{ full_name: string; email: string }>(
          'SELECT full_name, email::text AS email FROM app_user WHERE id = $1',
          [claim.claimant.id],
        );

      const one = await opsOne(ops, claim.claimId);
      const fromList = (await opsList(ops, { status: 'PENDING_REVIEW', limit: 100 })).data.find(
        (row) => row.id === claim.claimId,
      );
      expect(fromList).toEqual(one);
      expect(Object.keys(one).sort()).toEqual(OPS_KEYS);
      expect(one.labSite).toEqual({
        id: claim.siteId,
        siteCode: site.rows[0]?.site_code,
        name: site.rows[0]?.name,
        city: site.rows[0]?.city ?? '',
        stateCode: site.rows[0]?.state_code,
        certificateNos: certificates.rows.map((row) => row.certificate_no).sort(),
      });
      expect(one.claimant).toEqual({
        id: claim.claimant.id,
        fullName: person.rows[0]?.full_name,
        emailMasked: maskEmail(claim.claimant.email),
        organisationTypes: ['CUSTOMER'],
      });
      const text = JSON.stringify(one);
      expect(text).not.toContain(claim.claimant.email);
      expect(text).not.toContain(claim.nablEmail ?? 'none');
      expect(text).not.toContain(customer.organisationId);
      expect(one).toMatchObject({ status: 'PENDING_REVIEW', method: 'MANUAL', lockVersion: 1 });
    });

    it('lists the other organisation types once each, leaves out the claimed organisation and non-active memberships', async () => {
      const claimant = await w.claimant();
      const otherLab = await w.lab({ onboarded: true });
      const first = await w.owner((tx) => createCustomer(tx, { segment: 'BUSINESS' }));
      const second = await w.owner((tx) => createCustomer(tx, { segment: 'GOVERNMENT' }));
      const gone = await w.owner((tx) => createCustomer(tx, { segment: 'BUSINESS' }));
      await w.owner(async (tx) => {
        await w.addMember(tx, claimant.id, first.organisationId, 'CUSTOMER_REQUESTER');
        await w.addMember(tx, claimant.id, second.organisationId, 'CUSTOMER_ADMIN');
        await w.addMember(tx, claimant.id, otherLab.organisationId, 'LAB_MAKER', [
          otherLab.sites[0]?.id ?? '',
        ]);
        const dead = await w.addMember(tx, claimant.id, gone.organisationId, 'CUSTOMER_REQUESTER');
        await tx.membership.update({ where: { id: dead }, data: { status: 'DEACTIVATED' } });
      });
      const started = await startOnly(claimant);
      expect((await opsOne(ops, started.claimId)).claimant.organisationTypes).toEqual([
        'CUSTOMER',
        'LAB',
      ]);
      // A person with no other organisation: empty.
      const alone = await startOnly();
      expect((await opsOne(ops, alone.claimId)).claimant.organisationTypes).toEqual([]);
    });

    it('does not list the claimed organisation as "another" once the claim is approved', async () => {
      const claim = await w.reviewable();
      const approved = await approve(claim.claimId, 1);
      expect(approved.claimant.organisationTypes).toEqual([]);
      expect((await opsOne(ops, claim.claimId)).claimant.organisationTypes).toEqual([]);
      expect(approved.labSite.id).toBe(claim.siteId);
    });

    it('reads a claim of a user who was a claimant before joining the platform, and refuses that user the claimant reads', async () => {
      const lab = await w.lab();
      const team = await w.owner(async (tx) =>
        tx.appUser.findFirstOrThrow({ where: { id: ops.userId } }),
      );
      const claimId = await w.insertClaim({
        organisationId: lab.organisationId,
        siteId: lab.siteId,
        userId: team.id,
        status: 'PENDING_REVIEW',
      });
      const view = await opsOne(ops, claimId);
      expect(view.claimant.id).toBe(ops.userId);
      expect(view.claimant.organisationTypes).toEqual(['PLATFORM']);
      expect(await w.refused(mine(ops))).toMatchObject({ code: 'FORBIDDEN' });
      expect(await w.refused(mineOne(ops, claimId))).toMatchObject({ code: 'FORBIDDEN' });
      // And an approval is still refused for him.
      expect(await w.refused(approve(claimId, view.lockVersion))).toMatchObject({
        code: 'VALIDATION_FAILED',
        meta: { reason: 'CLAIMANT_IS_PLATFORM_STAFF' },
      });
    });

    it('shows the true status, whatever its age, and the ETag is the version approve and reject expect', async () => {
      const stale = await startOnly();
      await agedBy(stale.claimId, DAY_MS);
      const stored = await w.claimRow(stale.claimId);
      const view = await opsOne(ops, stale.claimId);
      expect(view).toMatchObject({ status: 'EXPIRED', lockVersion: stored?.lock_version });
      expect(await w.claimRow(stale.claimId)).toEqual(stored);

      const claim = await w.reviewable();
      const read = await opsOne(ops, claim.claimId);
      await expect(approve(claim.claimId, read.lockVersion + 1)).rejects.toMatchObject({
        code: 'CONCURRENT_MODIFICATION',
      });
      expect(await approve(claim.claimId, read.lockVersion)).toMatchObject({ status: 'APPROVED' });
      const rejected = await w.reviewable();
      const again = await opsOne(ops, rejected.claimId);
      expect(await reject(rejected.claimId, again.lockVersion, 'No.')).toMatchObject({
        status: 'REJECTED',
        claimant: { id: rejected.claimant.id },
      });
    });

    it('answers 404 for an unknown id, a malformed id and an id of another kind of record', async () => {
      const claim = await w.reviewable();
      for (const id of [
        randomUUID(),
        'nope',
        claim.siteId,
        claim.organisationId,
        claim.claimant.id,
      ]) {
        expect(await w.refused(opsOne(ops, id))).toMatchObject({ code: 'NOT_FOUND', status: 404 });
      }
    });

    it('refuses every role but PLATFORM_OPS with 403 before any row is read', async () => {
      const claim = await w.reviewable();
      const lab = await w.lab({ onboarded: true });
      const siteIds = lab.sites.map((site) => site.id);
      const checker = await w.actorOf(
        lab.checkers[0] ?? '',
        lab.organisationId,
        ['LAB_CHECKER'],
        'LAB',
        siteIds,
      );
      const maker = await w.actorOf(
        lab.makers[0] ?? '',
        lab.organisationId,
        ['LAB_MAKER'],
        'LAB',
        siteIds,
      );
      const customer = await customerSession(await w.claimant());
      for (const actor of [
        finance,
        steward,
        admin,
        checker,
        maker,
        customer,
        claim.claimant.actor,
      ]) {
        // The claimant's own actor has no organisation at all: refused before a context is chosen.
        const call =
          actor === claim.claimant.actor
            ? w.refused(
                w.as(actor, (tx) =>
                  getLabClaimForReview(tx, w.review, { actor, claimId: claim.claimId }),
                ),
              )
            : w.refused(opsOne(actor, claim.claimId));
        expect(await call).toMatchObject({ code: 'FORBIDDEN', status: 403 });
        expect(await w.refused(opsList(actor))).toMatchObject({ code: 'FORBIDDEN' });
      }
    });

    it('is not audited and writes nothing', async () => {
      const claim = await w.reviewable();
      const snap = () =>
        w.snapshot({ organisationId: claim.organisationId, userId: claim.claimant.id });
      const before = await snap();
      await opsOne(ops, claim.claimId);
      await opsList(ops, { limit: 100 });
      expect(await snap()).toEqual(before);
    });

    it('adds the site and the claimant with a constant number of queries for a page of 50', async () => {
      const claimants = await Promise.all(
        Array.from({ length: 5 }, (_, i) => w.claimant(`page-${String(i)}`)),
      );
      const labs = await Promise.all([w.lab(), w.lab(), w.lab()]);
      for (let i = 0; i < 52; i += 1) {
        const lab = labs[i % labs.length];
        const claimant = claimants[i % claimants.length];
        if (lab === undefined || claimant === undefined) throw new Error('fixture');
        await w.insertClaim({
          organisationId: lab.organisationId,
          siteId: lab.siteId,
          userId: claimant.id,
          status: 'REJECTED',
        });
      }
      const counted = async (limit: number) => {
        let queries = 0;
        const wrapped = await w.as(ops, async (tx) => {
          const counting = new Proxy(tx, {
            get(target, property, receiver) {
              const value: unknown = Reflect.get(target, property, receiver);
              if (
                typeof property === 'string' &&
                property.startsWith('$query') &&
                typeof value === 'function'
              ) {
                return (...args: unknown[]) => {
                  queries += 1;
                  return (value as (...a: unknown[]) => unknown).apply(target, args);
                };
              }
              if (
                typeof property === 'string' &&
                typeof value === 'object' &&
                value !== null &&
                !property.startsWith('$')
              ) {
                return new Proxy(value, {
                  get(inner, name, innerReceiver) {
                    const fn: unknown = Reflect.get(inner, name, innerReceiver);
                    if (
                      typeof name === 'string' &&
                      /^(find|count|aggregate)/.test(name) &&
                      typeof fn === 'function'
                    ) {
                      return (...args: unknown[]) => {
                        queries += 1;
                        return (fn as (...a: unknown[]) => unknown).apply(inner, args);
                      };
                    }
                    return fn;
                  },
                });
              }
              return value;
            },
          }) as Prisma.TransactionClient;
          return listLabClaimsForReview(counting, w.review, { actor: ops, limit });
        });
        return { queries, size: wrapped.data.length };
      };
      const small = await counted(2);
      const big = await counted(50);
      expect(big.size).toBe(50);
      expect(small.size).toBe(2);
      // One for the claims and four for the site and claimant, whatever the size of the page.
      expect(big.queries).toBe(5);
      expect(small.queries).toBe(5);
    });
  });
});
