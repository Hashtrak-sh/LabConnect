import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FixedClock, InMemoryObjectStorage, type FilesConfig } from '@labconnect/core';
import { type ScanStatus, withDbContext } from '@labconnect/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILES_CONFIG, OBJECT_STORAGE } from '../../src/modules/files/files.module.js';
import { useClaimLabs } from '../support/claim-labs.js';
import { START, useIdentityApp } from '../support/identity-app.js';

// createLabClaimLetterheadUploadUrl and submitLabClaimLetterhead over HTTP, held to the contract, on a
// real database (I1-LAB-03, I1-LAB-04). The object store is the in-memory one.

const MB = 1024 * 1024;
const FILES: FilesConfig = {
  bucket: 'labconnect-test',
  quarantinePrefix: 'quarantine',
  cleanPrefix: 'clean',
};

describe('lab claims: the letterhead operations', () => {
  const t = useIdentityApp({
    configure: (builder) =>
      builder
        .overrideProvider(OBJECT_STORAGE)
        .useValue(new InMemoryObjectStorage(new FixedClock(START)))
        .overrideProvider(FILES_CONFIG)
        .useValue(() => FILES),
  });
  const makeLab = useClaimLabs(t, new Date(START));

  const newUser = async (label = 'claimant') => {
    const email = t.newEmail(label);
    const session = await t.signIn(email);
    return { email, token: session.accessToken };
  };
  const opened = async (options: Parameters<typeof makeLab>[0] = {}) => {
    const claimable = await makeLab(options);
    const user = await newUser();
    const started = await t.api.post('/v1/lab/claims', {
      token: user.token,
      body: { certificateNo: claimable.certificateNo },
    });
    expect(started.status).toBe(201);
    const id = (started.body as { id: string }).id;
    const code = t.mailer.lastClaimCodeFor(claimable.email?.toLowerCase() ?? '') ?? '';
    return { claimable, user, id, code };
  };
  const PDF = {
    fileName: 'Letter - Asha Rao.pdf',
    contentType: 'application/pdf',
    sizeBytes: 182_044,
  };
  const uploadUrl = (token: string, id: string, body: object = PDF) =>
    t.api.post(`/v1/lab/claims/${id}/manual/upload-url`, { token, body });
  const submit = (token: string, id: string, fileId: string, ifMatch = '"0"') =>
    t.api.post(`/v1/lab/claims/${id}/manual`, {
      token,
      body: { fileId },
      headers: { 'If-Match': ifMatch },
    });
  const verify = (token: string, id: string, code: string, ifMatch = '"0"') =>
    t.api.post(`/v1/lab/claims/${id}/verify-otp`, {
      token,
      body: { code },
      headers: { 'If-Match': ifMatch },
    });
  const fileIdOf = (response: { body: unknown }) => (response.body as { fileId: string }).fileId;
  const settle = (fileId: string, status: ScanStatus) =>
    withDbContext(t.worker(), { kind: 'system' }, (tx) =>
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
  const cleanFile = async (token: string, id: string) => {
    const response = await uploadUrl(token, id);
    expect(response.status).toBe(201);
    const fileId = fileIdOf(response);
    await settle(fileId, 'CLEAN');
    return fileId;
  };
  const claimRow = async (id: string) =>
    (
      await t.db().query<{
        status: string;
        method: string;
        lock_version: number;
        authorisation_file_id: string | null;
      }>('SELECT status, method, lock_version, authorisation_file_id FROM lab_claim_request WHERE id = $1', [id])
    ).rows[0];
  const strip = (body: unknown) => ({ ...(body as Record<string, unknown>), requestId: '' });

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
      vi.spyOn(Logger.prototype, 'error').mockImplementation(keep),
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(keep),
      vi.spyOn(Logger.prototype, 'log').mockImplementation(keep),
    ];
    restore = spies.map((spy) => () => {
      spy.mockRestore();
    });
  });
  afterEach(() => {
    for (const undo of restore) undo();
  });

  describe('createLabClaimLetterheadUploadUrl', () => {
    it('answers 201 with exactly the FileUploadUrl: an upload to the quarantine area, 15 minutes, nothing more', async () => {
      const { user, id } = await opened();
      const response = await uploadUrl(user.token, id);
      expect(response.status).toBe(201);
      expect(Object.keys(response.body as object).sort()).toEqual([
        'expiresAt',
        'fileId',
        'headers',
        'method',
        'uploadUrl',
      ]);
      const body = response.body as {
        fileId: string;
        uploadUrl: string;
        method: string;
        headers: Record<string, string>;
        expiresAt: string;
      };
      expect(body.method).toBe('PUT');
      expect(body.headers).toMatchObject({
        'Content-Type': 'application/pdf',
        'Content-Length': '182044',
      });
      expect(Date.parse(body.expiresAt) - Date.parse(START)).toBe(15 * 60_000);
      expect(body.uploadUrl).toContain(`quarantine/KYC_DOCUMENT/${body.fileId}`);
      expect(response.headers['cache-control']).toBe('no-store');
      // The claim did not move, and the file is nobody's organisation's.
      expect(await claimRow(id)).toMatchObject({ status: 'PENDING_OTP', lock_version: 0 });
      const row = await t
        .db()
        .query<{ owner_org_id: string | null; scan_status: string; purpose: string }>(
          'SELECT owner_org_id, scan_status, purpose FROM file_object WHERE id = $1',
          [body.fileId],
        );
      expect(row.rows[0]).toEqual({
        owner_org_id: null,
        scan_status: 'PENDING',
        purpose: 'KYC_DOCUMENT',
      });
      // The URL is a secret for its lifetime, the name is personal data: neither is logged.
      const output = lines.join('\n');
      expect(output).not.toContain(body.uploadUrl);
      expect(output).not.toContain('X-Amz-Signature');
      expect(output).not.toContain('Asha');
    });

    it('answers 201 also without a file name, and for a claim that has a code', async () => {
      const { user, id } = await opened();
      const response = await uploadUrl(user.token, id, {
        contentType: 'image/png',
        sizeBytes: 10 * MB,
      });
      expect(response.status).toBe(201);
    });

    it('answers 422 VALIDATION_FAILED for another type or a size over 10 MB, naming the field, and creates no file', async () => {
      const { user, id } = await opened();
      const before = await t.db().query<{ n: string }>('SELECT count(*) AS n FROM file_object');
      const cases: [string, object, string][] = [
        ['heic', { contentType: 'image/heic', sizeBytes: 1000 }, 'contentType'],
        [
          'docx',
          {
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            sizeBytes: 1000,
          },
          'contentType',
        ],
        ['csv', { contentType: 'text/csv', sizeBytes: 1000 }, 'contentType'],
        ['11 MB', { contentType: 'application/pdf', sizeBytes: 10 * MB + 1 }, 'sizeBytes'],
        ['25 MB', { contentType: 'application/pdf', sizeBytes: 25 * MB }, 'sizeBytes'],
      ];
      for (const [label, body, path] of cases) {
        const response = await t.api.post(`/v1/lab/claims/${id}/manual/upload-url`, {
          token: user.token,
          body,
          invalidRequest: label,
        });
        expect(response.status, label).toBe(422);
        expect(response.body, label).toMatchObject({
          code: 'VALIDATION_FAILED',
          errors: [{ path }],
        });
      }
      const after = await t.db().query<{ n: string }>('SELECT count(*) AS n FROM file_object');
      expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    });

    it('answers 422 for a malformed body: unknown fields, a missing or non-integer size', async () => {
      const { user, id } = await opened();
      const bodies: [string, unknown][] = [
        ['an owner', { ...PDF, ownerOrgId: randomUUID() }],
        ['a key', { ...PDF, objectKey: 'clean/x' }],
        ['no type', { sizeBytes: 5 }],
        ['no size', { contentType: 'application/pdf' }],
        ['a fractional size', { contentType: 'application/pdf', sizeBytes: 1.5 }],
        ['a string size', { contentType: 'application/pdf', sizeBytes: '5' }],
        ['an empty name', { ...PDF, fileName: '' }],
        ['an array', [PDF]],
      ];
      for (const [label, body] of bodies) {
        const response = await t.api.post(`/v1/lab/claims/${id}/manual/upload-url`, {
          token: user.token,
          body: body as object,
          invalidRequest: label,
        });
        expect(response.status, label).toBe(422);
      }
    });

    it("answers 404 for another user's claim, an unknown claim and platform staff, with the same words", async () => {
      const { id } = await opened();
      const stranger = await newUser('stranger');
      const foreign = await uploadUrl(stranger.token, id);
      const unknown = await uploadUrl(stranger.token, randomUUID());
      expect(foreign.status).toBe(404);
      expect(strip(foreign.body)).toEqual(strip(unknown.body));
      const { platform } = await t.fixtures();
      const ops = await t.signInWithMfa(platform.ops.email);
      expect((await uploadUrl(ops.accessToken, id)).status).toBe(404);
    });

    it('answers 409 INVALID_STATE_TRANSITION with the state once the claim is in review', async () => {
      const { user, id, code } = await opened();
      expect((await verify(user.token, id, code)).status).toBe(200);
      const response = await uploadUrl(user.token, id);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        meta: { currentState: 'PENDING_REVIEW' },
      });
    });

    it('answers 401 without a session', async () => {
      const { id } = await opened();
      const response = await t.api.post(`/v1/lab/claims/${id}/manual/upload-url`, { body: PDF });
      expect(response.status).toBe(401);
    });

    it('answers 422 for an id that is not a UUID', async () => {
      const { user } = await opened();
      const response = await t.api.post('/v1/lab/claims/not-a-uuid/manual/upload-url', {
        token: user.token,
        body: PDF,
        invalidRequest: 'a bad id',
      });
      expect(response.status).toBe(422);
    });
  });

  describe('submitLabClaimLetterhead', () => {
    it('answers 200 with the claim: PENDING_REVIEW, MANUAL, no address, and the next ETag', async () => {
      const { user, id, claimable } = await opened();
      const fileId = await cleanFile(user.token, id);
      const response = await submit(user.token, id, fileId);
      expect(response.status).toBe(200);
      expect(response.headers.etag).toBe('"1"');
      expect(response.body).toEqual({
        id,
        status: 'PENDING_REVIEW',
        method: 'MANUAL',
        labSite: { id: claimable.siteId, siteCode: claimable.siteCode, name: claimable.siteName },
        otpSentTo: null,
        // The clock is shared by the tests of the file, so the instant is only checked for shape.
        createdAt: expect.stringMatching(/^2026-11-25T10:\d\d:\d\d\.000Z$/) as string,
        reviewedAt: null,
        decisionNotes: null,
      });
      expect(await claimRow(id)).toEqual({
        status: 'PENDING_REVIEW',
        method: 'MANUAL',
        lock_version: 1,
        authorisation_file_id: fileId,
      });
      expect(response.text).not.toContain(fileId);
    });

    it('also finishes a claim of a site with no address', async () => {
      const { user, id } = await opened({ email: null });
      const fileId = await cleanFile(user.token, id);
      const response = await submit(user.token, id, fileId);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ status: 'PENDING_REVIEW', method: 'MANUAL' });
    });

    it('answers 422 FILE_NOT_CLEAN while the scan is pending and after a failed, infected or rejected one; the claim does not move', async () => {
      const { user, id } = await opened();
      for (const status of ['PENDING', 'ERROR', 'INFECTED', 'REJECTED'] as const) {
        const fileId = fileIdOf(await uploadUrl(user.token, id));
        if (status !== 'PENDING') await settle(fileId, status);
        const response = await submit(user.token, id, fileId);
        expect(response.status, status).toBe(422);
        expect(response.body, status).toMatchObject({ code: 'FILE_NOT_CLEAN' });
        expect(await claimRow(id), status).toMatchObject({
          status: 'PENDING_OTP',
          lock_version: 0,
          authorisation_file_id: null,
        });
      }
    });

    it('answers 404 for a file of another claim, another user or an unknown id, in the same words', async () => {
      const mine = await opened();
      const theirs = await opened();
      const theirFile = await cleanFile(theirs.user.token, theirs.id);
      const otherClaim = await (async () => {
        const lab = await makeLab();
        const started = await t.api.post('/v1/lab/claims', {
          token: mine.user.token,
          body: { certificateNo: lab.certificateNo },
        });
        return (started.body as { id: string }).id;
      })();
      const otherClaimFile = await cleanFile(mine.user.token, otherClaim);
      const answers = [];
      for (const fileId of [theirFile, otherClaimFile, randomUUID()]) {
        const response = await submit(mine.user.token, mine.id, fileId);
        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
        answers.push(strip(response.body));
      }
      expect(answers[0]).toEqual(answers[2]);
      expect(answers[1]).toEqual(answers[2]);
      expect(await claimRow(mine.id)).toMatchObject({
        status: 'PENDING_OTP',
        authorisation_file_id: null,
      });
      expect(await claimRow(theirs.id)).toMatchObject({ authorisation_file_id: null });
    });

    it("answers 404 for another user's claim and an unknown claim", async () => {
      const { user, id } = await opened();
      const fileId = await cleanFile(user.token, id);
      const stranger = await newUser('stranger');
      const foreign = await submit(stranger.token, id, fileId);
      const unknown = await submit(stranger.token, randomUUID(), fileId);
      expect(foreign.status).toBe(404);
      expect(strip(foreign.body)).toEqual(strip(unknown.body));
      expect(await claimRow(id)).toMatchObject({ status: 'PENDING_OTP' });
    });

    it('answers 412 CONCURRENT_MODIFICATION for a stale If-Match and changes nothing', async () => {
      const { user, id } = await opened();
      const fileId = await cleanFile(user.token, id);
      const response = await submit(user.token, id, fileId, '"5"');
      expect(response.status).toBe(412);
      expect(response.body).toMatchObject({ code: 'CONCURRENT_MODIFICATION' });
      expect(await claimRow(id)).toMatchObject({ status: 'PENDING_OTP', lock_version: 0 });
    });

    it('answers 400 when If-Match is missing or is not one strong ETag', async () => {
      const { user, id } = await opened();
      const fileId = await cleanFile(user.token, id);
      for (const ifMatch of [undefined, '', '0', '"x"', 'W/"0"', '*', '"0", "1"']) {
        const response = await t.api.post(`/v1/lab/claims/${id}/manual`, {
          token: user.token,
          body: { fileId },
          ...(ifMatch !== undefined && { headers: { 'If-Match': ifMatch } }),
          invalidRequest: 'a missing or malformed If-Match must give 400',
        });
        expect(response.status, String(ifMatch)).toBe(400);
      }
      expect(await claimRow(id)).toMatchObject({ status: 'PENDING_OTP' });
    });

    it('answers 409 with the state for a claim already submitted, whatever If-Match says', async () => {
      const { user, id } = await opened();
      const fileId = await cleanFile(user.token, id);
      expect((await submit(user.token, id, fileId)).status).toBe(200);
      for (const ifMatch of ['"0"', '"1"', '"9"']) {
        const response = await submit(user.token, id, fileId, ifMatch);
        expect(response.status, ifMatch).toBe(409);
        expect(response.body).toMatchObject({
          code: 'INVALID_STATE_TRANSITION',
          meta: { currentState: 'PENDING_REVIEW' },
        });
      }
    });

    it('answers 422 for a body that is not exactly { fileId: uuid }', async () => {
      const { user, id } = await opened();
      const bodies: [string, unknown][] = [
        ['no file', {}],
        ['not a uuid', { fileId: 'abc' }],
        ['a number', { fileId: 5 }],
        ['an extra field', { fileId: randomUUID(), method: 'MANUAL' }],
        ['an extra status', { fileId: randomUUID(), status: 'APPROVED' }],
      ];
      for (const [label, body] of bodies) {
        const response = await t.api.post(`/v1/lab/claims/${id}/manual`, {
          token: user.token,
          body: body as object,
          headers: { 'If-Match': '"0"' },
          invalidRequest: label,
        });
        expect(response.status, label).toBe(422);
      }
    });

    it('lets exactly one of the code and the letterhead complete a claim; after the letterhead the code is 409', async () => {
      const { user, id, code } = await opened();
      const fileId = await cleanFile(user.token, id);
      expect((await submit(user.token, id, fileId)).status).toBe(200);
      const late = await verify(user.token, id, code, '"1"');
      expect(late.status).toBe(409);
      expect(late.body).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        meta: { currentState: 'PENDING_REVIEW' },
      });
      // And the other way round: after the code, the letterhead is 409.
      const second = await opened();
      const secondFile = await cleanFile(second.user.token, second.id);
      expect((await verify(second.user.token, second.id, second.code)).status).toBe(200);
      const refused = await submit(second.user.token, second.id, secondFile, '"1"');
      expect(refused.status).toBe(409);
      expect(await claimRow(second.id)).toMatchObject({
        method: 'EMAIL_OTP',
        authorisation_file_id: null,
      });
    });
  });

  describe('what the letterhead never touches', () => {
    it('keeps the file name, the object key and the URL out of the logs, audit log and outbox', async () => {
      const { user, id } = await opened();
      const upload = await uploadUrl(user.token, id);
      const fileId = fileIdOf(upload);
      await settle(fileId, 'CLEAN');
      expect((await submit(user.token, id, fileId)).status).toBe(200);
      const output = lines.join('\n');
      expect(output).not.toContain('Asha');
      expect(output).not.toContain((upload.body as { uploadUrl: string }).uploadUrl);
      for (const table of ['audit_log', 'outbox_event']) {
        const rows = await t
          .db()
          .query<{ row: string }>(`SELECT row_to_json(t)::text AS row FROM ${table} t`);
        const everything = rows.rows.map((r) => r.row).join('\n');
        expect(everything, table).not.toContain('Asha');
        expect(everything, table).not.toContain('Letter - ');
        expect(everything, table).not.toContain('quarantine/KYC_DOCUMENT');
      }
    });
  });
});
