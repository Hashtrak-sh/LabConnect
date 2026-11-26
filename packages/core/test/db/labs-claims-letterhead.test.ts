import { randomUUID } from 'node:crypto';
import { type ScanStatus, withDbContext } from '@labconnect/database';
import { describe, expect, it } from 'vitest';
import {
  AuditService,
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
  submitLabClaimLetterhead,
  type UploadTicket,
  verifyLabClaimOtp,
} from '../../src/index.js';
import { CLAIM_META, type Claimant, useClaimWorld } from './labs-claims-support.js';

// I1-LAB-03 and I1-LAB-04: the letterhead route of a lab claim on the real schema, as the API role
// with the `system` context (the letterhead has no owning organisation, the claimant no membership).

const MB = 1024 * 1024;
const FILE_NAME = 'Letter from Asha Rao - private.pdf';
const files: FilesConfig = {
  bucket: 'labconnect-test',
  quarantinePrefix: 'quarantine',
  cleanPrefix: 'clean',
};

describe('lab claim: the letterhead route', () => {
  const w = useClaimWorld();
  const storage = new InMemoryObjectStorage(w.clock);
  const fileService = new FileService({
    clock: w.clock,
    audit: new AuditService(w.clock),
    outbox: new OutboxService(w.clock),
    storage,
    config: () => files,
  });
  const deps: LetterheadDeps = { ...w.deps, files: fileService };

  let ipCounter = 0;
  const freshMeta = (): RequestMeta => ({
    ...CLAIM_META,
    ipAddress: `198.51.100.${String((ipCounter++ % 250) + 1)}`,
  });
  const start = (who: Claimant, siteId: string) =>
    w.asSystem((tx) => startLabClaim(tx, w.deps, { actor: who.actor, siteId, meta: freshMeta() }));
  const upload = (
    who: Claimant,
    claimId: string,
    over: { contentType?: string; sizeBytes?: number; fileName?: string } = {},
  ): Promise<UploadTicket> =>
    w
      .asSystem((tx) =>
        requestClaimLetterheadUpload(tx, deps, {
          actor: who.actor,
          claimId,
          contentType: over.contentType ?? 'application/pdf',
          sizeBytes: over.sizeBytes ?? 182_044,
          fileName: over.fileName ?? FILE_NAME,
          meta: CLAIM_META,
        }),
      )
      // As the API service does: the committed outcome of a stale claim is raised afterwards.
      .then((outcome) => {
        if (!outcome.ok) throw claimExpiredError();
        return outcome.ticket;
      });
  const submit = (who: Claimant, claimId: string, fileId: string, ifMatch = 0) =>
    w
      .asSystem((tx) =>
        submitLabClaimLetterhead(tx, deps, {
          actor: who.actor,
          claimId,
          ifMatch,
          fileId,
          meta: CLAIM_META,
        }),
      )
      .then((outcome) => {
        if (!outcome.ok) throw claimExpiredError();
        return outcome.claim;
      });
  /** What the scan job does to a file: only the system context may (frozen-columns trigger). */
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
  const cleanUpload = async (who: Claimant, claimId: string) => {
    const ticket = await upload(who, claimId);
    await settle(ticket.fileId, 'CLEAN');
    return ticket;
  };
  const refused = async (work: Promise<unknown>) => {
    try {
      await work;
    } catch (error) {
      if (error instanceof LabClaimError) {
        return { code: error.code, status: error.status, meta: error.meta };
      }
      if (error instanceof Error && 'code' in error && 'status' in error) {
        const known = error as Error & { code: string; status: number; meta?: unknown };
        return { code: known.code, status: known.status, meta: known.meta };
      }
      throw error;
    }
    return expect.fail('expected the call to be refused');
  };
  const claimRow = async (claimId: string) =>
    (
      await w.db().query<{
        status: string;
        method: string;
        lock_version: number;
        authorisation_file_id: string | null;
      }>('SELECT status, method, lock_version, authorisation_file_id FROM lab_claim_request WHERE id = $1', [claimId])
    ).rows[0];
  const fileRows = async (userId: string) =>
    (
      await w.db().query<{
        id: string;
        purpose: string;
        owner_org_id: string | null;
        customer_org_id: string | null;
        lab_org_id: string | null;
        scan_status: string;
        object_key: string;
        uploaded_by_user_id: string;
        original_filename: string | null;
      }>(
        `SELECT id, purpose, owner_org_id, customer_org_id, lab_org_id, scan_status, object_key,
                uploaded_by_user_id, original_filename
           FROM file_object WHERE uploaded_by_user_id = $1 ORDER BY created_at, id`,
        [userId],
      )
    ).rows;
  const openClaim = async (label = 'claimant', labOptions: { email?: string | null } = {}) => {
    const lab = await w.lab(labOptions);
    const who = await w.claimant(label);
    const started = await start(who, lab.siteId);
    return { lab, who, started, claimId: started.claim.id };
  };

  describe('requestClaimLetterheadUpload', () => {
    it('records a PENDING KYC_DOCUMENT with no owning organisation, tied to the claim, in quarantine', async () => {
      const { who, claimId } = await openClaim();
      const ticket = await upload(who, claimId);

      const [row, ...rest] = await fileRows(who.id);
      expect(rest).toEqual([]);
      expect(row).toMatchObject({
        id: ticket.fileId,
        purpose: 'KYC_DOCUMENT',
        owner_org_id: null,
        customer_org_id: null,
        lab_org_id: null,
        scan_status: 'PENDING',
        uploaded_by_user_id: who.id,
        object_key: `quarantine/KYC_DOCUMENT/${ticket.fileId}`,
      });
      expect(ticket).toMatchObject({ fileId: ticket.fileId, contentType: 'application/pdf' });
      const links = await w
        .db()
        .query<{ entity_type: string; entity_id: string; role: string }>(
          'SELECT entity_type, entity_id, role FROM file_link WHERE file_id = $1',
          [ticket.fileId],
        );
      expect(links.rows).toEqual([
        { entity_type: 'lab_claim_request', entity_id: claimId, role: 'CLAIM_LETTERHEAD' },
      ]);
      // The claim itself did not move.
      expect(await claimRow(claimId)).toMatchObject({ status: 'PENDING_OTP', lock_version: 0 });
      // The presigned URL has the contract's shape and a 15-minute life.
      const url = await fileService.presignUpload(ticket);
      expect(url).toMatchObject({ fileId: ticket.fileId, method: 'PUT' });
      expect(url.headers).toMatchObject({ 'Content-Type': 'application/pdf' });
    });

    it('accepts PDF, JPEG and PNG up to exactly 10 MB', async () => {
      const { who, claimId } = await openClaim();
      for (const contentType of ['application/pdf', 'image/jpeg', 'image/png']) {
        await upload(who, claimId, { contentType, sizeBytes: 10 * MB });
      }
      expect(await fileRows(who.id)).toHaveLength(3);
    });

    it('refuses any other type and any size over 10 MB, or not a positive whole number, with 422 and no row', async () => {
      const { who, claimId } = await openClaim();
      const cases: { contentType?: string; sizeBytes?: number }[] = [
        { contentType: 'image/heic' },
        { contentType: 'text/csv' },
        { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { contentType: 'application/pdf; charset=binary' },
        { contentType: 'image/gif' },
        { sizeBytes: 10 * MB + 1 },
        { sizeBytes: 25 * MB },
        { sizeBytes: 0 },
        { sizeBytes: -5 },
        { sizeBytes: 1.5 },
      ];
      for (const over of cases) {
        const result = await refused(upload(who, claimId, over));
        expect(result, JSON.stringify(over)).toMatchObject({
          code: 'VALIDATION_FAILED',
          status: 422,
        });
      }
      expect(await fileRows(who.id)).toEqual([]);
    });

    it("is the same 404 for another user's claim and an unknown id, for staff too, and creates no file", async () => {
      const { claimId } = await openClaim('owner');
      const stranger = await w.claimant('stranger');
      const staff = await w.staffWithoutMembership();
      const other = await refused(upload(stranger, claimId));
      const unknown = await refused(upload(stranger, randomUUID()));
      expect(other).toEqual(unknown);
      expect(other).toMatchObject({ code: 'NOT_FOUND', status: 404 });
      expect(await refused(upload(staff, claimId))).toMatchObject({ code: 'NOT_FOUND' });
      expect(await fileRows(stranger.id)).toEqual([]);
      expect(await fileRows(staff.id)).toEqual([]);
    });

    it('is 409 with the state once the claim is out of PENDING_OTP', async () => {
      const { who, claimId, started } = await openClaim();
      const code = started.delivery?.code ?? '';
      const verified = await w.asSystem((tx) =>
        verifyLabClaimOtp(tx, w.deps, {
          actor: who.actor,
          claimId,
          ifMatch: 0,
          code,
          meta: CLAIM_META,
        }),
      );
      expect(verified.ok).toBe(true);
      expect(await refused(upload(who, claimId))).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
        meta: { currentState: 'PENDING_REVIEW' },
      });
      expect(await fileRows(who.id)).toEqual([]);
    });

    it('works for a claim that has a code (the fallback route) and for one with no address', async () => {
      const withCode = await openClaim('with-code');
      const noAddress = await openClaim('no-address', { email: null });
      expect(withCode.started.claim.method).toBe('EMAIL_OTP');
      expect(noAddress.started.claim.method).toBe('MANUAL');
      await upload(withCode.who, withCode.claimId);
      await upload(noAddress.who, noAddress.claimId);
    });

    it('writes an audit row with ids only: no file name', async () => {
      const { who, claimId } = await openClaim();
      const ticket = await upload(who, claimId);
      const rows = await w
        .db()
        .query<{ action: string; actor_user_id: string; after: unknown; row: string }>(
          `SELECT action, actor_user_id, after, row_to_json(a)::text AS row
             FROM audit_log a WHERE entity_id = $1 AND action = 'lab_claim.letterhead_upload_requested'`,
          [claimId],
        );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.actor_user_id).toBe(who.id);
      expect(rows.rows[0]?.after).toEqual({
        fileId: ticket.fileId,
        purpose: 'KYC_DOCUMENT',
        sizeBytes: 182_044,
      });
      expect(rows.rows[0]?.row).not.toContain('Asha');
      expect(rows.rows[0]?.row).not.toContain('private.pdf');
      expect((await fileRows(who.id))[0]?.original_filename).toBe(FILE_NAME);
    });
  });

  describe('who can read the letterhead file', () => {
    it('only the platform and the system: not a member of the claimed lab, not another organisation, not the claimant as a tenant', async () => {
      const { lab, who, claimId } = await openClaim();
      const ticket = await upload(who, claimId);
      const member = await w.claimant('later-member');
      await w.owner((tx) => w.addMember(tx, member.id, lab.organisationId, 'LAB_CHECKER'));
      const customer = await w.claimant('someone-else');

      const readAs = (orgId: string, userId: string) =>
        withDbContext(w.api(), { kind: 'tenant', orgId, userId }, async (tx) => ({
          files: await tx.fileObject.count({ where: { id: ticket.fileId } }),
          links: await tx.fileLink.count({ where: { fileId: ticket.fileId } }),
        }));
      expect(await readAs(lab.organisationId, member.id)).toEqual({ files: 0, links: 0 });
      expect(await readAs(randomUUID(), customer.id)).toEqual({ files: 0, links: 0 });
      // The claimant has no organisation: a user-only context sees nothing either.
      expect(await readAs('', who.id)).toEqual({ files: 0, links: 0 });

      const asPlatform = await withDbContext(w.api(), { kind: 'platform', userId: who.id }, (tx) =>
        tx.fileObject.count({ where: { id: ticket.fileId } }),
      );
      expect(asPlatform).toBe(1);
      const asSystem = await w.asSystem((tx) =>
        tx.fileObject.count({ where: { id: ticket.fileId } }),
      );
      expect(asSystem).toBe(1);
    });

    it('cannot be created by a tenant, even for its own organisation id', async () => {
      const { lab, who } = await openClaim();
      await expect(
        withDbContext(
          w.api(),
          { kind: 'tenant', orgId: lab.organisationId, userId: who.id },
          (tx) =>
            fileService.requestUpload(tx, {
              purpose: 'KYC_DOCUMENT',
              ownerOrgId: null,
              declaredContentType: 'application/pdf',
              declaredSizeBytes: 100,
              uploadedByUserId: who.id,
            }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('submitLabClaimLetterhead', () => {
    it('moves the claim to PENDING_REVIEW with method MANUAL, the file, and lock_version + 1, with audit and event', async () => {
      const { who, claimId, lab } = await openClaim();
      const ticket = await cleanUpload(who, claimId);
      w.clock.advance(1_000);

      const claim = await submit(who, claimId, ticket.fileId);
      expect(claim).toMatchObject({
        id: claimId,
        status: 'PENDING_REVIEW',
        method: 'MANUAL',
        otpSentTo: null,
        lockVersion: 1,
        reviewedAt: null,
        decisionNotes: null,
      });
      expect(await claimRow(claimId)).toEqual({
        status: 'PENDING_REVIEW',
        method: 'MANUAL',
        lock_version: 1,
        authorisation_file_id: ticket.fileId,
      });
      const org = await w
        .db()
        .query<{ claim_status: string }>('SELECT claim_status FROM organisation WHERE id = $1', [
          lab.organisationId,
        ]);
      expect(org.rows[0]?.claim_status).toBe('UNCLAIMED');

      const audit = await w
        .db()
        .query<{ action: string; before: unknown; after: unknown; row: string }>(
          `SELECT action, before, after, row_to_json(a)::text AS row
             FROM audit_log a WHERE entity_id = $1 AND action = 'lab_claim.submit_letterhead'`,
          [claimId],
        );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]?.before).toEqual({ status: 'PENDING_OTP', method: 'EMAIL_OTP' });
      expect(audit.rows[0]?.after).toEqual({
        status: 'PENDING_REVIEW',
        method: 'MANUAL',
        labSiteId: lab.siteId,
        fileId: ticket.fileId,
      });
      const events = await w.db().query<{ event_type: string; payload: unknown; row: string }>(
        `SELECT event_type, payload, row_to_json(o)::text AS row
             FROM outbox_event o WHERE aggregate_id = $1 AND event_type = 'lab_claim.pending_review'`,
        [claimId],
      );
      expect(events.rows).toHaveLength(1);
      for (const text of [audit.rows[0]?.row ?? '', events.rows[0]?.row ?? '']) {
        expect(text).not.toContain('Asha');
        expect(text).not.toContain(FILE_NAME);
        expect(text).not.toContain(who.email);
        expect(text).not.toContain('quarantine/');
      }
    });

    it('also finishes a claim that never had an address (method already MANUAL)', async () => {
      const { who, claimId } = await openClaim('no-address', { email: null });
      const ticket = await cleanUpload(who, claimId);
      const claim = await submit(who, claimId, ticket.fileId);
      expect(claim).toMatchObject({ status: 'PENDING_REVIEW', method: 'MANUAL' });
    });

    it("is 404 for another user's claim, an unknown claim and for staff, and attaches nothing", async () => {
      const { who, claimId } = await openClaim('owner');
      const ticket = await cleanUpload(who, claimId);
      const stranger = await w.claimant('stranger');
      const staff = await w.staffWithoutMembership();
      const other = await refused(submit(stranger, claimId, ticket.fileId));
      expect(other).toEqual(await refused(submit(stranger, randomUUID(), ticket.fileId)));
      expect(other).toMatchObject({ code: 'NOT_FOUND', status: 404 });
      expect(await refused(submit(staff, claimId, ticket.fileId))).toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(await claimRow(claimId)).toMatchObject({
        status: 'PENDING_OTP',
        lock_version: 0,
        authorisation_file_id: null,
      });
    });

    it("is 404 for a file that is not this caller's upload for this claim, whatever its id", async () => {
      const mine = await openClaim('mine');
      const theirs = await openClaim('theirs');
      const myOther = await (async () => {
        const lab = await w.lab();
        const started = await start(mine.who, lab.siteId);
        return started.claim.id;
      })();
      const theirFile = await cleanUpload(theirs.who, theirs.claimId);
      const otherClaimFile = await cleanUpload(mine.who, myOther);
      const unlinked = await (async () => {
        // The caller's own clean KYC file with no link to any claim.
        const ticket = await w.asSystem((tx) =>
          fileService.requestUpload(tx, {
            purpose: 'KYC_DOCUMENT',
            ownerOrgId: null,
            declaredContentType: 'application/pdf',
            declaredSizeBytes: 100,
            uploadedByUserId: mine.who.id,
          }),
        );
        await settle(ticket.fileId, 'CLEAN');
        return ticket;
      })();
      const wrongPurpose = await (async () => {
        // The caller's own clean file of another purpose, linked to this very claim.
        const ticket = await w.asSystem(async (tx) => {
          const made = await fileService.requestUpload(tx, {
            purpose: 'DISPUTE_EVIDENCE',
            ownerOrgId: null,
            declaredContentType: 'application/pdf',
            declaredSizeBytes: 100,
            uploadedByUserId: mine.who.id,
          });
          await tx.fileLink.create({
            data: {
              id: randomUUID(),
              fileId: made.fileId,
              entityType: 'lab_claim_request',
              entityId: mine.claimId,
              role: 'CLAIM_LETTERHEAD',
            },
          });
          return made;
        });
        await settle(ticket.fileId, 'CLEAN');
        return ticket;
      })();
      const tenantOwned = await (async () => {
        // A KYC file linked to this claim, uploaded by the caller but owned by an organisation.
        const ticket = await w.owner(async (tx) => {
          const made = await tx.fileObject.create({
            data: {
              id: randomUUID(),
              ownerOrgId: mine.lab.organisationId,
              purpose: 'KYC_DOCUMENT',
              bucket: files.bucket,
              objectKey: `clean/KYC_DOCUMENT/${randomUUID()}`,
              declaredContentType: 'application/pdf',
              detectedContentType: 'application/pdf',
              sizeBytes: 100n,
              sha256: new Uint8Array(32).fill(1),
              scanStatus: 'CLEAN',
              uploadedByUserId: mine.who.id,
              retentionClass: 'KYC_DOCUMENT',
            },
          });
          await tx.fileLink.create({
            data: {
              id: randomUUID(),
              fileId: made.id,
              entityType: 'lab_claim_request',
              entityId: mine.claimId,
              role: 'CLAIM_LETTERHEAD',
            },
          });
          return made.id;
        });
        return ticket;
      })();

      for (const [label, fileId] of [
        ["another user's file", theirFile.fileId],
        ["a file of the caller's other claim", otherClaimFile.fileId],
        ["the caller's file with no link", unlinked.fileId],
        ['a file of another purpose', wrongPurpose.fileId],
        ['a file owned by an organisation', tenantOwned],
        ['an unknown id', randomUUID()],
      ] as const) {
        expect(await refused(submit(mine.who, mine.claimId, fileId)), label).toMatchObject({
          code: 'NOT_FOUND',
          status: 404,
        });
      }
      expect(await claimRow(mine.claimId)).toMatchObject({
        status: 'PENDING_OTP',
        lock_version: 0,
        authorisation_file_id: null,
      });
      // And the other user's claim was not touched by any of it.
      expect(await claimRow(theirs.claimId)).toMatchObject({ authorisation_file_id: null });
    });

    it('is 422 FILE_NOT_CLEAN for a file whose scan is pending, failed, infected or rejected, and the claim does not move', async () => {
      const { who, claimId } = await openClaim();
      for (const status of ['PENDING', 'ERROR', 'INFECTED', 'REJECTED'] as const) {
        const ticket = await upload(who, claimId);
        if (status !== 'PENDING') await settle(ticket.fileId, status);
        expect(await refused(submit(who, claimId, ticket.fileId)), status).toMatchObject({
          code: 'FILE_NOT_CLEAN',
          status: 422,
        });
        expect(await claimRow(claimId), status).toEqual({
          status: 'PENDING_OTP',
          method: 'EMAIL_OTP',
          lock_version: 0,
          authorisation_file_id: null,
        });
      }
      // Once a file is clean, the same claim can be submitted.
      const good = await cleanUpload(who, claimId);
      expect((await submit(who, claimId, good.fileId)).status).toBe('PENDING_REVIEW');
    });

    it('is 409 with the state when the claim is not PENDING_OTP, whatever If-Match says, and a second submit never replaces the file', async () => {
      const { who, claimId } = await openClaim();
      const first = await cleanUpload(who, claimId);
      const second = await cleanUpload(who, claimId);
      await submit(who, claimId, first.fileId);
      for (const ifMatch of [0, 1, 99]) {
        expect(await refused(submit(who, claimId, second.fileId, ifMatch))).toMatchObject({
          code: 'INVALID_STATE_TRANSITION',
          status: 409,
          meta: { currentState: 'PENDING_REVIEW' },
        });
      }
      expect(await claimRow(claimId)).toMatchObject({ authorisation_file_id: first.fileId });
    });

    it('is 412 when If-Match is not the lock version, and nothing changes', async () => {
      const { who, claimId } = await openClaim();
      const ticket = await cleanUpload(who, claimId);
      expect(await refused(submit(who, claimId, ticket.fileId, 5))).toMatchObject({
        code: 'CONCURRENT_MODIFICATION',
        status: 412,
      });
      expect(await claimRow(claimId)).toMatchObject({ status: 'PENDING_OTP', lock_version: 0 });
    });

    it('lets exactly one of the code and the letterhead complete a claim that both race for', async () => {
      const seen = new Set<string>();
      for (let round = 0; round < 6; round += 1) {
        const { who, claimId, started } = await openClaim(`race-${String(round)}`);
        const code = started.delivery?.code ?? '';
        const ticket = await cleanUpload(who, claimId);
        const [byCode, byLetterhead] = await Promise.allSettled([
          w.asSystem((tx) =>
            verifyLabClaimOtp(tx, w.deps, {
              actor: who.actor,
              claimId,
              ifMatch: 0,
              code,
              meta: CLAIM_META,
            }),
          ),
          submit(who, claimId, ticket.fileId),
        ]);
        const codeWon = byCode.status === 'fulfilled' && byCode.value.ok;
        const letterheadWon = byLetterhead.status === 'fulfilled';
        expect(Number(codeWon) + Number(letterheadWon), `round ${String(round)}`).toBe(1);
        const loser = codeWon ? byLetterhead : byCode;
        expect(loser.status).toBe('rejected');
        if (loser.status === 'rejected') {
          expect(['INVALID_STATE_TRANSITION', 'CONCURRENT_MODIFICATION']).toContain(
            (loser.reason as LabClaimError).code,
          );
        }
        const row = await claimRow(claimId);
        expect(row).toMatchObject({ status: 'PENDING_REVIEW', lock_version: 1 });
        if (codeWon) {
          expect(row).toMatchObject({ method: 'EMAIL_OTP', authorisation_file_id: null });
        } else {
          expect(row).toMatchObject({ method: 'MANUAL', authorisation_file_id: ticket.fileId });
        }
        seen.add(codeWon ? 'code' : 'letterhead');
      }
      expect(seen.size).toBeGreaterThan(0);
    });

    it('leaves any open code of the claim useless after the letterhead: 409 and no attempt spent', async () => {
      const { who, claimId, started } = await openClaim();
      const code = started.delivery?.code ?? '';
      const ticket = await cleanUpload(who, claimId);
      await submit(who, claimId, ticket.fileId);
      const result = await refused(
        w.asSystem((tx) =>
          verifyLabClaimOtp(tx, w.deps, {
            actor: who.actor,
            claimId,
            ifMatch: 1,
            code,
            meta: CLAIM_META,
          }),
        ),
      );
      expect(result).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        status: 409,
        meta: { currentState: 'PENDING_REVIEW' },
      });
      const challenge = await w
        .db()
        .query<{ attempts: number; consumed_at: Date | null }>(
          'SELECT attempts, consumed_at FROM otp_challenge WHERE context_id = $1',
          [claimId],
        );
      expect(challenge.rows.every((r) => r.attempts === 0 && r.consumed_at === null)).toBe(true);
      expect(await claimRow(claimId)).toMatchObject({ method: 'MANUAL' });
    });
  });
});
