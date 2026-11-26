// Isolation of the lab claim routes (I1-LAB-02): a claim belongs to the user who started it, who
// belongs to no organisation yet, so the tenant kit's "another organisation" is here "another
// claimant". `verifyLabClaimOtp` takes the claim id in its path: another user's claim is
// `404 NOT_FOUND`, indistinguishable from an unknown id, even for a caller who holds the real code,
// and nothing of the claim, its organisation, its site or its address shows in any answer.
import { randomUUID } from 'node:crypto';
import { createUser } from '@labconnect/database/test-utils';
import { beforeAll, describe, expect, it } from 'vitest';
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
  const t = useIdentityApp();
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
