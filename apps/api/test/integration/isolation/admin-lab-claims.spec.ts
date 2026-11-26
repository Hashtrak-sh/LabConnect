// Isolation of the Ops claim routes (I2-ADM-01 to I2-ADM-03). They are platform-only: a lab user or a
// customer user is refused by the permission guard with 403 FORBIDDEN before any lookup, so a claim
// that exists and one that does not give the same answer, and nothing of the claim, its organisation,
// its site, its claimant or its letterhead shows in any answer. One organisation's Checker learns
// nothing about another organisation's claims, and a claimant learns nothing about other claims.
import { randomUUID } from 'node:crypto';
import { FixedClock, type FilesConfig, InMemoryObjectStorage } from '@labconnect/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { FILES_CONFIG, OBJECT_STORAGE } from '../../../src/modules/files/files.module.js';
import { useClaimLabs } from '../../support/claim-labs.js';
import { START, useIdentityApp } from '../../support/identity-app.js';
import { expectIsolated, expectNoLeak } from '../../support/isolation/kit.js';
import { type Client, clientFactory, type Tenant } from '../../support/isolation/world.js';
import { claimRoleUsers, type ClaimRoleUsers } from '../../support/claim-roles.js';

describe('tenant isolation on the Ops claim routes', () => {
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

  let world: ClaimRoleUsers;
  let claimId: string;
  let claimantEmail: string;
  let claimed: Awaited<ReturnType<typeof makeLab>>;
  let resource: Tenant;
  let ops: Client;

  beforeAll(async () => {
    world = await claimRoleUsers(t, makeLab);
    ops = clientOf(world.byRole('PLATFORM_OPS'));
    claimed = await makeLab({ email: 'isolated.review.head@review-isolation.example.test' });
    claimantEmail = t.newEmail('claimant');
    const claimant = await t.signIn(claimantEmail);
    const started = await t.api.post('/v1/lab/claims', {
      token: claimant.accessToken,
      body: { certificateNo: claimed.certificateNo },
    });
    claimId = (started.body as { id: string }).id;
    const code = t.mailer.lastClaimCodeFor(claimed.email?.toLowerCase() ?? '') ?? '';
    const verified = await t.api.post(`/v1/lab/claims/${claimId}/verify-otp`, {
      token: claimant.accessToken,
      body: { code },
      headers: { 'If-Match': '"0"' },
    });
    expect(verified.status).toBe(200);
    const name = await t
      .db()
      .query<{ display_name: string }>('SELECT display_name FROM organisation WHERE id = $1', [
        claimed.organisationId,
      ]);
    const claimantId = (
      await t
        .db()
        .query<{ id: string }>('SELECT id FROM app_user WHERE email = $1', [
          claimantEmail.toLowerCase(),
        ])
    ).rows[0]?.id;
    // What identifies the claim, its organisation, its site and its claimant: none of it may show.
    resource = {
      label: 'the claimed lab',
      orgType: 'LAB',
      organisationId: claimed.organisationId,
      displayName: name.rows[0]?.display_name ?? '',
      users: [],
      siteIds: [claimed.siteId],
      user: () => {
        throw new Error('the claimed lab has no user yet');
      },
      markers: () =>
        [
          claimed.organisationId,
          name.rows[0]?.display_name ?? '',
          claimed.siteId,
          claimed.siteCode,
          claimed.siteName,
          claimed.email ?? '',
          claimantEmail,
          claimantId ?? '',
        ].filter((value) => value !== ''),
    };
  });

  const approve = (id: string) => (client: Client) =>
    client.post(`/v1/admin/claims/${id}/approve`, { body: {}, headers: { 'If-Match': '"1"' } });
  const reject = (id: string) => (client: Client) =>
    client.post(`/v1/admin/claims/${id}/reject`, {
      body: { decisionNotes: 'No.' },
      headers: { 'If-Match': '"1"' },
    });
  const stateOfClaim = async () =>
    (
      await t
        .db()
        .query<{ status: string; lock_version: number }>(
          'SELECT status, lock_version FROM lab_claim_request WHERE id = $1',
          [claimId],
        )
    ).rows[0];

  const tenantClients = (): Client[] => [
    clientOf(world.byRole('LAB_CHECKER')),
    clientOf(world.otherLabChecker),
    clientOf(world.byRole('LAB_MAKER')),
    clientOf(world.byRole('CUSTOMER_ADMIN')),
    clientOf(world.byRole('CUSTOMER_FINANCE')),
  ];

  it('POST /admin/claims/{id}/approve: a lab or customer user is refused with 403, the same answer as for an unknown claim, and nothing changes', async () => {
    for (const as of tenantClients()) {
      await expectIsolated({
        route: 'POST /v1/admin/claims/:id/approve',
        as,
        resourceOf: resource,
        resourceId: claimId,
        request: approve(claimId),
        unknownRequest: approve(randomUUID()),
        refusal: 'FORBIDDEN',
      });
    }
    expect(await stateOfClaim()).toEqual({ status: 'PENDING_REVIEW', lock_version: 1 });
    const members = await t
      .db()
      .query('SELECT 1 FROM membership WHERE organisation_id = $1', [claimed.organisationId]);
    expect(members.rowCount).toBe(0);
  });

  it('POST /admin/claims/{id}/reject: a lab or customer user is refused with 403, the same answer as for an unknown claim, and nothing changes', async () => {
    for (const as of tenantClients()) {
      await expectIsolated({
        route: 'POST /v1/admin/claims/:id/reject',
        as,
        resourceOf: resource,
        resourceId: claimId,
        request: reject(claimId),
        unknownRequest: reject(randomUUID()),
        refusal: 'FORBIDDEN',
      });
    }
    expect(await stateOfClaim()).toEqual({ status: 'PENDING_REVIEW', lock_version: 1 });
  });

  it('GET /admin/claims: a lab or customer user is refused with 403 and sees none of the claims', async () => {
    for (const as of tenantClients()) {
      const response = await as.get('/v1/admin/claims');
      expect(response.status, as.user.role).toBe(403);
      expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
      expectNoLeak(response, resource, [claimId]);
      expect(response.text).not.toContain(claimId);
      const filtered = await as.get('/v1/admin/claims?status=PENDING_REVIEW&limit=100');
      expect(filtered.status).toBe(403);
      expectNoLeak(filtered, resource, []);
    }
  });

  it('shows the claimant nothing of the review either: the claimant cannot list or decide, and learns nothing', async () => {
    const claimant = await t.signIn(claimantEmail);
    for (const response of [
      await t.api.get('/v1/admin/claims', { token: claimant.accessToken }),
      await t.api.post(`/v1/admin/claims/${claimId}/approve`, {
        token: claimant.accessToken,
        body: {},
        headers: { 'If-Match': '"1"' },
      }),
    ]) {
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(await stateOfClaim()).toEqual({ status: 'PENDING_REVIEW', lock_version: 1 });
  });

  it("after an approval, the new Checker of one organisation still sees none of another organisation's claims", async () => {
    // A second claim, for another lab, stays in review while the first is approved.
    const other = await makeLab({ email: 'other.review.head@review-isolation.example.test' });
    const otherEmail = t.newEmail('other-claimant');
    const otherUser = await t.signIn(otherEmail);
    const started = await t.api.post('/v1/lab/claims', {
      token: otherUser.accessToken,
      body: { certificateNo: other.certificateNo },
    });
    const otherClaimId = (started.body as { id: string }).id;
    const code = t.mailer.lastClaimCodeFor(other.email?.toLowerCase() ?? '') ?? '';
    await t.api.post(`/v1/lab/claims/${otherClaimId}/verify-otp`, {
      token: otherUser.accessToken,
      body: { code },
      headers: { 'If-Match': '"0"' },
    });

    const approved = await approve(claimId)(ops);
    expect(approved.status).toBe(200);
    // The new Checker (MFA through sign-in) is a lab user: the admin routes are not theirs.
    const checker = await t.signInWithMfa(claimantEmail);
    const otherResource: Tenant = {
      ...resource,
      label: 'the other claimed lab',
      organisationId: other.organisationId,
      siteIds: [other.siteId],
      markers: () => [
        other.organisationId,
        other.siteId,
        other.siteCode,
        other.email ?? '',
        otherEmail,
      ],
    };
    for (const response of [
      await t.api.get('/v1/admin/claims', { token: checker.accessToken }),
      await t.api.post(`/v1/admin/claims/${otherClaimId}/approve`, {
        token: checker.accessToken,
        body: {},
        headers: { 'If-Match': '"1"' },
      }),
      await t.api.post(`/v1/admin/claims/${otherClaimId}/reject`, {
        token: checker.accessToken,
        body: { decisionNotes: 'No.' },
        headers: { 'If-Match': '"1"' },
      }),
    ]) {
      expect(response.status).toBe(403);
      expectNoLeak(response, otherResource, [otherClaimId]);
    }
    const row = await t
      .db()
      .query<{ status: string }>('SELECT status FROM lab_claim_request WHERE id = $1', [
        otherClaimId,
      ]);
    expect(row.rows[0]?.status).toBe('PENDING_REVIEW');
  });
});
