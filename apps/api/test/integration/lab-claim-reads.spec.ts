import { randomUUID } from 'node:crypto';
import { FixedClock, type FilesConfig, InMemoryObjectStorage, maskEmail } from '@labconnect/core';
import { ROLES } from '@labconnect/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { FILES_CONFIG, OBJECT_STORAGE } from '../../src/modules/files/files.module.js';
import { claimRoleUsers, type ClaimRoleUsers } from '../support/claim-roles.js';
import { type ClaimableLab, useClaimLabs } from '../support/claim-labs.js';
import { START, useIdentityApp } from '../support/identity-app.js';
import type { TenantUser } from '../support/isolation/world.js';

// The claim reads over HTTP, held to the contract, on a real database: `listMyLabClaims` and
// `getLabClaim` for the claimant, `getAdminLabClaim` and the new fields of `listAdminLabClaims`
// for Ops (I2-LAB).

describe('lab claim reads: GET /v1/lab/claims, GET /v1/lab/claims/{id}, GET /v1/admin/claims/{id}', () => {
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

  interface Claim {
    lab: ClaimableLab;
    claimId: string;
    claimantEmail: string;
    claimantToken: string;
    claimantId: string;
  }

  /** A claim started through the API by a new user; `verified` sends it to review. */
  const claim = async (options: { verified?: boolean; manual?: boolean } = {}): Promise<Claim> => {
    const lab = await makeLab(
      options.manual === true
        ? { email: null }
        : { email: `nabl.${randomUUID().slice(0, 8)}@reads-lab.example.test` },
    );
    const claimantEmail = t.newEmail('claimant');
    const session = await t.signIn(claimantEmail);
    const started = await t.api.post('/v1/lab/claims', {
      token: session.accessToken,
      body: { certificateNo: lab.certificateNo },
    });
    expect(started.status).toBe(201);
    const claimId = (started.body as { id: string }).id;
    if (options.verified === true) {
      const code = t.mailer.lastClaimCodeFor(lab.email?.toLowerCase() ?? '') ?? '';
      const verified = await t.api.post(`/v1/lab/claims/${claimId}/verify-otp`, {
        token: session.accessToken,
        body: { code },
        headers: { 'If-Match': '"0"' },
      });
      expect(verified.status).toBe(200);
    }
    const id = (
      await t
        .db()
        .query<{ id: string }>('SELECT id FROM app_user WHERE email = $1', [
          claimantEmail.toLowerCase(),
        ])
    ).rows[0]?.id;
    return {
      lab,
      claimId,
      claimantEmail,
      claimantToken: session.accessToken,
      claimantId: id ?? '',
    };
  };

  const mine = (token: string | undefined, query = '') =>
    t.api.get(`/v1/lab/claims${query}`, { ...(token !== undefined && { token }) });
  const mineOne = (token: string | undefined, id: string) =>
    t.api.get(`/v1/lab/claims/${id}`, { ...(token !== undefined && { token }) });
  const opsOne = (token: string | undefined, id: string) =>
    t.api.get(`/v1/admin/claims/${id}`, { ...(token !== undefined && { token }) });
  const opsList = (token: string, query = '') => t.api.get(`/v1/admin/claims${query}`, { token });
  const approve = (token: string, id: string, ifMatch: string, body: object = {}) =>
    t.api.post(`/v1/admin/claims/${id}/approve`, {
      token,
      body,
      headers: { 'If-Match': ifMatch },
    });
  const reject = (token: string, id: string, ifMatch: string, decisionNotes: string) =>
    t.api.post(`/v1/admin/claims/${id}/reject`, {
      token,
      body: { decisionNotes },
      headers: { 'If-Match': ifMatch },
    });
  const rowOf = async (claimId: string) =>
    (
      await t
        .db()
        .query<{ status: string; lock_version: number }>(
          'SELECT status, lock_version FROM lab_claim_request WHERE id = $1',
          [claimId],
        )
    ).rows[0];

  const CLAIMANT_KEYS = [
    'createdAt',
    'decisionNotes',
    'id',
    'labSite',
    'method',
    'otpSentTo',
    'reviewedAt',
    'status',
  ];

  // ------------------------------------------------------------------ the claimant

  describe('for the claimant', () => {
    it('answers 401 without a token, on both operations', async () => {
      const c = await claim();
      for (const token of [undefined, 'not-a-token']) {
        for (const response of [await mine(token), await mineOne(token, c.claimId)]) {
          expect(response.status).toBe(401);
          expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
        }
      }
    });

    it('returns the claim the start returned, with the ETag, no-store, the masked address and nothing more', async () => {
      const c = await claim();
      const response = await mineOne(c.claimantToken, c.claimId);
      expect(response.status).toBe(200);
      expect(response.headers.etag).toBe('"0"');
      expect(response.headers['cache-control']).toBe('no-store');
      const body = response.body as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(CLAIMANT_KEYS);
      expect(body).toMatchObject({
        id: c.claimId,
        status: 'PENDING_OTP',
        method: 'EMAIL_OTP',
        labSite: { id: c.lab.siteId, siteCode: c.lab.siteCode, name: c.lab.siteName },
        reviewedAt: null,
        decisionNotes: null,
      });
      expect(body.otpSentTo).toBe(maskEmail(c.lab.email ?? ''));
      for (const secret of [c.lab.email ?? 'none', c.lab.organisationId, 'authorisation']) {
        expect(response.text).not.toContain(secret);
      }
    });

    it('lists the own claims newest first with the standard page, and an empty list for a user with none', async () => {
      const c = await claim();
      const second = await makeLab();
      t.clock.advance(1000);
      const started = await t.api.post('/v1/lab/claims', {
        token: c.claimantToken,
        body: { certificateNo: second.certificateNo },
      });
      expect(started.status).toBe(201);
      const secondId = (started.body as { id: string }).id;
      const response = await mine(c.claimantToken);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const body = response.body as {
        data: Record<string, unknown>[];
        page: { nextCursor: string | null; limit: number };
      };
      expect(body.page).toEqual({ nextCursor: null, limit: 25 });
      expect(body.data.map((row) => row.id)).toEqual([secondId, c.claimId]);
      for (const row of body.data) expect(Object.keys(row).sort()).toEqual(CLAIMANT_KEYS);
      const paged = await mine(c.claimantToken, '?limit=1');
      const first = paged.body as { data: { id: string }[]; page: { nextCursor: string } };
      expect(first.data.map((row) => row.id)).toEqual([secondId]);
      const next = await mine(c.claimantToken, `?limit=1&cursor=${first.page.nextCursor}`);
      expect((next.body as { data: { id: string }[] }).data.map((row) => row.id)).toEqual([
        c.claimId,
      ]);
      expect((next.body as { page: { nextCursor: null } }).page.nextCursor).toBeNull();

      const nobody = await t.signIn(t.newEmail('nobody'));
      const empty = await mine(nobody.accessToken);
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual({ data: [], page: { nextCursor: null, limit: 25 } });
    });

    it('accepts the ETag of a read in the next write and refuses a stale one', async () => {
      const c = await claim();
      const read = await mineOne(c.claimantToken, c.claimId);
      const code = t.mailer.lastClaimCodeFor(c.lab.email?.toLowerCase() ?? '') ?? '';
      const stale = await t.api.post(`/v1/lab/claims/${c.claimId}/verify-otp`, {
        token: c.claimantToken,
        body: { code },
        headers: { 'If-Match': '"7"' },
      });
      expect(stale.status).toBe(412);
      expect(stale.body).toMatchObject({ code: 'CONCURRENT_MODIFICATION' });
      const verified = await t.api.post(`/v1/lab/claims/${c.claimId}/verify-otp`, {
        token: c.claimantToken,
        body: { code },
        headers: { 'If-Match': String(read.headers.etag) },
      });
      expect(verified.status).toBe(200);
      const after = await mineOne(c.claimantToken, c.claimId);
      expect(after.headers.etag).toBe('"1"');
      expect(after.body).toMatchObject({ status: 'PENDING_REVIEW' });
    });

    it('answers 404 for another user claim and for an unknown id with the same body, and 422 for a malformed id', async () => {
      const owner = await claim();
      const stranger = await t.signIn(t.newEmail('stranger'));
      const other = await mineOne(stranger.accessToken, owner.claimId);
      const unknown = await mineOne(stranger.accessToken, randomUUID());
      expect(other.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect({ ...(other.body as object), requestId: '' }).toEqual({
        ...(unknown.body as object),
        requestId: '',
      });
      // Ids of other kinds of record are unknown ids.
      for (const id of [owner.lab.siteId, owner.lab.organisationId, owner.claimantId]) {
        expect((await mineOne(owner.claimantToken, id)).status).toBe(404);
      }
      const malformed = await t.api.get('/v1/lab/claims/not-a-uuid', {
        token: stranger.accessToken,
        invalidRequest: 'the id is not a UUID',
      });
      expect(malformed.status).toBe(422);
      const badLimit = await t.api.get('/v1/lab/claims?limit=0', {
        token: stranger.accessToken,
        invalidRequest: 'limit below the minimum',
      });
      expect(badLimit.status).toBe(422);
    });

    it('reports a pending claim 24 hours old as EXPIRED, writes nothing, and refuses the ETag of that read in a write', async () => {
      const c = await claim();
      await t
        .db()
        .query('UPDATE lab_claim_request SET created_at = $2 WHERE id = $1', [
          c.claimId,
          new Date(t.clock.now().getTime() - 24 * 60 * 60 * 1000),
        ]);
      const read = await mineOne(c.claimantToken, c.claimId);
      expect(read.body).toMatchObject({ status: 'EXPIRED', decisionNotes: null });
      expect((await mine(c.claimantToken)).body).toMatchObject({
        data: [{ id: c.claimId, status: 'EXPIRED' }],
      });
      expect(await rowOf(c.claimId)).toEqual({ status: 'PENDING_OTP', lock_version: 0 });
      const code = t.mailer.lastClaimCodeFor(c.lab.email?.toLowerCase() ?? '') ?? '';
      const write = await t.api.post(`/v1/lab/claims/${c.claimId}/verify-otp`, {
        token: c.claimantToken,
        body: { code },
        headers: { 'If-Match': String(read.headers.etag) },
      });
      expect(write.status).toBe(409);
      expect(write.body).toMatchObject({ meta: { currentState: 'EXPIRED' } });
      expect((await mineOne(c.claimantToken, c.claimId)).headers.etag).toBe('"1"');
    });

    it('shows the reason of a rejection and not the notes of an approval, with the decision time', async () => {
      const rejected = await claim({ verified: true });
      const approved = await claim({ verified: true });
      const ops = await opsToken();
      const reason = 'The letterhead does not name the laboratory.';
      expect((await reject(ops, rejected.claimId, '"1"', reason)).status).toBe(200);
      const internal = 'INTERNAL: known to us through the regional office';
      expect(
        (await approve(ops, approved.claimId, '"1"', { decisionNotes: internal })).status,
      ).toBe(200);

      const no = await mineOne(rejected.claimantToken, rejected.claimId);
      expect(no.body).toMatchObject({ status: 'REJECTED', decisionNotes: reason });
      expect((no.body as { reviewedAt: string }).reviewedAt).toEqual(expect.any(String));
      expect(no.headers.etag).toBe('"2"');
      const yes = await mineOne(approved.claimantToken, approved.claimId);
      expect(yes.body).toMatchObject({ status: 'APPROVED', decisionNotes: null });
      expect((yes.body as { reviewedAt: string }).reviewedAt).toEqual(expect.any(String));
      expect(yes.text).not.toContain('INTERNAL');
      expect((await mine(approved.claimantToken)).text).not.toContain('INTERNAL');
      // Nothing of the reviewer in either.
      const reviewer = world.byRole('PLATFORM_OPS');
      for (const text of [no.text, yes.text]) {
        expect(text).not.toContain(reviewer.id);
        expect(text).not.toContain(reviewer.email);
      }
    });

    it('refuses platform staff, who hold no claim, with 403 on both operations', async () => {
      const c = await claim();
      const token = await opsToken();
      for (const response of [await mine(token), await mineOne(token, c.claimId)]) {
        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
        expect(response.text).not.toContain(c.claimId);
      }
    });

    it('shows the claims of the user whatever organisation they belong to, and only theirs', async () => {
      const c = await claim();
      // A customer admin starts a claim and then reads it under their customer membership.
      const customer = world.byRole('CUSTOMER_ADMIN');
      const lab = await makeLab();
      const session = await t.signIn(customer.email);
      const started = await t.api.post('/v1/lab/claims', {
        token: session.accessToken,
        body: { certificateNo: lab.certificateNo },
      });
      expect(started.status).toBe(201);
      const id = (started.body as { id: string }).id;
      const list = await mine(session.accessToken);
      const ids = (list.body as { data: { id: string }[] }).data.map((row) => row.id);
      expect(ids).toContain(id);
      expect(ids).not.toContain(c.claimId);
      expect((await mineOne(session.accessToken, id)).status).toBe(200);
      expect((await mineOne(session.accessToken, c.claimId)).status).toBe(404);
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

    it('answers 401 without a token and 403 to every role but PLATFORM_OPS', async () => {
      const c = await claim({ verified: true });
      for (const token of [undefined, 'not-a-token']) {
        const response = await opsOne(token, c.claimId);
        expect(response.status).toBe(401);
      }
      for (const user of [
        world.byRole('PLATFORM_FINANCE'),
        world.byRole('PLATFORM_DATA_STEWARD'),
        world.byRole('PLATFORM_ADMIN'),
        world.byRole('LAB_CHECKER'),
        world.byRole('LAB_MAKER'),
        world.byRole('CUSTOMER_ADMIN'),
        world.byRole('CUSTOMER_REQUESTER'),
        world.byRole('CUSTOMER_FINANCE'),
      ]) {
        const response = await opsOne(await tokenOfUser(user), c.claimId);
        expect(response.status, user.role).toBe(403);
        expect(response.body, user.role).toMatchObject({ code: 'FORBIDDEN' });
        expect(response.text).not.toContain(c.claimantEmail);
      }
      // A user with no membership, the claimant included.
      expect((await opsOne(c.claimantToken, c.claimId)).status).toBe(403);
    });

    it('returns one claim with its ETag, the site and the claimant masked, identical to its entry in the list', async () => {
      const c = await claim({ verified: true });
      const ops = await opsToken();
      const response = await opsOne(ops, c.claimId);
      expect(response.status).toBe(200);
      expect(response.headers.etag).toBe('"1"');
      expect(response.headers['cache-control']).toBe('no-store');
      const body = response.body as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(OPS_KEYS);
      const site = await t
        .db()
        .query<{ city: string | null; state_code: string }>(
          `SELECT address->>'city' AS city, state_code FROM lab_site WHERE id = $1`,
          [c.lab.siteId],
        );
      expect(body.labSite).toEqual({
        id: c.lab.siteId,
        siteCode: c.lab.siteCode,
        name: c.lab.siteName,
        city: site.rows[0]?.city ?? '',
        stateCode: site.rows[0]?.state_code,
        certificateNos: [c.lab.certificateNo],
      });
      expect(body.claimant).toMatchObject({
        id: c.claimantId,
        emailMasked: maskEmail(c.claimantEmail),
        organisationTypes: [],
      });
      expect(Object.keys(body.claimant as object).sort()).toEqual([
        'emailMasked',
        'fullName',
        'id',
        'organisationTypes',
      ]);
      expect(response.text).not.toContain(c.claimantEmail);
      expect(response.text).not.toContain(c.lab.email ?? 'none');

      const listed = await opsList(ops, '?status=PENDING_REVIEW&limit=100');
      const entry = (listed.body as { data: { id: string }[] }).data.find(
        (row) => row.id === c.claimId,
      );
      expect(entry).toEqual(body);
    });

    it('does not let the masked address be undone by combining the reads', async () => {
      const c = await claim({ verified: true });
      const ops = await opsToken();
      const forOps = await opsOne(ops, c.claimId);
      const forClaimant = await mineOne(c.claimantToken, c.claimId);
      const masked = (forOps.body as { claimant: { emailMasked: string } }).claimant.emailMasked;
      const local = c.claimantEmail.split('@')[0] ?? '';
      expect(masked).toBe(maskEmail(c.claimantEmail));
      expect(masked).not.toContain(local.slice(1));
      // The claimant's own view carries the LAB's masked address, a different person's.
      expect(forClaimant.text).not.toContain(c.claimantEmail);
      expect(forClaimant.text).not.toContain(masked);
      const both = forOps.text + forClaimant.text;
      expect(both).not.toContain(c.claimantEmail);
      expect(both).not.toContain(c.lab.email ?? 'none');
    });

    it('accepts the ETag of the read in approve and reject, and refuses a stale one', async () => {
      const first = await claim({ verified: true });
      const second = await claim({ verified: true });
      const ops = await opsToken();
      const readFirst = await opsOne(ops, first.claimId);
      expect((await approve(ops, first.claimId, '"9"')).status).toBe(412);
      const approved = await approve(ops, first.claimId, String(readFirst.headers.etag));
      expect(approved.status).toBe(200);
      // The decision answers with the same shape as the read: the site and the claimant too.
      expect(Object.keys(approved.body as object).sort()).toEqual(OPS_KEYS);
      expect(approved.body).toMatchObject({
        status: 'APPROVED',
        claimant: { id: first.claimantId, organisationTypes: [] },
      });
      const readSecond = await opsOne(ops, second.claimId);
      const rejected = await reject(ops, second.claimId, String(readSecond.headers.etag), 'No.');
      expect(rejected.status).toBe(200);
      expect(Object.keys(rejected.body as object).sort()).toEqual(OPS_KEYS);
    });

    it('shows the other organisation of a claimant who belongs to one', async () => {
      const lab = await makeLab({
        email: `nabl.${randomUUID().slice(0, 8)}@reads-lab.example.test`,
      });
      const customer = world.byRole('CUSTOMER_ADMIN');
      const session = await t.signIn(customer.email);
      const started = await t.api.post('/v1/lab/claims', {
        token: session.accessToken,
        body: { certificateNo: lab.certificateNo },
      });
      expect(started.status).toBe(201);
      const response = await opsOne(await opsToken(), (started.body as { id: string }).id);
      expect(response.body).toMatchObject({
        claimant: { id: customer.id, organisationTypes: ['CUSTOMER'] },
      });
    });

    it('answers 404 for an unknown id and for an id of another kind of record, and 422 for a malformed id', async () => {
      const c = await claim({ verified: true });
      const ops = await opsToken();
      for (const id of [randomUUID(), c.lab.siteId, c.lab.organisationId, c.claimantId]) {
        const response = await opsOne(ops, id);
        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
      }
      const malformed = await t.api.get('/v1/admin/claims/not-a-uuid', {
        token: ops,
        invalidRequest: 'the id is not a UUID',
      });
      expect(malformed.status).toBe(422);
    });

    it('shows an expired claim as EXPIRED, and the notes of a decision to Ops', async () => {
      const stale = await claim();
      await t
        .db()
        .query('UPDATE lab_claim_request SET created_at = $2 WHERE id = $1', [
          stale.claimId,
          new Date(t.clock.now().getTime() - 25 * 60 * 60 * 1000),
        ]);
      const ops = await opsToken();
      expect((await opsOne(ops, stale.claimId)).body).toMatchObject({ status: 'EXPIRED' });
      expect(await rowOf(stale.claimId)).toEqual({ status: 'PENDING_OTP', lock_version: 0 });
      const approved = await claim({ verified: true });
      await approve(ops, approved.claimId, '"1"', { decisionNotes: 'INTERNAL remark' });
      expect((await opsOne(ops, approved.claimId)).body).toMatchObject({
        status: 'APPROVED',
        decisionNotes: 'INTERNAL remark',
      });
    });
  });
});
