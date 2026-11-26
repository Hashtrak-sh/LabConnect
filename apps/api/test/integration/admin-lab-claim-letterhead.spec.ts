import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FixedClock, type FilesConfig, InMemoryObjectStorage } from '@labconnect/core';
import { uuidv7, withDbContext } from '@labconnect/database';
import { addMember } from '@labconnect/database/test-utils';
import { ROLES } from '@labconnect/shared';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILES_CONFIG, OBJECT_STORAGE } from '../../src/modules/files/files.module.js';
import { useClaimLabs, type ClaimableLab } from '../support/claim-labs.js';
import { START, useIdentityApp } from '../support/identity-app.js';
import { claimRoleUsers, type ClaimRoleUsers } from '../support/claim-roles.js';
import type { TenantUser } from '../support/isolation/world.js';

// createAdminLabClaimLetterheadDownloadUrl over HTTP, held to the contract, on a real database
// (I2-ADM-04, OQ-225): POST /v1/admin/claims/{id}/letterhead/download-url.

describe('Ops read of a claim letterhead: POST /v1/admin/claims/{id}/letterhead/download-url', () => {
  const storage = new InMemoryObjectStorage(new FixedClock(START));
  const t = useIdentityApp({
    configure: (builder) =>
      builder
        .overrideProvider(OBJECT_STORAGE)
        .useValue(storage)
        .overrideProvider(FILES_CONFIG)
        .useValue((): FilesConfig => ({
          bucket: 'labconnect-test',
          quarantinePrefix: 'quarantine',
          cleanPrefix: 'clean',
        })),
  });
  const makeLab = useClaimLabs(t, new Date(START));

  let world: ClaimRoleUsers;
  beforeAll(async () => {
    world = await claimRoleUsers(t, makeLab);
  });

  const tokens = new Map<string, string>();
  const tokenOfUser = async (user: TenantUser): Promise<string> => {
    const known = tokens.get(user.id);
    if (known !== undefined) return known;
    const token =
      ROLES[user.role].mfa === 'REQUIRED'
        ? (await t.signInWithMfa(user.email)).accessToken
        : (await t.signIn(user.email)).accessToken;
    tokens.set(user.id, token);
    return token;
  };
  const opsToken = () => tokenOfUser(world.byRole('PLATFORM_OPS'));

  const idOf = async (email: string): Promise<string> =>
    (
      await t
        .db()
        .query<{ id: string }>('SELECT id FROM app_user WHERE email = $1', [email.toLowerCase()])
    ).rows[0]?.id ?? '';

  interface Made {
    lab: ClaimableLab;
    claimId: string;
    claimantEmail: string;
    claimantId: string;
    fileId: string | null;
  }

  const settle = (fileId: string, status: 'CLEAN' | 'PENDING' | 'INFECTED' | 'REJECTED') =>
    withDbContext(t.worker(), { kind: 'system' }, (tx) =>
      tx.fileObject.update({
        where: { id: fileId },
        data:
          status === 'CLEAN'
            ? {
                scanStatus: 'CLEAN',
                sha256: new Uint8Array(32).fill(5),
                detectedContentType: 'application/pdf',
              }
            : { scanStatus: status },
      }),
    );

  /** A claim in PENDING_REVIEW through the lab-side routes: by letterhead (`manual`) or by code. */
  const inReview = async (options: { manual?: boolean } = {}): Promise<Made> => {
    const manual = options.manual ?? true;
    const lab = await makeLab(
      manual
        ? { email: null }
        : { email: `nabl.${randomUUID().slice(0, 8)}@letterhead.example.test` },
    );
    const claimantEmail = t.newEmail('claimant');
    const claimant = await t.signIn(claimantEmail);
    const started = await t.api.post('/v1/lab/claims', {
      token: claimant.accessToken,
      body: { certificateNo: lab.certificateNo },
    });
    expect(started.status).toBe(201);
    const claimId = (started.body as { id: string }).id;
    let fileId: string | null = null;
    if (manual) {
      const upload = await t.api.post(`/v1/lab/claims/${claimId}/manual/upload-url`, {
        token: claimant.accessToken,
        body: {
          fileName: 'letterhead-of-asha.pdf',
          contentType: 'application/pdf',
          sizeBytes: 90_000,
        },
      });
      expect(upload.status).toBe(201);
      fileId = (upload.body as { fileId: string }).fileId;
      await settle(fileId, 'CLEAN');
      const submitted = await t.api.post(`/v1/lab/claims/${claimId}/manual`, {
        token: claimant.accessToken,
        body: { fileId },
        headers: { 'If-Match': '"0"' },
      });
      expect(submitted.status).toBe(200);
    } else {
      const code = t.mailer.lastClaimCodeFor(lab.email?.toLowerCase() ?? '') ?? '';
      const verified = await t.api.post(`/v1/lab/claims/${claimId}/verify-otp`, {
        token: claimant.accessToken,
        body: { code },
        headers: { 'If-Match': '"0"' },
      });
      expect(verified.status).toBe(200);
    }
    return { lab, claimId, claimantEmail, claimantId: await idOf(claimantEmail), fileId };
  };

  const letterhead = (
    token: string | undefined,
    claimId: string,
    headers?: Record<string, string>,
  ) =>
    t.api.post(`/v1/admin/claims/${claimId}/letterhead/download-url`, {
      ...(token !== undefined && { token }),
      ...(headers !== undefined && { headers }),
    });
  const decide = (token: string, claimId: string, what: 'approve' | 'reject') =>
    t.api.post(`/v1/admin/claims/${claimId}/${what}`, {
      token,
      body: what === 'approve' ? {} : { decisionNotes: 'Not signed by the head.' },
      headers: { 'If-Match': '"1"' },
    });

  const claimRow = async (claimId: string) =>
    (
      await t
        .db()
        .query<{ row: string }>(
          'SELECT to_jsonb(c)::text AS row FROM lab_claim_request c WHERE id = $1',
          [claimId],
        )
    ).rows[0]?.row;
  const traces = async () => ({
    audit: (await t.db().query<{ n: string }>('SELECT count(*)::text AS n FROM audit_log')).rows[0]
      ?.n,
    outbox: (await t.db().query<{ n: string }>('SELECT count(*)::text AS n FROM outbox_event'))
      .rows[0]?.n,
  });
  const letterheadAudit = async (claimId: string) =>
    (
      await t.db().query<{
        action: string;
        entity_id: string;
        after: Record<string, unknown>;
        actor_user_id: string;
        actor_role: string;
      }>(
        `SELECT action, entity_id, after, actor_user_id, actor_role FROM audit_log
          WHERE action = 'lab_claim.letterhead_download_url_created' AND entity_id = $1`,
        [claimId],
      )
    ).rows;

  let lines: string[] = [];
  let restore: (() => void)[] = [];
  beforeEach(() => {
    lines = [];
    const keep = (...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(keep),
      vi.spyOn(console, 'info').mockImplementation(keep),
      vi.spyOn(console, 'warn').mockImplementation(keep),
      vi.spyOn(console, 'error').mockImplementation(keep),
      vi.spyOn(console, 'debug').mockImplementation(keep),
      vi.spyOn(Logger.prototype, 'error').mockImplementation(keep),
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(keep),
      vi.spyOn(Logger.prototype, 'log').mockImplementation(keep),
      vi.spyOn(Logger.prototype, 'debug').mockImplementation(keep),
    ];
    restore = spies.map((spy) => () => {
      spy.mockRestore();
    });
  });
  afterEach(() => {
    for (const undo of restore) undo();
  });

  /** Asserts a refusal and that it wrote no audit row, no event, and did not touch the claim. */
  const expectNoTrace = async (claimId: string, work: () => Promise<unknown>) => {
    const before = { ...(await traces()), claim: await claimRow(claimId) };
    await work();
    expect({ ...(await traces()), claim: await claimRow(claimId) }).toEqual(before);
  };

  // ---------------------------------------------------------------- who may call

  describe('who may call', () => {
    it('answers 401 UNAUTHENTICATED without a token and with a bad one', async () => {
      const claim = await inReview();
      for (const token of [undefined, 'not-a-token']) {
        const response = await letterhead(token, claim.claimId);
        expect(response.status).toBe(401);
        expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
      }
    });

    it('answers 403 FORBIDDEN to every role but PLATFORM_OPS, before the id is looked at, and writes nothing', async () => {
      const claim = await inReview();
      const users = [
        world.byRole('PLATFORM_FINANCE'),
        world.byRole('PLATFORM_DATA_STEWARD'),
        world.byRole('PLATFORM_ADMIN'),
        world.byRole('LAB_CHECKER'),
        world.byRole('LAB_MAKER'),
        world.byRole('CUSTOMER_ADMIN'),
        world.byRole('CUSTOMER_REQUESTER'),
        world.byRole('CUSTOMER_FINANCE'),
      ];
      // Sign-ins write audit rows of their own: do them before the snapshot.
      const signedIn: { user: TenantUser; token: string }[] = [];
      for (const user of users) signedIn.push({ user, token: await tokenOfUser(user) });
      await expectNoTrace(claim.claimId, async () => {
        for (const { user, token } of signedIn) {
          for (const id of [claim.claimId, randomUUID(), 'not-a-uuid']) {
            const response = await t.api.post(`/v1/admin/claims/${id}/letterhead/download-url`, {
              token,
              invalidRequest: 'a malformed id: the role is refused first',
            });
            expect(response.status, `${user.role} ${id}`).toBe(403);
            expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
          }
        }
      });
      expect(storage.presignedGets).toHaveLength(0);
    });

    it('answers 403 to a user with no membership, and to the claimant who uploaded the letterhead', async () => {
      const claim = await inReview();
      const stranger = await t.signIn(t.newEmail('stranger'));
      const claimant = await t.signIn(claim.claimantEmail);
      await expectNoTrace(claim.claimId, async () => {
        for (const token of [stranger.accessToken, claimant.accessToken]) {
          const response = await letterhead(token, claim.claimId);
          expect(response.status).toBe(403);
          expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
        }
      });
    });

    it('answers 403 to a member of the lab once it is claimed: the approved claimant is a Checker, not Ops', async () => {
      const claim = await inReview();
      expect((await decide(await opsToken(), claim.claimId, 'approve')).status).toBe(200);
      const checker = await t.signInWithMfa(claim.claimantEmail);
      await expectNoTrace(claim.claimId, async () => {
        const response = await letterhead(checker.accessToken, claim.claimId);
        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
      });
      // Ops can still look at the decided claim.
      expect((await letterhead(await opsToken(), claim.claimId)).status).toBe(200);
    });

    it('has no Ops user under another membership to refuse: the database keeps platform staff in the platform organisation', async () => {
      // The case "an Ops user acting under a customer or lab membership" cannot be built: a
      // platform user may join only the platform organisation (RR-5, LC004). The core test covers
      // an actor built that way anyway (it is refused: not a platform actor).
      const ops = world.byRole('PLATFORM_OPS');
      const customerAdmin = world.byRole('CUSTOMER_ADMIN');
      await expect(
        t.owner((tx) => addMember(tx, ops.id, customerAdmin.organisationId, 'CUSTOMER_REQUESTER')),
      ).rejects.toThrow(/platform staff may join only the platform organisation/);
    });
  });

  // ---------------------------------------------------------------- 200

  describe('the URL', () => {
    it('answers 200 with a 15-minute attachment URL of the claim letterhead for a PENDING_REVIEW claim, audited, with nothing else written', async () => {
      const claim = await inReview();
      const claimBefore = await claimRow(claim.claimId);
      const before = await traces();
      const response = await letterhead(await opsToken(), claim.claimId);

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const body = response.body as { downloadUrl: string; expiresAt: string };
      expect(Object.keys(body).sort()).toEqual(['downloadUrl', 'expiresAt']);
      expect(new Date(body.expiresAt).getTime()).toBe(new Date(START).getTime() + 15 * 60 * 1000);

      // The file service made it: for this claim's file, as an attachment, for 15 minutes.
      const stored = await t
        .db()
        .query<{ object_key: string }>('SELECT object_key FROM file_object WHERE id = $1', [
          claim.fileId,
        ]);
      const presigned = storage.presignedGets.at(-1);
      expect(presigned).toMatchObject({
        bucket: 'labconnect-test',
        key: stored.rows[0]?.object_key,
        expiresInSeconds: 900,
      });
      expect(body.downloadUrl).toContain('response-content-disposition=attachment');

      // The claim did not move; no event; the claim's audit entry and the file service's.
      expect(await claimRow(claim.claimId)).toBe(claimBefore);
      const after = await traces();
      expect(after.outbox).toBe(before.outbox);
      expect(Number(after.audit) - Number(before.audit)).toBe(2);
      const ops = world.byRole('PLATFORM_OPS');
      const rows = await letterheadAudit(claim.claimId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor_user_id: ops.id,
        actor_role: 'PLATFORM_OPS',
        after: { claimId: claim.claimId, fileId: claim.fileId, claimStatus: 'PENDING_REVIEW' },
      });
      expect(Object.keys(rows[0]?.after ?? {}).sort()).toEqual([
        'claimId',
        'claimStatus',
        'fileId',
      ]);
    });

    it('keeps the URL out of every log line, audit row and event, and the file name and key too', async () => {
      const claim = await inReview();
      const response = await letterhead(await opsToken(), claim.claimId);
      expect(response.status).toBe(200);
      const url = (response.body as { downloadUrl: string }).downloadUrl;
      const key = (
        await t
          .db()
          .query<{ object_key: string }>('SELECT object_key FROM file_object WHERE id = $1', [
            claim.fileId,
          ])
      ).rows[0]?.object_key;
      const logged = lines.join('\n');
      expect(logged).not.toContain(url);
      expect(logged).not.toContain('X-Fake-Signature');
      expect(logged).not.toContain(key ?? 'no-key');
      const stored = JSON.stringify([
        (await t.db().query('SELECT to_jsonb(a)::text FROM audit_log a')).rows,
        (await t.db().query('SELECT to_jsonb(o)::text FROM outbox_event o')).rows,
      ]);
      expect(stored).not.toContain(url);
      expect(stored).not.toContain('X-Fake-Signature');
      expect(stored).not.toContain(key ?? 'no-key');
      expect(stored).not.toContain('letterhead-of-asha');
    });

    it('answers 200 for a decided claim: APPROVED and REJECTED', async () => {
      const approved = await inReview();
      const rejected = await inReview();
      expect((await decide(await opsToken(), approved.claimId, 'approve')).status).toBe(200);
      expect((await decide(await opsToken(), rejected.claimId, 'reject')).status).toBe(200);
      for (const [claim, status] of [
        [approved, 'APPROVED'],
        [rejected, 'REJECTED'],
      ] as const) {
        const response = await letterhead(await opsToken(), claim.claimId);
        expect(response.status).toBe(200);
        expect((await letterheadAudit(claim.claimId))[0]?.after).toMatchObject({
          fileId: claim.fileId,
          claimStatus: status,
        });
      }
    });

    it('writes one audit entry for every request that gives a URL', async () => {
      const claim = await inReview();
      for (let i = 0; i < 3; i += 1) {
        expect((await letterhead(await opsToken(), claim.claimId)).status).toBe(200);
      }
      expect(await letterheadAudit(claim.claimId)).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------- 404, 422

  describe('the refusals', () => {
    it('answers 404 NOT_FOUND for an unknown claim, and 422 VALIDATION_FAILED for an id that is not a UUID', async () => {
      const claim = await inReview();
      await expectNoTrace(claim.claimId, async () => {
        const unknown = await letterhead(await opsToken(), randomUUID());
        expect(unknown.status).toBe(404);
        expect(unknown.body).toMatchObject({ code: 'NOT_FOUND' });
        // A file id is not a claim id.
        const fileAsClaim = await letterhead(await opsToken(), claim.fileId ?? '');
        expect(fileAsClaim.status).toBe(404);
        const malformed = await t.api.post('/v1/admin/claims/not-a-uuid/letterhead/download-url', {
          token: await opsToken(),
          invalidRequest: 'a malformed id must give 422',
        });
        expect(malformed.status).toBe(422);
        expect(malformed.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      });
    });

    it('answers 404 NOT_FOUND for a claim made by code, which has no letterhead', async () => {
      const claim = await inReview({ manual: false });
      await expectNoTrace(claim.claimId, async () => {
        const response = await letterhead(await opsToken(), claim.claimId);
        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
      });
    });

    it('answers 404 for a claim that names a file linked to another claim, and never returns that file', async () => {
      const first = await inReview();
      const second = await inReview();
      await t
        .db()
        .query('UPDATE lab_claim_request SET authorisation_file_id = $2 WHERE id = $1', [
          second.claimId,
          first.fileId,
        ]);
      await expectNoTrace(second.claimId, async () => {
        const response = await letterhead(await opsToken(), second.claimId);
        expect(response.status).toBe(404);
        expect(response.text).not.toContain(first.fileId ?? 'none');
      });
      expect(storage.presignedGets.filter((g) => g.key.includes(first.fileId ?? 'none'))).toEqual(
        [],
      );
      // The first claim still opens its own file.
      expect((await letterhead(await opsToken(), first.claimId)).status).toBe(200);
    });

    it('answers 404 for a file of another purpose that carries the letterhead link', async () => {
      const claim = await inReview();
      const other = uuidv7(Date.now());
      await t.db().query(
        `INSERT INTO file_object (id, purpose, bucket, object_key, declared_content_type, size_bytes,
                                  scan_status, sha256, detected_content_type, retention_class, created_by_user_id, uploaded_by_user_id)
         SELECT $1::uuid, 'BOOKING_ATTACHMENT', bucket, $3::text, declared_content_type,
                size_bytes, 'CLEAN', sha256, detected_content_type, 'BOOKING_ATTACHMENT', created_by_user_id, uploaded_by_user_id
           FROM file_object WHERE id = $2`,
        [other, claim.fileId, `clean/BOOKING_ATTACHMENT/${other}`],
      );
      await t.db().query(
        `INSERT INTO file_link (id, file_id, entity_type, entity_id, role, created_by_user_id)
         VALUES ($1, $2, 'lab_claim_request', $3, 'CLAIM_LETTERHEAD', $4)`,
        [uuidv7(Date.now()), other, claim.claimId, claim.claimantId],
      );
      await t
        .db()
        .query('UPDATE lab_claim_request SET authorisation_file_id = $2 WHERE id = $1', [
          claim.claimId,
          other,
        ]);
      await expectNoTrace(claim.claimId, async () => {
        const response = await letterhead(await opsToken(), claim.claimId);
        expect(response.status).toBe(404);
      });
    });

    it.each(['PENDING', 'INFECTED', 'REJECTED'] as const)(
      'answers 422 FILE_NOT_CLEAN for a letterhead whose scan is %s, and gives no URL',
      async (status) => {
        const claim = await inReview();
        // Bind a second, not-clean file as the claim's letterhead (the claim flow never lets one
        // be submitted, so the rows are written directly).
        const lab = await makeLab({ email: null });
        const claimant = await t.signIn(t.newEmail('unclean'));
        const started = await t.api.post('/v1/lab/claims', {
          token: claimant.accessToken,
          body: { certificateNo: lab.certificateNo },
        });
        const claimId = (started.body as { id: string }).id;
        const upload = await t.api.post(`/v1/lab/claims/${claimId}/manual/upload-url`, {
          token: claimant.accessToken,
          body: { contentType: 'application/pdf', sizeBytes: 1000 },
        });
        const fileId = (upload.body as { fileId: string }).fileId;
        if (status !== 'PENDING') await settle(fileId, status);
        await t
          .db()
          .query(
            `UPDATE lab_claim_request SET status = 'PENDING_REVIEW', method = 'MANUAL', authorisation_file_id = $2, lock_version = 1 WHERE id = $1`,
            [claimId, fileId],
          );
        const gets = storage.presignedGets.length;
        await expectNoTrace(claimId, async () => {
          const response = await letterhead(await opsToken(), claimId);
          expect(response.status).toBe(422);
          expect(response.body).toMatchObject({ code: 'FILE_NOT_CLEAN' });
          expect(response.text).not.toContain('downloadUrl');
        });
        expect(storage.presignedGets).toHaveLength(gets);
        expect(claim.claimId).toBeTruthy();
      },
    );
  });
});
