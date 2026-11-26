import { randomUUID } from 'node:crypto';
import { uuidv7 } from '@labconnect/database';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  approveLabClaim,
  createLetterheadDownloadTicket,
  type CurrentActor,
  rejectLabClaim,
} from '../../src/index.js';
import { CLAIM_META } from './labs-claims-support.js';
import { useClaimReviewWorld } from './labs-claim-review-support.js';

// I2-ADM-04: the database part of "Ops open the letterhead of a claim" (OQ-225), on the real schema,
// as the API role in the `platform` context. The URL itself is made after the commit by the file
// service (`presignDownload`); these tests also make it, to prove it is in no row the call wrote.

describe('Ops read of a claim letterhead (I2-ADM-04)', () => {
  const w = useClaimReviewWorld();
  let ops: CurrentActor;
  let finance: CurrentActor;
  let steward: CurrentActor;
  let admin: CurrentActor;
  let otherOps: CurrentActor;

  beforeAll(async () => {
    ({ ops, finance, steward, admin, otherOps } = await w.platformActors());
  });

  const read = (claimId: string, over: { actor?: CurrentActor } = {}) => {
    const actor = over.actor ?? ops;
    return w.as(actor, (tx) =>
      createLetterheadDownloadTicket(tx, w.review, { actor, claimId, meta: w.freshMeta() }),
    );
  };

  const state = async () => ({
    audit: (await w.db().query<{ n: string }>('SELECT count(*)::text AS n FROM audit_log')).rows[0]
      ?.n,
    outbox: (await w.db().query<{ n: string }>('SELECT count(*)::text AS n FROM outbox_event'))
      .rows[0]?.n,
  });

  const claimSnapshot = async (claimId: string) =>
    /^[0-9a-f-]{36}$/.test(claimId)
      ? (
          await w
            .db()
            .query<{ row: string }>(
              'SELECT to_jsonb(c)::text AS row FROM lab_claim_request c WHERE id = $1',
              [claimId],
            )
        ).rows[0]?.row
      : undefined;

  const letterheadAudit = async (claimId: string) =>
    (
      await w.db().query<{
        action: string;
        entity_type: string;
        entity_id: string;
        after: Record<string, unknown>;
        actor_user_id: string | null;
        actor_role: string | null;
        request_id: string | null;
      }>(
        `SELECT action, entity_type, entity_id, after, actor_user_id, actor_role, request_id
           FROM audit_log WHERE action = 'lab_claim.letterhead_download_url_created' AND entity_id = $1
          ORDER BY occurred_at`,
        [claimId],
      )
    ).rows;

  /** Reads and expects a refusal that wrote nothing: no audit row, no event, the claim as it was. */
  const refusedWithNoTrace = async (
    claimId: string,
    expected: { code: string; status: number },
    over: { actor?: CurrentActor } = {},
  ) => {
    const before = { ...(await state()), claim: await claimSnapshot(claimId) };
    expect(await w.refused(read(claimId, over))).toMatchObject(expected);
    expect({ ...(await state()), claim: await claimSnapshot(claimId) }).toEqual(before);
  };

  /** A second file linked to a claim as the claim flow links one (a letterhead upload). */
  const linkedFile = async (
    claim: { claimId: string; claimant: { id: string; actor: CurrentActor } },
    options: {
      purpose?: 'KYC_DOCUMENT' | 'BOOKING_ATTACHMENT';
      ownerOrgId?: string | null;
      scan?: 'CLEAN' | 'PENDING' | 'INFECTED' | 'REJECTED' | 'ERROR';
    } = {},
  ) => {
    const ticket = await w.asSystem((tx) =>
      w.fileService.requestUpload(tx, {
        purpose: options.purpose ?? 'KYC_DOCUMENT',
        ownerOrgId: options.ownerOrgId ?? null,
        declaredContentType: 'application/pdf',
        declaredSizeBytes: 90_000,
        uploadedByUserId: claim.claimant.id,
      }),
    );
    await w.db().query(
      `INSERT INTO file_link (id, file_id, entity_type, entity_id, role, created_by_user_id)
       VALUES ($1, $2, 'lab_claim_request', $3, 'CLAIM_LETTERHEAD', $4)`,
      [uuidv7(w.clock.now().getTime()), ticket.fileId, claim.claimId, claim.claimant.id],
    );
    const scan = options.scan ?? 'CLEAN';
    if (scan !== 'PENDING') await w.settle(ticket.fileId, scan);
    return ticket.fileId;
  };

  const pointClaimAt = (claimId: string, fileId: string | null) =>
    w
      .db()
      .query('UPDATE lab_claim_request SET authorisation_file_id = $2 WHERE id = $1', [
        claimId,
        fileId,
      ]);

  // ------------------------------------------------------------------ the happy paths

  it('gives a PENDING_REVIEW manual claim its own clean letterhead: a 15-minute attachment ticket, one audit entry, nothing else written', async () => {
    const claim = await w.reviewable({ manual: true });
    expect(claim.fileId).not.toBeNull();
    const claimBefore = await claimSnapshot(claim.claimId);
    const before = await state();
    const meta = { requestId: 'req-letterhead-1', ipAddress: '203.0.113.77', userAgent: 'vitest' };

    const { ticket } = await w.as(ops, (tx) =>
      createLetterheadDownloadTicket(tx, w.review, { actor: ops, claimId: claim.claimId, meta }),
    );
    expect(ticket.fileId).toBe(claim.fileId);
    expect(ticket.purpose).toBe('KYC_DOCUMENT');

    const url = await w.fileService.presignDownload(ticket);
    expect(url.downloadUrl.length).toBeGreaterThan(10);
    expect(url.expiresAt.getTime() - w.clock.now().getTime()).toBe(15 * 60 * 1000);

    // The claim did not move; no event; two audit rows (the claim's and the file service's).
    expect(await claimSnapshot(claim.claimId)).toBe(claimBefore);
    const after = await state();
    expect(Number(after.audit) - Number(before.audit)).toBe(2);
    expect(after.outbox).toBe(before.outbox);

    const rows = await letterheadAudit(claim.claimId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'lab_claim.letterhead_download_url_created',
      entity_type: 'lab_claim_request',
      entity_id: claim.claimId,
      actor_user_id: ops.userId,
      actor_role: 'PLATFORM_OPS',
      request_id: 'req-letterhead-1',
      after: { claimId: claim.claimId, fileId: claim.fileId, claimStatus: 'PENDING_REVIEW' },
    });
    expect(Object.keys(rows[0]?.after ?? {}).sort()).toEqual(['claimId', 'claimStatus', 'fileId']);
    const fileAudit = await w
      .db()
      .query<{ after: unknown }>(
        `SELECT after FROM audit_log WHERE action = 'file.download_url' AND entity_id = $1`,
        [claim.fileId],
      );
    expect(fileAudit.rows).toHaveLength(1);
  });

  it('writes the URL, the storage key and the file name into no audit row and no event', async () => {
    const claim = await w.reviewable({ manual: true });
    const { ticket } = await read(claim.claimId);
    const url = await w.fileService.presignDownload(ticket);
    const key = await w
      .db()
      .query<{ object_key: string; original_filename: string | null }>(
        'SELECT object_key, original_filename FROM file_object WHERE id = $1',
        [claim.fileId],
      );
    const storedKey = key.rows[0]?.object_key ?? '';
    expect(storedKey).not.toBe('');
    const everything = JSON.stringify([
      (await w.db().query('SELECT to_jsonb(a)::text FROM audit_log a')).rows,
      (await w.db().query('SELECT to_jsonb(o)::text FROM outbox_event o')).rows,
    ]);
    expect(everything).not.toContain(url.downloadUrl);
    expect(everything).not.toContain(new URL(url.downloadUrl).search.slice(1, 40));
    expect(everything).not.toContain(storedKey);
    expect(everything).not.toContain('Signed letter from Asha Rao');
    expect(everything).not.toContain('X-Amz');
  });

  it('serves a decided claim too: APPROVED and REJECTED', async () => {
    const approved = await w.reviewable({ manual: true });
    await w.as(ops, (tx) =>
      approveLabClaim(tx, w.review, {
        actor: ops,
        claimId: approved.claimId,
        ifMatch: 1,
        meta: CLAIM_META,
      }),
    );
    const rejected = await w.reviewable({ manual: true });
    await w.as(ops, (tx) =>
      rejectLabClaim(tx, w.review, {
        actor: ops,
        claimId: rejected.claimId,
        ifMatch: 1,
        decisionNotes: 'Not signed.',
        meta: CLAIM_META,
      }),
    );
    for (const [claim, status] of [
      [approved, 'APPROVED'],
      [rejected, 'REJECTED'],
    ] as const) {
      const { ticket } = await read(claim.claimId);
      expect(ticket.fileId).toBe(claim.fileId);
      expect((await letterheadAudit(claim.claimId))[0]?.after).toMatchObject({
        claimStatus: status,
      });
    }
  });

  it('writes one audit entry per request, and another Ops user may read it too (the entry names who)', async () => {
    const claim = await w.reviewable({ manual: true });
    await read(claim.claimId);
    await read(claim.claimId, { actor: otherOps });
    const rows = await letterheadAudit(claim.claimId);
    expect(rows.map((r) => r.actor_user_id).sort()).toEqual([ops.userId, otherOps.userId].sort());
  });

  // ------------------------------------------------------------------ 404: no claim, no letterhead

  it('answers NOT_FOUND for an unknown claim, a malformed id, and a FILE id given as the claim id', async () => {
    const claim = await w.reviewable({ manual: true });
    await refusedWithNoTrace(randomUUID(), { code: 'NOT_FOUND', status: 404 });
    await refusedWithNoTrace('not-a-uuid', { code: 'NOT_FOUND', status: 404 });
    // The caller sends a claim id, never a file id.
    await refusedWithNoTrace(claim.fileId ?? '', { code: 'NOT_FOUND', status: 404 });
  });

  it('answers NOT_FOUND for a claim with no letterhead (made by code, any status)', async () => {
    const byCode = await w.reviewable();
    expect(byCode.method).toBe('EMAIL_OTP');
    await refusedWithNoTrace(byCode.claimId, { code: 'NOT_FOUND', status: 404 });
    await w.as(ops, (tx) =>
      approveLabClaim(tx, w.review, {
        actor: ops,
        claimId: byCode.claimId,
        ifMatch: 1,
        meta: CLAIM_META,
      }),
    );
    await refusedWithNoTrace(byCode.claimId, { code: 'NOT_FOUND', status: 404 });
  });

  // ------------------------------------------------------------------ 422: the file is not clean

  it.each(['PENDING', 'INFECTED', 'REJECTED', 'ERROR'] as const)(
    'answers FILE_NOT_CLEAN, and gives no ticket, for a letterhead whose scan is %s',
    async (status) => {
      const claim = await w.reviewable({ manual: true });
      const file = await linkedFile(claim, { scan: status });
      await pointClaimAt(claim.claimId, file);
      await refusedWithNoTrace(claim.claimId, { code: 'FILE_NOT_CLEAN', status: 422 });
    },
  );

  // ------------------------------------------------------------------ 403: who may call

  it('refuses every role but PLATFORM_OPS with 403 before any row is read, and writes nothing', async () => {
    const claim = await w.reviewable({ manual: true });
    const lab = await w.lab({ onboarded: true });
    const checker = await w.actorOf(
      lab.checkers[0] ?? '',
      lab.organisationId,
      ['LAB_CHECKER'],
      'LAB',
      lab.sites.map((site) => site.id),
    );
    for (const actor of [finance, steward, admin, checker]) {
      await refusedWithNoTrace(claim.claimId, { code: 'FORBIDDEN', status: 403 }, { actor });
      // Even for an id that does not exist: the role is refused first.
      await refusedWithNoTrace(randomUUID(), { code: 'FORBIDDEN', status: 403 }, { actor });
    }
  });

  it('refuses the claimant, who uploaded the letterhead, and a member of the lab once it is claimed', async () => {
    const claim = await w.reviewable({ manual: true });
    await refusedWithNoTrace(
      claim.claimId,
      { code: 'FORBIDDEN', status: 403 },
      { actor: claim.claimant.actor },
    );
    await w.as(ops, (tx) =>
      approveLabClaim(tx, w.review, {
        actor: ops,
        claimId: claim.claimId,
        ifMatch: 1,
        meta: CLAIM_META,
      }),
    );
    // The claimant is now the lab's Checker: still not Ops.
    const member = await w.actorOf(
      claim.claimant.id,
      claim.organisationId,
      ['LAB_CHECKER'],
      'LAB',
      [claim.siteId],
    );
    await refusedWithNoTrace(claim.claimId, { code: 'FORBIDDEN', status: 403 }, { actor: member });
  });

  it('refuses a platform actor that was built without the PLATFORM_OPS role, and an Ops user acting under another organisation', async () => {
    const claim = await w.reviewable({ manual: true });
    // A user who holds PLATFORM_OPS but whose active membership is another organisation's is not
    // a platform actor: the role check looks at the actor, not at the user.
    const lab = await w.lab({ onboarded: true });
    const asLab: CurrentActor = {
      ...ops,
      membershipId: null,
      orgId: lab.organisationId,
      orgType: 'LAB',
      isPlatform: false,
    };
    await refusedWithNoTrace(claim.claimId, { code: 'FORBIDDEN', status: 403 }, { actor: asLab });
    const noRole: CurrentActor = { ...ops, roles: ['PLATFORM_ADMIN'] };
    await refusedWithNoTrace(claim.claimId, { code: 'FORBIDDEN', status: 403 }, { actor: noRole });
  });

  // ------------------------------------------------------------------ which file: the "think beyond" cases

  describe('which file is returned', () => {
    it("never another claim's file: a claim whose authorisation_file_id names a file linked to a different claim has no letterhead", async () => {
      const first = await w.reviewable({ manual: true });
      const second = await w.reviewable({ manual: true });
      await pointClaimAt(second.claimId, first.fileId);
      await refusedWithNoTrace(second.claimId, { code: 'NOT_FOUND', status: 404 });
      // The first claim still opens its own file.
      expect((await read(first.claimId)).ticket.fileId).toBe(first.fileId);
    });

    it('never a file that is not linked to the claim at all, even a clean letterhead-purpose one of the same claimant', async () => {
      const claim = await w.reviewable({ manual: true });
      const stray = await w.asSystem((tx) =>
        w.fileService.requestUpload(tx, {
          purpose: 'KYC_DOCUMENT',
          ownerOrgId: null,
          declaredContentType: 'application/pdf',
          declaredSizeBytes: 90_000,
          uploadedByUserId: claim.claimant.id,
        }),
      );
      await w.settle(stray.fileId, 'CLEAN');
      await pointClaimAt(claim.claimId, stray.fileId);
      await refusedWithNoTrace(claim.claimId, { code: 'NOT_FOUND', status: 404 });
    });

    it('never a file of another purpose that happens to carry the letterhead link', async () => {
      const claim = await w.reviewable({ manual: true });
      const other = await linkedFile(claim, { purpose: 'BOOKING_ATTACHMENT' });
      await pointClaimAt(claim.claimId, other);
      await refusedWithNoTrace(claim.claimId, { code: 'NOT_FOUND', status: 404 });
    });

    it('never a file owned by an organisation, even with the right purpose and link', async () => {
      const claim = await w.reviewable({ manual: true });
      const owned = await linkedFile(claim, { ownerOrgId: claim.organisationId });
      await pointClaimAt(claim.claimId, owned);
      await refusedWithNoTrace(claim.claimId, { code: 'NOT_FOUND', status: 404 });
    });

    it('never a file whose link to the claim was removed', async () => {
      const claim = await w.reviewable({ manual: true });
      await w
        .db()
        .query(`UPDATE file_link SET removed_at = now() WHERE entity_id = $1 AND file_id = $2`, [
          claim.claimId,
          claim.fileId,
        ]);
      await refusedWithNoTrace(claim.claimId, { code: 'NOT_FOUND', status: 404 });
    });

    it('a file uploaded later for the same claim is not the letterhead: the claim names its file', async () => {
      const claim = await w.reviewable({ manual: true });
      const later = await linkedFile(claim);
      expect(later).not.toBe(claim.fileId);
      const { ticket } = await read(claim.claimId);
      expect(ticket.fileId).toBe(claim.fileId);
    });

    it('a claim with no authorisation_file_id has no letterhead even if files are linked to it', async () => {
      const claim = await w.reviewable({ manual: true });
      await pointClaimAt(claim.claimId, null);
      await refusedWithNoTrace(claim.claimId, { code: 'NOT_FOUND', status: 404 });
    });
  });
});
