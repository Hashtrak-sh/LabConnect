// Isolation of the lab claim routes (I1-LAB-02): a claim belongs to the user who started it, who
// belongs to no organisation yet, so the tenant kit's "another organisation" is here "another
// claimant". `verifyLabClaimOtp` takes the claim id in its path: another user's claim is
// `404 NOT_FOUND`, indistinguishable from an unknown id, even for a caller who holds the real code,
// and nothing of the claim, its organisation, its site or its address shows in any answer.
import { randomUUID } from 'node:crypto';
import { FixedClock, type FilesConfig, InMemoryObjectStorage } from '@labconnect/core';
import { withDbContext } from '@labconnect/database';
import { createUser } from '@labconnect/database/test-utils';
import { beforeAll, describe, expect, it } from 'vitest';
import { FILES_CONFIG, OBJECT_STORAGE } from '../../../src/modules/files/files.module.js';
import { useClaimLabs } from '../../support/claim-labs.js';
import { START, useIdentityApp } from '../../support/identity-app.js';
import { expectIsolated, expectNoLeak } from '../../support/isolation/kit.js';
import {
  type Client,
  clientFactory,
  type Tenant,
  type TenantUser,
} from '../../support/isolation/world.js';

describe('tenant isolation on the lab claim routes', () => {
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
  const clientOf = clientFactory(t);

  /** A signed-in user with no membership. The role is a placeholder: it picks "no MFA needed". */
  const claimant = async (label: string): Promise<Client> => {
    const email = t.newEmail(label);
    const id = await t.owner((tx) => createUser(tx, { email, fullName: `DEMO ${label}` }));
    const user: TenantUser = {
      id,
      email,
      role: 'CUSTOMER_REQUESTER',
      organisationId: '',
      membershipId: '',
    };
    return clientOf(user);
  };

  /** What identifies the claim of one user, as the tenant kit wants it. */
  const claimOf = (
    owner: Client,
    claimed: Awaited<ReturnType<typeof makeLab>>,
    displayName: string,
  ): Tenant => ({
    label: 'the claimant of the organisation',
    orgType: 'LAB',
    organisationId: claimed.organisationId,
    displayName,
    users: [owner.user],
    siteIds: [claimed.siteId],
    user: () => owner.user,
    markers: () =>
      [
        claimed.organisationId,
        displayName,
        owner.user.id,
        owner.user.email,
        claimed.siteId,
        claimed.siteCode,
        claimed.siteName,
        claimed.email ?? '',
      ].filter((value) => value !== ''),
  });

  let owner: Client;
  let stranger: Client;
  let claimed: Awaited<ReturnType<typeof makeLab>>;
  let claimId: string;
  let code: string;
  let resource: Tenant;

  beforeAll(async () => {
    owner = await claimant('owner');
    stranger = await claimant('stranger');
    claimed = await makeLab({ email: 'isolated.lab.head@claim-isolation.example.test' });
    const started = await owner.post('/v1/lab/claims', {
      body: { certificateNo: claimed.certificateNo },
    });
    expect(started.status).toBe(201);
    claimId = (started.body as { id: string }).id;
    code = t.mailer.lastClaimCodeFor(claimed.email?.toLowerCase() ?? '') ?? '';
    const name = await t
      .db()
      .query<{ display_name: string }>('SELECT display_name FROM organisation WHERE id = $1', [
        claimed.organisationId,
      ]);
    resource = claimOf(owner, claimed, name.rows[0]?.display_name ?? '');
  });

  const verify = (id: string, withCode: string) => (client: Client) =>
    client.post(`/v1/lab/claims/${id}/verify-otp`, {
      body: { code: withCode },
      headers: { 'If-Match': '"0"' },
    });
  const stateOfClaim = async () =>
    (
      await t.db().query<{
        status: string;
        lock_version: number;
        attempts: number;
        consumed_at: Date | null;
      }>(
        `SELECT c.status, c.lock_version, o.attempts, o.consumed_at
             FROM lab_claim_request c JOIN otp_challenge o ON o.context_id = c.id
            WHERE c.id = $1 ORDER BY o.created_at DESC LIMIT 1`,
        [claimId],
      )
    ).rows[0];

  it("POST /lab/claims/{id}/verify-otp with another user's claim: 404, the same answer as for an unknown id", async () => {
    await expectIsolated({
      route: 'POST /v1/lab/claims/:id/verify-otp',
      as: stranger,
      resourceOf: resource,
      resourceId: claimId,
      request: verify(claimId, '123456'),
      unknownRequest: verify(randomUUID(), '123456'),
    });
    expect(await stateOfClaim()).toMatchObject({ status: 'PENDING_OTP', attempts: 0 });
  });

  it("answers 404, not 403, to a caller who holds the real code of someone else's claim, and verifies nothing", async () => {
    const response = await verify(claimId, code)(stranger);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
    expectNoLeak(response, resource, [claimId]);
    expect(await stateOfClaim()).toMatchObject({
      status: 'PENDING_OTP',
      lock_version: 0,
      attempts: 0,
      consumed_at: null,
    });
  });

  it('shows another claimant nothing of the claim when they try to start one for the same lab', async () => {
    const response = await stranger.post('/v1/lab/claims', {
      body: { certificateNo: claimed.certificateNo },
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      meta: { currentState: 'CLAIM_PENDING' },
    });
    // The certificate number is the caller's own input (and public); everything else is the owner's.
    expectNoLeak(response, resource, [claimed.certificateNo]);
    expect(JSON.stringify(response.body)).not.toContain(claimId);
    expect(t.mailer.claimSent.filter((m) => m.to === claimed.email?.toLowerCase())).toHaveLength(1);
  });

  // The letterhead routes (I1-LAB-03, I1-LAB-04): the claim id and the file id are both in play.
  const PDF = { fileName: 'letterhead.pdf', contentType: 'application/pdf', sizeBytes: 5000 };
  const uploadUrl = (id: string) => (client: Client) =>
    client.post(`/v1/lab/claims/${id}/manual/upload-url`, { body: PDF });
  const submit = (id: string, fileId: string) => (client: Client) =>
    client.post(`/v1/lab/claims/${id}/manual`, {
      body: { fileId },
      headers: { 'If-Match': '"0"' },
    });
  const settleClean = (fileId: string) =>
    withDbContext(t.worker(), { kind: 'system' }, (tx) =>
      tx.fileObject.update({
        where: { id: fileId },
        data: {
          scanStatus: 'CLEAN',
          sha256: new Uint8Array(32).fill(3),
          detectedContentType: 'application/pdf',
        },
      }),
    );
  const filesOf = async (userId: string) =>
    (
      await t
        .db()
        .query<{ n: string }>(
          'SELECT count(*) AS n FROM file_object WHERE uploaded_by_user_id = $1',
          [userId],
        )
    ).rows[0]?.n;

  it("POST /lab/claims/{id}/manual/upload-url with another user's claim: 404, the same answer as for an unknown id, and no file", async () => {
    await expectIsolated({
      route: 'POST /v1/lab/claims/:id/manual/upload-url',
      as: stranger,
      resourceOf: resource,
      resourceId: claimId,
      request: uploadUrl(claimId),
      unknownRequest: uploadUrl(randomUUID()),
    });
    expect(await filesOf(stranger.user.id)).toBe('0');
    expect(await stateOfClaim()).toMatchObject({ status: 'PENDING_OTP', lock_version: 0 });
  });

  it("POST /lab/claims/{id}/manual with another user's claim: 404, even for a caller who holds the owner's clean file id", async () => {
    const upload = await uploadUrl(claimId)(owner);
    expect(upload.status).toBe(201);
    const fileId = (upload.body as { fileId: string }).fileId;
    await settleClean(fileId);
    await expectIsolated({
      route: 'POST /v1/lab/claims/:id/manual',
      as: stranger,
      resourceOf: resource,
      resourceId: claimId,
      request: submit(claimId, fileId),
      unknownRequest: submit(randomUUID(), fileId),
    });
    expect(await stateOfClaim()).toMatchObject({ status: 'PENDING_OTP', lock_version: 0 });
  });

  it("cannot attach the owner's file to the stranger's own claim, and the answer shows nothing of it", async () => {
    const otherLab = await makeLab();
    const started = await stranger.post('/v1/lab/claims', {
      body: { certificateNo: otherLab.certificateNo },
    });
    expect(started.status).toBe(201);
    const strangerClaim = (started.body as { id: string }).id;
    const ownerUpload = await uploadUrl(claimId)(owner);
    const ownerFile = (ownerUpload.body as { fileId: string }).fileId;
    await settleClean(ownerFile);
    const unknown = await submit(strangerClaim, randomUUID())(stranger);
    const attached = await submit(strangerClaim, ownerFile)(stranger);
    expect(attached.status).toBe(404);
    expect(attached.body).toMatchObject({ code: 'NOT_FOUND' });
    expect({ ...(attached.body as object), requestId: '' }).toEqual({
      ...(unknown.body as object),
      requestId: '',
    });
    expectNoLeak(attached, resource, [claimId]);
    const row = await t
      .db()
      .query<{ authorisation_file_id: string | null; status: string }>(
        'SELECT authorisation_file_id, status FROM lab_claim_request WHERE id = $1',
        [strangerClaim],
      );
    expect(row.rows[0]).toEqual({ authorisation_file_id: null, status: 'PENDING_OTP' });
  });

  // I1-LAB-06: the limits belong to the person and the claim. Nothing a second user does can expire,
  // count against or use up the upload allowance of the first user's fresh claim.
  it("keeps a second user from expiring, counting against or using the uploads of the first user's fresh claim", async () => {
    const mine = await claimant('limits-owner');
    const theirs = await claimant('limits-stranger');
    const lab = await makeLab({ email: 'limits.owner.head@limits-isolation.example.test' });
    const started = await mine.post('/v1/lab/claims', {
      body: { certificateNo: lab.certificateNo },
    });
    expect(started.status).toBe(201);
    const id = (started.body as { id: string }).id;
    const name = await t
      .db()
      .query<{ display_name: string }>('SELECT display_name FROM organisation WHERE id = $1', [
        lab.organisationId,
      ]);
    const resourceOfMine = claimOf(mine, lab, name.rows[0]?.display_name ?? '');
    for (let i = 0; i < 2; i++) expect((await uploadUrl(id)(mine)).status).toBe(201);

    // The second user hammers the first user's claim and lab.
    for (let i = 0; i < 4; i++) {
      const again = await theirs.post('/v1/lab/claims', {
        body: { certificateNo: lab.certificateNo },
      });
      expect(again.status).toBe(409);
      expectNoLeak(again, resourceOfMine, [lab.certificateNo]);
    }
    for (let i = 0; i < 7; i++) {
      const refused = await uploadUrl(id)(theirs);
      expect(refused.status).toBe(404);
      expectNoLeak(refused, resourceOfMine, [id]);
    }
    expect((await verify(id, '123456')(theirs)).status).toBe(404);
    // The second user fills their own three places and is refused the fourth: their own limit only.
    for (let i = 0; i < 3; i++) {
      const other = await makeLab();
      expect(
        (await theirs.post('/v1/lab/claims', { body: { certificateNo: other.certificateNo } }))
          .status,
      ).toBe(201);
    }
    const spare = await makeLab();
    const capped = await theirs.post('/v1/lab/claims', {
      body: { certificateNo: spare.certificateNo },
    });
    expect(capped.status).toBe(429);
    expectNoLeak(capped, resourceOfMine, []);

    // The first user's claim is untouched: still open, never expired, no expiry in the audit log.
    const row = await t
      .db()
      .query<{ status: string; lock_version: number }>(
        'SELECT status, lock_version FROM lab_claim_request WHERE id = $1',
        [id],
      );
    expect(row.rows[0]).toEqual({ status: 'PENDING_OTP', lock_version: 0 });
    const expiries = await t
      .db()
      .query("SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = 'lab_claim.expire'", [id]);
    expect(expiries.rowCount).toBe(0);
    // Their requests used none of the first user's five places: three more are left, then the limit.
    for (let i = 0; i < 3; i++) expect((await uploadUrl(id)(mine)).status).toBe(201);
    expect((await uploadUrl(id)(mine)).status).toBe(429);
    // And the first user's cap is their own: the second user's claims do not count against it.
    const next = await makeLab();
    expect(
      (await mine.post('/v1/lab/claims', { body: { certificateNo: next.certificateNo } })).status,
    ).toBe(201);
  });

  it('keeps the claim working for its owner after all of that', async () => {
    const response = await verify(claimId, code)(owner);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: claimId, status: 'PENDING_REVIEW' });
  });

  it("keeps an owner of one claim from touching another of their own users' claims by id", async () => {
    // A second claim by the stranger on another lab: the owner of the first cannot reach it.
    const otherLab = await makeLab();
    const started = await stranger.post('/v1/lab/claims', {
      body: { certificateNo: otherLab.certificateNo },
    });
    expect(started.status).toBe(201);
    const otherId = (started.body as { id: string }).id;
    const response = await verify(otherId, '123456')(owner);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
