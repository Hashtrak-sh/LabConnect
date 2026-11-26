import { Logger } from '@nestjs/common';
import {
  CLAIM_LIMITS,
  FixedClock,
  type FilesConfig,
  InMemoryObjectStorage,
} from '@labconnect/core';
import { type ScanStatus, withDbContext } from '@labconnect/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILES_CONFIG, OBJECT_STORAGE } from '../../src/modules/files/files.module.js';
import { useClaimLabs } from '../support/claim-labs.js';
import { START, useIdentityApp } from '../support/identity-app.js';

// The three abuse limits of the lab claim flow over HTTP, held to the contract, on a real database
// (I1-LAB-06): 24-hour expiry of an unverified claim, 3 open claims per person, 5 letterhead
// uploads per claim. The boundaries to the millisecond are tested in packages/core
// (test/db/labs-claims-limits.test.ts); here a claim is made exactly 24 hours old by writing its
// `created_at`, so no access token has to outlive the clock.

const TTL = CLAIM_LIMITS.unverifiedClaimTtlMs;
const FILES: FilesConfig = {
  bucket: 'labconnect-test',
  quarantinePrefix: 'quarantine',
  cleanPrefix: 'clean',
};
const PDF = { fileName: 'Letter - Asha Rao.pdf', contentType: 'application/pdf', sizeBytes: 5000 };

describe('lab claims: the abuse limits', () => {
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
  const start = (token: string, certificateNo: string) =>
    t.api.post('/v1/lab/claims', { token, body: { certificateNo } });
  const verify = (token: string, id: string, code: string, ifMatch = '"0"') =>
    t.api.post(`/v1/lab/claims/${id}/verify-otp`, {
      token,
      body: { code },
      headers: { 'If-Match': ifMatch },
    });
  const uploadUrl = (token: string, id: string) =>
    t.api.post(`/v1/lab/claims/${id}/manual/upload-url`, { token, body: PDF });
  const submit = (token: string, id: string, fileId: string) =>
    t.api.post(`/v1/lab/claims/${id}/manual`, {
      token,
      body: { fileId },
      headers: { 'If-Match': '"0"' },
    });
  const idOf = (response: { body: unknown }) => (response.body as { id: string }).id;
  const fileIdOf = (response: { body: unknown }) => (response.body as { fileId: string }).fileId;
  const settleClean = (fileId: string) =>
    withDbContext(t.worker(), { kind: 'system' }, (tx) =>
      tx.fileObject.update({
        where: { id: fileId },
        data: {
          scanStatus: 'CLEAN' satisfies ScanStatus,
          sha256: new Uint8Array(32).fill(7),
          detectedContentType: 'application/pdf',
        },
      }),
    );
  /** Makes the claim exactly 24 hours old at the fixed clock of the test (the stale boundary). */
  const age = (claimId: string) =>
    t
      .db()
      .query('UPDATE lab_claim_request SET created_at = $1 WHERE id = $2', [
        new Date(Date.parse(START) - TTL),
        claimId,
      ]);
  const rowOf = async (claimId: string) =>
    (
      await t
        .db()
        .query<{ status: string; lock_version: number; authorisation_file_id: string | null }>(
          'SELECT status, lock_version, authorisation_file_id FROM lab_claim_request WHERE id = $1',
          [claimId],
        )
    ).rows[0];
  const linksOf = async (claimId: string) =>
    Number(
      (
        await t
          .db()
          .query<{ n: string }>(
            "SELECT count(*) AS n FROM file_link WHERE entity_type = 'lab_claim_request' AND entity_id = $1",
            [claimId],
          )
      ).rows[0]?.n,
    );
  /** A listed lab with no NABL address: a MANUAL claim, so starting it sends no code. */
  const manualLab = () => makeLab({ email: null });

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

  describe('24 hours', () => {
    it('answers 409 EXPIRED to verifyLabClaimOtp on a claim 24 hours old, and the claim is EXPIRED afterwards', async () => {
      const claimable = await makeLab({ email: 'expiring.head@stale-claims.example.test' });
      const user = await newUser();
      const started = await start(user.token, claimable.certificateNo);
      expect(started.status).toBe(201);
      const id = idOf(started);
      const code = t.mailer.lastClaimCodeFor(claimable.email?.toLowerCase() ?? '') ?? '';
      await age(id);
      const response = await verify(user.token, id, code);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        meta: { currentState: 'EXPIRED' },
      });
      // Committed although the request was refused.
      expect(await rowOf(id)).toMatchObject({ status: 'EXPIRED', lock_version: 1 });
      // And the code no longer works, whatever it is.
      const again = await verify(user.token, id, code, '"1"');
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ meta: { currentState: 'EXPIRED' } });
      expect(lines.join('\n')).not.toContain('expiring.head');
    });

    it('answers 409 EXPIRED to the upload URL and the letterhead submit on a claim 24 hours old', async () => {
      const claimable = await manualLab();
      const user = await newUser();
      const id = idOf(await start(user.token, claimable.certificateNo));
      const upload = await uploadUrl(user.token, id);
      expect(upload.status).toBe(201);
      await settleClean(fileIdOf(upload));
      await age(id);
      const refused = await uploadUrl(user.token, id);
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        meta: { currentState: 'EXPIRED' },
      });
      expect(await rowOf(id)).toMatchObject({ status: 'EXPIRED', lock_version: 1 });
      expect(await linksOf(id)).toBe(1);

      const other = await manualLab();
      const user2 = await newUser('second');
      const id2 = idOf(await start(user2.token, other.certificateNo));
      const file2 = fileIdOf(await uploadUrl(user2.token, id2));
      await settleClean(file2);
      await age(id2);
      const submitted = await submit(user2.token, id2, file2);
      expect(submitted.status).toBe(409);
      expect(submitted.body).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        meta: { currentState: 'EXPIRED' },
      });
      expect(await rowOf(id2)).toMatchObject({
        status: 'EXPIRED',
        lock_version: 1,
        authorisation_file_id: null,
      });
    });

    it("answers 201 with a new claim to a person who starts over an expired claim, their own or another one's", async () => {
      const claimable = await manualLab();
      const owner = await newUser('owner');
      const rival = await newUser('rival');
      const first = idOf(await start(owner.token, claimable.certificateNo));
      // Fresh: the rival is refused as before.
      const refused = await start(rival.token, claimable.certificateNo);
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ meta: { currentState: 'CLAIM_PENDING' } });
      await age(first);
      const second = await start(rival.token, claimable.certificateNo);
      expect(second.status).toBe(201);
      expect(second.headers.etag).toBe('"0"');
      expect(idOf(second)).not.toBe(first);
      expect(await rowOf(first)).toMatchObject({ status: 'EXPIRED' });

      // The caller's own stale claim: a new claim (201), not a new code on the old one (200).
      const mine = await manualLab();
      const user = await newUser();
      const stale = idOf(await start(user.token, mine.certificateNo));
      await age(stale);
      const renewed = await start(user.token, mine.certificateNo);
      expect(renewed.status).toBe(201);
      expect(idOf(renewed)).not.toBe(stale);
      expect(await rowOf(stale)).toMatchObject({ status: 'EXPIRED' });
    });
  });

  describe('three open claims', () => {
    it('answers 429 RATE_LIMITED to a fourth claim, with no Retry-After and no address or lab name', async () => {
      const user = await newUser();
      for (let i = 0; i < CLAIM_LIMITS.maxOpenClaimsPerUser; i++) {
        const made = await manualLab();
        expect((await start(user.token, made.certificateNo)).status).toBe(201);
      }
      const target = await makeLab({ email: 'fourth.lab.head@cap-target.example.test' });
      const before = t.mailer.claimSent.length;
      const response = await start(user.token, target.certificateNo);
      expect(response.status).toBe(429);
      expect(response.body).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      expect(response.headers['retry-after']).toBeUndefined();
      const text = `${JSON.stringify(response.body)}\n${lines.join('\n')}`;
      for (const secret of [target.siteName, target.siteCode, 'fourth.lab.head', 'cap-target']) {
        expect(text, secret).not.toContain(secret);
      }
      expect((response.body as { detail: string }).detail).toContain(
        'maximum number of open claims',
      );
      expect(t.mailer.claimSent).toHaveLength(before);
      const rows = await t
        .db()
        .query('SELECT 1 FROM lab_claim_request WHERE organisation_id = $1', [
          target.organisationId,
        ]);
      expect(rows.rowCount).toBe(0);
    });

    it('still lets a person at the limit ask for a new code for an open claim (200), and counts an expired claim no more', async () => {
      const user = await newUser();
      const made: { certificateNo: string; id: string }[] = [];
      for (let i = 0; i < CLAIM_LIMITS.maxOpenClaimsPerUser; i++) {
        const lab = await makeLab({ email: `cap.${String(i)}@cap-resend.example.test` });
        const started = await start(user.token, lab.certificateNo);
        made.push({ certificateNo: lab.certificateNo, id: idOf(started) });
      }
      const resent = await start(user.token, made[0]?.certificateNo ?? '');
      expect(resent.status).toBe(200);
      const next = await manualLab();
      expect((await start(user.token, next.certificateNo)).status).toBe(429);
      await age(made[1]?.id ?? '');
      expect((await start(user.token, next.certificateNo)).status).toBe(201);
    });
  });

  describe('five letterhead uploads', () => {
    it('answers 429 RATE_LIMITED to the sixth upload URL of a claim, with no Retry-After, and still accepts one of the five files', async () => {
      const claimable = await manualLab();
      const user = await newUser();
      const id = idOf(await start(user.token, claimable.certificateNo));
      const fileIds: string[] = [];
      for (let i = 0; i < CLAIM_LIMITS.maxLetterheadUploadsPerClaim; i++) {
        const response = await uploadUrl(user.token, id);
        expect(response.status).toBe(201);
        fileIds.push(fileIdOf(response));
      }
      const sixth = await uploadUrl(user.token, id);
      expect(sixth.status).toBe(429);
      expect(sixth.body).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      expect(sixth.headers['retry-after']).toBeUndefined();
      const text = `${JSON.stringify(sixth.body)}\n${lines.join('\n')}`;
      for (const secret of [claimable.siteName, claimable.siteCode, 'Asha', id]) {
        expect(text, secret).not.toContain(secret);
      }
      expect(await linksOf(id)).toBe(CLAIM_LIMITS.maxLetterheadUploadsPerClaim);

      const chosen = fileIds[3] ?? '';
      await settleClean(chosen);
      const done = await submit(user.token, id, chosen);
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({ id, status: 'PENDING_REVIEW', method: 'MANUAL' });
    });
  });
});
