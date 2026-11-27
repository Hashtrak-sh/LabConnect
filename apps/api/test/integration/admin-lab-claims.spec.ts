import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FixedClock, type FilesConfig, InMemoryObjectStorage, maskEmail } from '@labconnect/core';
import { withDbContext } from '@labconnect/database';
import { ROLES } from '@labconnect/shared';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILES_CONFIG, OBJECT_STORAGE } from '../../src/modules/files/files.module.js';
import { useClaimLabs, type ClaimableLab } from '../support/claim-labs.js';
import { START, useIdentityApp } from '../support/identity-app.js';
import { claimRoleUsers, type ClaimRoleUsers } from '../support/claim-roles.js';
import type { TenantUser } from '../support/isolation/world.js';

// listAdminLabClaims, approveAdminLabClaim and rejectAdminLabClaim over HTTP, held to the contract,
// on a real database (I2-ADM-01 to I2-ADM-03). Claims are made through the lab-side operations.

describe('Ops lab claims: GET /v1/admin/claims and POST /v1/admin/claims/{id}/(approve|reject)', () => {
  const t = useIdentityApp({
    configure: (builder) =>
      builder
        .overrideProvider(OBJECT_STORAGE)
        .useValue(new InMemoryObjectStorage(new FixedClock(START)))
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

  // ---------------------------------------------------------------- sign-in helpers

  // One sign-in per user: MFA codes are single use within their 30-second step (the clock is fixed).
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

  interface InReview {
    lab: ClaimableLab;
    claimId: string;
    claimantEmail: string;
    claimantId: string;
    claimantToken: string;
    fileId?: string;
  }

  /** A claim in PENDING_REVIEW, made through the lab-side routes by a new claimant. */
  const inReview = async (options: { manual?: boolean } = {}): Promise<InReview> => {
    const lab = await makeLab(
      options.manual === true
        ? { email: null }
        : { email: `nabl.${randomUUID().slice(0, 8)}@review-lab.example.test` },
    );
    const claimantEmail = t.newEmail('claimant');
    const claimant = await t.signIn(claimantEmail);
    const started = await t.api.post('/v1/lab/claims', {
      token: claimant.accessToken,
      body: { certificateNo: lab.certificateNo },
    });
    expect(started.status).toBe(201);
    const claimId = (started.body as { id: string }).id;
    let fileId: string | undefined;
    if (options.manual === true) {
      const upload = await t.api.post(`/v1/lab/claims/${claimId}/manual/upload-url`, {
        token: claimant.accessToken,
        body: { fileName: 'letterhead.pdf', contentType: 'application/pdf', sizeBytes: 90_000 },
      });
      expect(upload.status).toBe(201);
      fileId = (upload.body as { fileId: string }).fileId;
      await withDbContext(t.worker(), { kind: 'system' }, (tx) =>
        tx.fileObject.update({
          where: { id: fileId },
          data: {
            scanStatus: 'CLEAN',
            sha256: new Uint8Array(32).fill(5),
            detectedContentType: 'application/pdf',
          },
        }),
      );
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
      expect(verified.headers.etag).toBe('"1"');
    }
    return {
      lab,
      claimId,
      claimantEmail,
      claimantId: await idOf(claimantEmail),
      claimantToken: claimant.accessToken,
      ...(fileId !== undefined && { fileId }),
    };
  };

  const list = (token: string | undefined, query = '') =>
    t.api.get(`/v1/admin/claims${query}`, { ...(token !== undefined && { token }) });
  const approve = (
    token: string | undefined,
    claimId: string,
    ifMatch: string | undefined,
    body: unknown = {},
  ) =>
    t.api.post(`/v1/admin/claims/${claimId}/approve`, {
      ...(token !== undefined && { token }),
      body: body as object,
      ...(ifMatch !== undefined && { headers: { 'If-Match': ifMatch } }),
    });
  const reject = (
    token: string | undefined,
    claimId: string,
    ifMatch: string | undefined,
    body: unknown = { decisionNotes: 'Not the lab.' },
  ) =>
    t.api.post(`/v1/admin/claims/${claimId}/reject`, {
      ...(token !== undefined && { token }),
      body: body as object,
      ...(ifMatch !== undefined && { headers: { 'If-Match': ifMatch } }),
    });

  const claimRow = async (claimId: string) =>
    (
      await t.db().query<{
        status: string;
        lock_version: number;
        decision_notes: string | null;
        reviewed_by_user_id: string | null;
      }>('SELECT status, lock_version, decision_notes, reviewed_by_user_id FROM lab_claim_request WHERE id = $1', [claimId])
    ).rows[0];
  const createdOf = async (claimId: string): Promise<Date> =>
    (
      await t
        .db()
        .query<{ created_at: Date }>('SELECT created_at FROM lab_claim_request WHERE id = $1', [
          claimId,
        ])
    ).rows[0]?.created_at ?? new Date(0);
  const membersOf = async (organisationId: string) =>
    (
      await t
        .db()
        .query<{ user_id: string }>('SELECT user_id FROM membership WHERE organisation_id = $1', [
          organisationId,
        ])
    ).rows;
  const claimStatusOf = async (organisationId: string) =>
    (
      await t
        .db()
        .query<{ claim_status: string }>('SELECT claim_status FROM organisation WHERE id = $1', [
          organisationId,
        ])
    ).rows[0]?.claim_status;

  /** Everything the process writes to the console, stdout/stderr and Nest's logger. */
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

  // ---------------------------------------------------------------- who may call (401, 403)

  describe('who may call', () => {
    it('answers 401 UNAUTHENTICATED without a token and with a bad one, on all three operations', async () => {
      const claim = await inReview();
      for (const token of [undefined, 'not-a-token']) {
        for (const response of [
          await list(token),
          await approve(token, claim.claimId, '"1"'),
          await reject(token, claim.claimId, '"1"'),
        ]) {
          expect(response.status).toBe(401);
          expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
        }
      }
    });

    it('answers 403 FORBIDDEN to every role but PLATFORM_OPS, and changes nothing', async () => {
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
      for (const user of users) {
        const token = await tokenOfUser(user);
        for (const response of [
          await list(token),
          await approve(token, claim.claimId, '"1"'),
          await reject(token, claim.claimId, '"1"'),
          // The refusal comes before the request is read: a bad header or body is still 403.
          await t.api.post(`/v1/admin/claims/${claim.claimId}/approve`, {
            token,
            body: { nope: true },
            invalidRequest: 'no If-Match and an unknown field: the role is refused first',
          }),
        ]) {
          expect(response.status, user.role).toBe(403);
          expect(response.body, user.role).toMatchObject({ code: 'FORBIDDEN' });
        }
      }
      expect(await claimRow(claim.claimId)).toMatchObject({
        status: 'PENDING_REVIEW',
        lock_version: 1,
      });
      expect(await membersOf(claim.lab.organisationId)).toEqual([]);
    });

    it('answers 403 to a signed-in user with no membership', async () => {
      const claim = await inReview();
      const stranger = await t.signIn(t.newEmail('nobody'));
      for (const response of [
        await list(stranger.accessToken),
        await approve(stranger.accessToken, claim.claimId, '"1"'),
        await reject(stranger.accessToken, claim.claimId, '"1"'),
      ]) {
        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
      }
      // The claimant of the claim is such a user too.
      expect((await approve(claim.claimantToken, claim.claimId, '"1"')).status).toBe(403);
      expect(await claimRow(claim.claimId)).toMatchObject({ status: 'PENDING_REVIEW' });
    });
  });

  // ---------------------------------------------------------------- the list

  describe('listAdminLabClaims', () => {
    it('answers 200 with the claims as AdminLabClaim, oldest first, and no personal data', async () => {
      const first = await inReview();
      t.clock.advance(1000);
      const second = await inReview({ manual: true });
      const createdAt = (await createdOf(second.claimId)).toISOString();
      const token = await opsToken();
      const response = await list(token, '?status=PENDING_REVIEW&limit=100');
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const body = response.body as {
        data: Record<string, unknown>[];
        page: { nextCursor: string | null; limit: number };
      };
      expect(body.page).toEqual({ nextCursor: null, limit: 100 });
      const ids = body.data.map((row) => row.id);
      expect(ids.indexOf(first.claimId)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(first.claimId)).toBeLessThan(ids.indexOf(second.claimId));
      expect(body.data.find((row) => row.id === second.claimId)).toEqual({
        id: second.claimId,
        organisationId: second.lab.organisationId,
        labSiteId: second.lab.siteId,
        requestedByUserId: second.claimantId,
        method: 'MANUAL',
        status: 'PENDING_REVIEW',
        authorisationFileId: second.fileId,
        reviewedByUserId: null,
        reviewedAt: null,
        decisionNotes: null,
        createdAt,
        lockVersion: 1,
        labSite: {
          id: second.lab.siteId,
          siteCode: second.lab.siteCode,
          name: second.lab.siteName,
          city: expect.any(String) as string,
          stateCode: expect.any(String) as string,
          certificateNos: [second.lab.certificateNo],
        },
        claimant: {
          id: second.claimantId,
          fullName: expect.any(String) as string,
          emailMasked: maskEmail(second.claimantEmail),
          organisationTypes: [],
        },
      });
      expect(response.text).not.toContain(first.claimantEmail);
      expect(response.text).not.toContain(second.claimantEmail);
      expect(response.text).not.toContain(first.lab.email ?? 'no-such-address');
    });

    it('pages with limit and cursor, and ends with a null cursor', async () => {
      await inReview();
      await inReview();
      await inReview();
      const token = await opsToken();
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const response = await list(
          token,
          `?limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
        );
        expect(response.status).toBe(200);
        const body = response.body as {
          data: { id: string }[];
          page: { nextCursor: string | null; limit: number };
        };
        expect(body.page.limit).toBe(2);
        expect(body.data.length).toBeLessThanOrEqual(2);
        seen.push(...body.data.map((row) => row.id));
        cursor = body.page.nextCursor;
        pages += 1;
      } while (cursor !== null && pages < 100);
      expect(pages).toBeGreaterThanOrEqual(2);
      expect(new Set(seen).size).toBe(seen.length);
      const all = await list(token, '?limit=100');
      expect((all.body as { data: { id: string }[] }).data.map((row) => row.id)).toEqual(seen);
    });

    it('filters by status, and shows a PENDING_OTP claim 24 hours old as EXPIRED (found by EXPIRED, not by PENDING_OTP)', async () => {
      const token = await opsToken();
      const approved = await inReview();
      expect((await approve(token, approved.claimId, '"1"')).status).toBe(200);
      const rejected = await inReview();
      expect((await reject(token, rejected.claimId, '"1"')).status).toBe(200);

      const lab = await makeLab();
      const user = await t.signIn(t.newEmail('slow'));
      const started = await t.api.post('/v1/lab/claims', {
        token: user.accessToken,
        body: { certificateNo: lab.certificateNo },
      });
      const staleId = (started.body as { id: string }).id;
      const fresh = await inReview();
      await t
        .db()
        .query('UPDATE lab_claim_request SET created_at = $2 WHERE id = $1', [
          staleId,
          new Date(new Date(START).getTime() - 24 * 3600_000),
        ]);

      const ids = async (status: string) =>
        (
          (await list(token, `?status=${status}&limit=100`)).body as {
            data: { id: string; status: string }[];
          }
        ).data;
      expect((await ids('APPROVED')).map((r) => r.id)).toContain(approved.claimId);
      expect((await ids('APPROVED')).map((r) => r.id)).not.toContain(rejected.claimId);
      expect((await ids('REJECTED')).map((r) => r.id)).toContain(rejected.claimId);
      expect((await ids('PENDING_REVIEW')).map((r) => r.id)).toContain(fresh.claimId);
      const expired = await ids('EXPIRED');
      expect(expired.find((r) => r.id === staleId)).toMatchObject({ status: 'EXPIRED' });
      expect((await ids('PENDING_OTP')).map((r) => r.id)).not.toContain(staleId);
      // The read did not write: the stored row is still PENDING_OTP.
      expect(await claimRow(staleId)).toMatchObject({ status: 'PENDING_OTP', lock_version: 0 });
    });

    it('answers 422 VALIDATION_FAILED for an unknown status, a bad limit and an unreadable cursor', async () => {
      const token = await opsToken();
      for (const query of [
        '?status=DONE',
        '?limit=0',
        '?limit=101',
        '?limit=ten',
        '?cursor=',
        '?cursor=not-a-cursor',
        `?cursor=${Buffer.from(JSON.stringify({ i: randomUUID() })).toString('base64url')}`,
      ]) {
        const response = await t.api.get(`/v1/admin/claims${query}`, {
          token,
          invalidRequest: 'a query the contract does not allow, to check the answer',
        });
        expect(response.status, query).toBe(422);
        expect(response.body, query).toMatchObject({ code: 'VALIDATION_FAILED' });
      }
    });
  });

  // ---------------------------------------------------------------- approve

  describe('approveAdminLabClaim', () => {
    it('answers 200 with the claim and an ETag, makes the claimant the Checker and forces MFA at the next sign-in', async () => {
      const claim = await inReview();
      const token = await opsToken();
      const NOTES = 'Confirmed with the NABL contact by telephone.';
      t.clock.advance(5000);
      const response = await approve(token, claim.claimId, '"1"', { decisionNotes: NOTES });
      expect(response.status).toBe(200);
      expect(response.headers.etag).toBe('"2"');
      expect(response.headers['cache-control']).toBe('no-store');
      const opsUser = world.byRole('PLATFORM_OPS');
      expect(response.body).toEqual({
        id: claim.claimId,
        organisationId: claim.lab.organisationId,
        labSiteId: claim.lab.siteId,
        requestedByUserId: claim.claimantId,
        method: 'EMAIL_OTP',
        status: 'APPROVED',
        authorisationFileId: null,
        reviewedByUserId: opsUser.id,
        reviewedAt: t.clock.now().toISOString(),
        decisionNotes: NOTES,
        createdAt: (await createdOf(claim.claimId)).toISOString(),
        lockVersion: 2,
        labSite: {
          id: claim.lab.siteId,
          siteCode: claim.lab.siteCode,
          name: claim.lab.siteName,
          city: expect.any(String) as string,
          stateCode: expect.any(String) as string,
          certificateNos: [claim.lab.certificateNo],
        },
        claimant: {
          id: claim.claimantId,
          fullName: expect.any(String) as string,
          emailMasked: maskEmail(claim.claimantEmail),
          organisationTypes: [],
        },
      });
      expect(await claimStatusOf(claim.lab.organisationId)).toBe('CLAIMED');
      expect(await membersOf(claim.lab.organisationId)).toEqual([{ user_id: claim.claimantId }]);

      // "MFA enrolment forced": the next sign-in is a partial session, until MFA is set up.
      const signedIn = await t.signIn(claim.claimantEmail);
      expect(signedIn.mfaRequired).toBe(true);
      const full = await t.signInWithMfa(claim.claimantEmail);
      const me = await t.api.get('/v1/me', { token: full.accessToken });
      expect(me.status).toBe(200);
      expect(JSON.stringify(me.body)).toContain('LAB_CHECKER');
      expect(JSON.stringify(me.body)).toContain(claim.lab.organisationId);

      // Nothing sensitive reached the logs.
      const logged = lines.join('\n');
      expect(logged).not.toContain(NOTES);
      expect(logged).not.toContain(claim.claimantEmail);
    });

    it('approves a MANUAL claim with a clean letterhead', async () => {
      const claim = await inReview({ manual: true });
      const response = await approve(await opsToken(), claim.claimId, '"1"');
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        method: 'MANUAL',
        status: 'APPROVED',
        authorisationFileId: claim.fileId,
        decisionNotes: null,
      });
    });

    it('answers 400 for a missing, weak or malformed If-Match', async () => {
      const claim = await inReview();
      const token = await opsToken();
      for (const ifMatch of [undefined, 'W/"1"', '1', '*', '"1", "2"']) {
        const response = await t.api.post(`/v1/admin/claims/${claim.claimId}/approve`, {
          token,
          body: {},
          ...(ifMatch !== undefined && { headers: { 'If-Match': ifMatch } }),
          invalidRequest: 'an If-Match the contract does not allow, to check the answer',
        });
        expect(response.status, String(ifMatch)).toBe(400);
      }
      expect(await claimRow(claim.claimId)).toMatchObject({ status: 'PENDING_REVIEW' });
    });

    it('answers 404 for an unknown claim', async () => {
      const response = await approve(await opsToken(), randomUUID(), '"1"');
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('answers 409 INVALID_STATE_TRANSITION with currentState for a claim that is not in review, and for a repeat', async () => {
      const token = await opsToken();
      const claim = await inReview();
      expect((await approve(token, claim.claimId, '"1"')).status).toBe(200);
      const again = await approve(token, claim.claimId, '"2"');
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        meta: { currentState: 'APPROVED' },
      });
      const afterwards = await reject(token, claim.claimId, '"2"');
      expect(afterwards.status).toBe(409);
      expect(afterwards.body).toMatchObject({ meta: { currentState: 'APPROVED' } });

      // A claim still waiting for its code, and a stale one, are not decidable either.
      const lab = await makeLab();
      const user = await t.signIn(t.newEmail('waiting'));
      const started = await t.api.post('/v1/lab/claims', {
        token: user.accessToken,
        body: { certificateNo: lab.certificateNo },
      });
      const waiting = (started.body as { id: string }).id;
      const early = await approve(token, waiting, '"0"');
      expect(early.status).toBe(409);
      expect(early.body).toMatchObject({ meta: { currentState: 'PENDING_OTP' } });
      await t
        .db()
        .query('UPDATE lab_claim_request SET created_at = $2 WHERE id = $1', [
          waiting,
          new Date(new Date(START).getTime() - 25 * 3600_000),
        ]);
      const late = await approve(token, waiting, '"0"');
      expect(late.status).toBe(409);
      expect(late.body).toMatchObject({ meta: { currentState: 'EXPIRED' } });
      expect(await claimRow(waiting)).toMatchObject({ status: 'PENDING_OTP', lock_version: 0 });
    });

    it('answers 409 when the organisation is already claimed, and writes nothing', async () => {
      const claim = await inReview();
      await t
        .db()
        .query("UPDATE organisation SET claim_status = 'CLAIMED' WHERE id = $1", [
          claim.lab.organisationId,
        ]);
      const response = await approve(await opsToken(), claim.claimId, '"1"');
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ meta: { currentState: 'CLAIMED' } });
      expect(await claimRow(claim.claimId)).toMatchObject({
        status: 'PENDING_REVIEW',
        lock_version: 1,
      });
      expect(await membersOf(claim.lab.organisationId)).toEqual([]);
    });

    it('answers 412 CONCURRENT_MODIFICATION for a stale If-Match', async () => {
      const claim = await inReview();
      const response = await approve(await opsToken(), claim.claimId, '"0"');
      expect(response.status).toBe(412);
      expect(response.body).toMatchObject({ code: 'CONCURRENT_MODIFICATION' });
      expect(await claimRow(claim.claimId)).toMatchObject({ status: 'PENDING_REVIEW' });
    });

    it('answers 422 VALIDATION_FAILED for a body the schema refuses (unknown field, wrong type, too long)', async () => {
      const claim = await inReview();
      const token = await opsToken();
      for (const body of [
        { organisationId: randomUUID() },
        { decisionNotes: 7 },
        { decisionNotes: 'x'.repeat(2001) },
        [],
      ]) {
        const response = await t.api.post(`/v1/admin/claims/${claim.claimId}/approve`, {
          token,
          body: body as object,
          headers: { 'If-Match': '"1"' },
          invalidRequest: 'a body the contract does not allow, to check the answer',
        });
        expect(response.status).toBe(422);
        expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      }
      const badId = await t.api.post('/v1/admin/claims/not-a-uuid/approve', {
        token,
        body: {},
        headers: { 'If-Match': '"1"' },
        invalidRequest: 'a path id that is not a UUID',
      });
      expect(badId.status).toBe(422);
      expect(await claimRow(claim.claimId)).toMatchObject({ status: 'PENDING_REVIEW' });
    });

    it('answers 422 VALIDATION_FAILED with the reason when the claimant can no longer be made a Checker, and writes nothing', async () => {
      const token = await opsToken();
      const staff = await inReview();
      await t
        .db()
        .query('UPDATE app_user SET is_platform_staff = true WHERE id = $1', [staff.claimantId]);
      const inactive = await inReview();
      await t
        .db()
        .query("UPDATE app_user SET status = 'DISABLED' WHERE id = $1", [inactive.claimantId]);
      const holder = await inReview();
      await t.owner((tx) =>
        t.addMember(tx, holder.claimantId, world.otherLabOrganisationId, 'LAB_MAKER', [
          world.otherLabSiteIds[0] ?? '',
        ]),
      );
      for (const [claim, reason] of [
        [staff, 'CLAIMANT_IS_PLATFORM_STAFF'],
        [inactive, 'CLAIMANT_NOT_ACTIVE'],
        [holder, 'CLAIMANT_HOLDS_LAB_ROLE'],
      ] as const) {
        const response = await approve(token, claim.claimId, '"1"');
        expect(response.status, reason).toBe(422);
        expect(response.body, reason).toMatchObject({
          code: 'VALIDATION_FAILED',
          meta: { reason },
        });
        expect(response.text).not.toContain(claim.claimantEmail);
        expect(await claimRow(claim.claimId)).toMatchObject({
          status: 'PENDING_REVIEW',
          lock_version: 1,
        });
        expect(await claimStatusOf(claim.lab.organisationId)).toBe('UNCLAIMED');
      }
    });

    it('answers 422 FILE_NOT_CLEAN for a manual claim whose letterhead is not clean', async () => {
      const claim = await inReview();
      const lab = await makeLab({ email: null });
      const claimant = await t.signIn(t.newEmail('manual'));
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
      await t
        .db()
        .query(
          `UPDATE lab_claim_request SET status = 'PENDING_REVIEW', method = 'MANUAL', authorisation_file_id = $2, lock_version = 1 WHERE id = $1`,
          [claimId, fileId],
        );
      const response = await approve(await opsToken(), claimId, '"1"');
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({ code: 'FILE_NOT_CLEAN' });
      expect(await claimRow(claimId)).toMatchObject({ status: 'PENDING_REVIEW' });
      expect(claim.claimId).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------- reject

  describe('rejectAdminLabClaim', () => {
    it('answers 200 with the claim and an ETag, frees the organisation and writes no membership', async () => {
      const claim = await inReview();
      const token = await opsToken();
      const NOTES = 'The letter is not from the lab. Please ask the head of laboratory to apply.';
      const response = await reject(token, claim.claimId, '"1"', { decisionNotes: NOTES });
      expect(response.status).toBe(200);
      expect(response.headers.etag).toBe('"2"');
      expect(response.body).toMatchObject({
        id: claim.claimId,
        status: 'REJECTED',
        reviewedByUserId: world.byRole('PLATFORM_OPS').id,
        decisionNotes: NOTES,
        lockVersion: 2,
      });
      expect(await claimStatusOf(claim.lab.organisationId)).toBe('UNCLAIMED');
      expect(await membersOf(claim.lab.organisationId)).toEqual([]);
      // The same person can start again, and so can anyone else.
      const again = await t.api.post('/v1/lab/claims', {
        token: claim.claimantToken,
        body: { certificateNo: claim.lab.certificateNo },
      });
      expect(again.status).toBe(201);
      expect((again.body as { id: string }).id).not.toBe(claim.claimId);
      expect(again.body).toMatchObject({ decisionNotes: null, reviewedAt: null });
      expect(JSON.stringify(again.body)).not.toContain(world.byRole('PLATFORM_OPS').id);
      expect(lines.join('\n')).not.toContain(NOTES);
    });

    it('answers 422 for missing, empty or blank notes and for unknown fields, and 409, 412, 404 and 400 as approve does', async () => {
      const claim = await inReview();
      const token = await opsToken();
      for (const body of [
        {},
        { decisionNotes: '' },
        { decisionNotes: 'x'.repeat(2001) },
        { decisionNotes: 'ok', extra: 1 },
      ]) {
        const response = await t.api.post(`/v1/admin/claims/${claim.claimId}/reject`, {
          token,
          body,
          headers: { 'If-Match': '"1"' },
          invalidRequest: 'a body the contract does not allow, to check the answer',
        });
        expect(response.status, JSON.stringify(body)).toBe(422);
      }
      // Blank is valid for the schema (it has a character) but is not a reason.
      const blank = await reject(token, claim.claimId, '"1"', { decisionNotes: '   ' });
      expect(blank.status).toBe(422);
      expect(blank.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        meta: { reason: 'DECISION_NOTES_REQUIRED' },
      });
      expect((await reject(token, randomUUID(), '"1"')).status).toBe(404);
      expect((await reject(token, claim.claimId, '"0"')).status).toBe(412);
      const noHeader = await t.api.post(`/v1/admin/claims/${claim.claimId}/reject`, {
        token,
        body: { decisionNotes: 'No.' },
        invalidRequest: 'no If-Match, to check the answer',
      });
      expect(noHeader.status).toBe(400);
      expect(await claimRow(claim.claimId)).toMatchObject({
        status: 'PENDING_REVIEW',
        lock_version: 1,
      });

      expect((await reject(token, claim.claimId, '"1"')).status).toBe(200);
      const repeat = await reject(token, claim.claimId, '"2"');
      expect(repeat.status).toBe(409);
      expect(repeat.body).toMatchObject({ meta: { currentState: 'REJECTED' } });
      const approveAfter = await approve(token, claim.claimId, '"2"');
      expect(approveAfter.status).toBe(409);
    });
  });
});
