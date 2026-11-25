// Guards, CurrentActor and TenantScope against a real database, as the app_rw role under
// row-level security (P3-04). Requests carry real access tokens from the real sign-in flow. The
// routes are test-only controllers (test/support/guard-probe.ts); the real app gains no route.
import { createCustomer, createPlatformTeam } from '@labconnect/database/test-utils';
import { describe, expect, it } from 'vitest';
import { GuardProbeModule, type ActorSummary } from '../support/guard-probe.js';
import { useIdentityApp } from '../support/identity-app.js';

describe('authorisation over HTTP on a real database', () => {
  const t = useIdentityApp({ imports: [GuardProbeModule] });

  /** A fresh customer organisation with its admin, requester and finance user. */
  const newCustomer = async () => {
    const customer = await t.owner((tx) => createCustomer(tx));
    return {
      organisationId: customer.organisationId,
      admin: await t.personOf(customer.admin),
      requester: await t.personOf(customer.requester ?? ''),
      finance: await t.personOf(customer.finance ?? ''),
    };
  };
  const bearer = (token: string, headers: Record<string, string> = {}) => ({
    token,
    headers,
  });
  const actorOf = (response: { body: unknown }) => response.body as ActorSummary;
  const membershipOf = async (userId: string, organisationId: string): Promise<string> => {
    const row = await t
      .db()
      .query<{ id: string }>(
        'SELECT id FROM membership WHERE user_id = $1 AND organisation_id = $2',
        [userId, organisationId],
      );
    return row.rows[0]?.id ?? '';
  };

  describe('the actor comes from the database', () => {
    it('builds the actor of a customer admin from the real membership and roles', async () => {
      const c = await newCustomer();
      const { accessToken } = await t.signIn(c.admin.email);
      const response = await t.probe.get('/v1/guard-probe/class-level', bearer(accessToken));
      expect(response.status).toBe(200);
      expect(actorOf(response)).toMatchObject({
        userId: c.admin.id,
        orgId: c.organisationId,
        orgType: 'CUSTOMER',
        roles: ['CUSTOMER_ADMIN'],
        isPlatform: false,
      });
    });

    it('403 for a role without the permission, 200 for one with it', async () => {
      const c = await newCustomer();
      const admin = await t.signIn(c.admin.email);
      const requester = await t.signIn(c.requester.email);
      // Customers do not decide on bookings, and do not see the lab inbox.
      expect((await t.probe.get('/v1/guard-probe/decide', bearer(admin.accessToken))).status).toBe(
        403,
      );
      expect(
        (await t.probe.get('/v1/guard-probe/decide', bearer(requester.accessToken))).status,
      ).toBe(403);
      // Only an admin manages organisation users.
      expect((await t.probe.get('/v1/scope-probe/members', bearer(admin.accessToken))).status).toBe(
        200,
      );
      expect(
        (await t.probe.get('/v1/scope-probe/members', bearer(requester.accessToken))).status,
      ).toBe(403);
    });

    it('401 without a token', async () => {
      expect((await t.probe.get('/v1/guard-probe/class-level')).status).toBe(401);
    });

    it('gives a user with no membership an actor with no organisation: open routes yes, permissions no', async () => {
      const { accessToken } = await t.signIn(t.newEmail('nomembership'));
      const open = await t.probe.get('/v1/guard-probe/open', bearer(accessToken));
      expect(open.status).toBe(200);
      expect(actorOf(open)).toMatchObject({ orgId: null, membershipId: null, permissionCount: 0 });
      expect((await t.probe.get('/v1/guard-probe/class-level', bearer(accessToken))).status).toBe(
        403,
      );
      expect((await t.probe.get('/v1/guard-probe/forgotten', bearer(accessToken))).status).toBe(
        403,
      );
      expect(
        (await t.probe.post('/v1/scope-probe/customer-sites', bearer(accessToken))).status,
      ).toBe(403);
    });
  });

  describe('revocation takes effect at once, with the same unexpired access token', () => {
    it('refuses a deactivated membership', async () => {
      const c = await newCustomer();
      const { accessToken } = await t.signIn(c.requester.email);
      expect((await t.probe.get('/v1/guard-probe/class-level', bearer(accessToken))).status).toBe(
        200,
      );
      await t
        .db()
        .query("UPDATE membership SET status = 'DEACTIVATED' WHERE user_id = $1", [c.requester.id]);
      const response = await t.probe.get('/v1/guard-probe/class-level', bearer(accessToken));
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
      // The token is still a valid session: only the membership is gone, so /me still answers.
      expect((await t.api.get('/v1/me', { token: accessToken })).status).toBe(200);
    });

    it('refuses a membership whose role was revoked', async () => {
      const c = await newCustomer();
      const { accessToken } = await t.signIn(c.requester.email);
      await t.db().query(
        `UPDATE membership_role SET revoked_at = now()
          WHERE membership_id IN (SELECT id FROM membership WHERE user_id = $1)`,
        [c.requester.id],
      );
      expect((await t.probe.get('/v1/guard-probe/class-level', bearer(accessToken))).status).toBe(
        403,
      );
    });

    it.each(['SUSPENDED', 'CLOSED'])(
      'refuses every member of an organisation that becomes %s',
      async (status) => {
        const c = await newCustomer();
        const admin = await t.signIn(c.admin.email);
        const requester = await t.signIn(c.requester.email);
        expect(
          (await t.probe.get('/v1/guard-probe/class-level', bearer(admin.accessToken))).status,
        ).toBe(200);
        await t
          .db()
          .query('UPDATE organisation SET status = $1::org_status WHERE id = $2', [
            status,
            c.organisationId,
          ]);
        for (const token of [admin.accessToken, requester.accessToken]) {
          const response = await t.probe.get('/v1/guard-probe/class-level', bearer(token));
          expect(response.status).toBe(403);
          expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
        }
        await t
          .db()
          .query("UPDATE organisation SET status = 'ACTIVE' WHERE id = $1", [c.organisationId]);
        expect(
          (await t.probe.get('/v1/guard-probe/class-level', bearer(admin.accessToken))).status,
        ).toBe(200);
      },
    );

    it('refuses a disabled user at AuthGuard, before any membership question', async () => {
      const c = await newCustomer();
      const { accessToken } = await t.signIn(c.requester.email);
      await t.db().query("UPDATE app_user SET status = 'DISABLED' WHERE id = $1", [c.requester.id]);
      expect((await t.probe.get('/v1/guard-probe/class-level', bearer(accessToken))).status).toBe(
        401,
      );
    });
  });

  describe('MFA-required roles', () => {
    it('a partial session (sign-in not finished) is refused on every protected route, also the open one', async () => {
      const c = await newCustomer();
      const first = await t.signIn(c.finance.email);
      expect(first.mfaRequired).toBe(true);
      for (const route of ['open', 'class-level', 'forgotten']) {
        const response = await t.probe.get(`/v1/guard-probe/${route}`, bearer(first.accessToken));
        expect(response.status, route).toBe(401);
        expect(response.body, route).toMatchObject({ code: 'UNAUTHENTICATED' });
      }
    });

    it('after MFA the same user is served', async () => {
      const c = await newCustomer();
      const { accessToken } = await t.signInWithMfa(c.finance.email);
      const response = await t.probe.get('/v1/guard-probe/class-level', bearer(accessToken));
      expect(response.status).toBe(200);
      expect(actorOf(response).roles).toEqual(['CUSTOMER_FINANCE']);
    });

    it('a role gained after sign-in cannot be used until MFA is done in the session: 401 STEP_UP_REQUIRED', async () => {
      const c = await newCustomer();
      // Requester: MFA optional, so the session is full without MFA.
      const { accessToken } = await t.signIn(c.requester.email);
      expect((await t.probe.get('/v1/guard-probe/class-level', bearer(accessToken))).status).toBe(
        200,
      );
      // The membership is then given a role that requires MFA (the session is not revoked here).
      await t.db().query(
        `INSERT INTO membership_role (id, membership_id, role)
         SELECT gen_random_uuid(), id, 'CUSTOMER_FINANCE' FROM membership WHERE user_id = $1`,
        [c.requester.id],
      );
      const refused = await t.probe.get('/v1/guard-probe/class-level', bearer(accessToken));
      expect(refused.status).toBe(401);
      expect(refused.body).toMatchObject({
        code: 'STEP_UP_REQUIRED',
        meta: { reason: 'MFA_REQUIRED_FOR_ROLE' },
      });
    });
  });

  describe('step-up MFA with a real session', () => {
    it('refund approval needs a fresh MFA: 401 STEP_UP_REQUIRED after 5 minutes, served again after a step-up', async () => {
      const team = await t.owner((tx) => createPlatformTeam(tx));
      const finance = await t.personOf(team.finance);
      const signedIn = await t.signInWithMfa(finance.email);
      const approve = (token: string) => t.probe.post('/v1/guard-probe/refund', bearer(token));
      expect((await approve(signedIn.accessToken)).status).toBe(200);

      t.clock.advance(6 * 60_000);
      const stale = await approve(signedIn.accessToken);
      expect(stale.status).toBe(401);
      expect(stale.body).toMatchObject({ code: 'STEP_UP_REQUIRED', meta: { maxAgeSeconds: 300 } });

      // The client answers with /auth/mfa/verify on its full session, then retries.
      const stepUp = await t.api.post('/v1/auth/mfa/verify', {
        token: signedIn.accessToken,
        body: { code: t.totpNow(signedIn.secret) },
      });
      expect(stepUp.status).toBe(200);
      const fresh = (stepUp.body as { accessToken: string }).accessToken;
      expect((await approve(fresh)).status).toBe(200);
    });
  });

  describe('platform staff', () => {
    it('runs as a platform actor and lists the platform organisation members only', async () => {
      const team = await t.owner((tx) => createPlatformTeam(tx));
      const customer = await newCustomer();
      const ops = await t.personOf(team.ops);
      const { accessToken } = await t.signInWithMfa(ops.email);
      const who = await t.probe.get('/v1/guard-probe/open', bearer(accessToken));
      expect(actorOf(who)).toMatchObject({
        isPlatform: true,
        orgType: 'PLATFORM',
        roles: ['PLATFORM_OPS'],
      });
      const members = await t.probe.get('/v1/scope-probe/members', bearer(accessToken));
      expect(members.status).toBe(200);
      const userIds = (members.body as { userIds: string[] }).userIds;
      expect(userIds).toEqual(expect.arrayContaining([team.ops, team.admin]));
      expect(userIds).not.toContain(customer.admin.id);
      // The platform sees every customer's sites through RLS, as a role-based reader.
      const sites = await t.probe.post('/v1/scope-probe/customer-sites', bearer(accessToken));
      expect((sites.body as { visibleOrgIds: string[] }).visibleOrgIds).toContain(
        customer.organisationId,
      );
    });
  });

  describe('tenant scope', () => {
    it('shows a member only the rows of their organisation', async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      const { accessToken } = await t.signIn(a.admin.email);
      const response = await t.probe.post('/v1/scope-probe/customer-sites', bearer(accessToken));
      expect(response.status).toBe(200);
      expect((response.body as { visibleOrgIds: string[] }).visibleOrgIds).toEqual([
        a.organisationId,
      ]);
      expect((response.body as { visibleOrgIds: string[] }).visibleOrgIds).not.toContain(
        b.organisationId,
      );
    });

    it('a client-supplied organisation id (body, query, header) never changes the scope', async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      const { accessToken } = await t.signIn(a.admin.email);
      for (const [label, extra, path] of [
        ['body', { body: { orgId: b.organisationId } }, '/v1/scope-probe/customer-sites'],
        ['query', {}, `/v1/scope-probe/customer-sites?orgId=${b.organisationId}`],
        ['header', { headers: { 'X-Org-Id': b.organisationId } }, '/v1/scope-probe/customer-sites'],
      ] as const) {
        const response = await t.probe.post(path, { token: accessToken, ...extra });
        expect(response.status, label).toBe(200);
        const result = response.body as { visibleOrgIds: string[]; asked: (string | undefined)[] };
        // The handler received B's id, tried to use it, and got nothing from B.
        expect(result.asked, label).toContain(b.organisationId);
        expect(result.visibleOrgIds, label).toEqual([]);
      }
      // Asking for its own id works, which shows the filter reached the database.
      const own = await t.probe.post('/v1/scope-probe/customer-sites', {
        token: accessToken,
        body: { orgId: a.organisationId },
      });
      expect((own.body as { visibleOrgIds: string[] }).visibleOrgIds).toEqual([a.organisationId]);
    });

    it('a user in two organisations sees only the active one, and switching switches the data', async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      const consultant = await t.owner((tx) =>
        t.addMember(tx, a.requester.id, b.organisationId, 'CUSTOMER_REQUESTER'),
      );
      const inA = await membershipOf(a.requester.id, a.organisationId);
      expect(consultant).not.toBe(inA);
      const { accessToken } = await t.signIn(a.requester.email);
      const sites = async (headers: Record<string, string> = {}) =>
        (
          (await t.probe.post('/v1/scope-probe/customer-sites', bearer(accessToken, headers)))
            .body as { visibleOrgIds: string[] }
        ).visibleOrgIds;

      // The oldest membership is the session's: A.
      expect(await sites()).toEqual([a.organisationId]);
      // A request can choose B for itself with X-Active-Membership...
      expect(await sites({ 'X-Active-Membership': consultant })).toEqual([b.organisationId]);
      expect(await sites()).toEqual([a.organisationId]);
      // ...and the session can switch for good through the contract endpoint.
      const switched = await t.api.post('/v1/me/active-membership', {
        token: accessToken,
        body: { membershipId: consultant },
      });
      expect(switched.status).toBe(200);
      expect(await sites()).toEqual([b.organisationId]);
    });

    it("404 for an X-Active-Membership that is someone else's, never a switch", async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      const { accessToken } = await t.signIn(a.admin.email);
      const foreign = await membershipOf(b.admin.id, b.organisationId);
      const response = await t.probe.post(
        '/v1/scope-probe/customer-sites',
        bearer(accessToken, { 'X-Active-Membership': foreign }),
      );
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('repository through the scope', () => {
    it('lists the members of the actor organisation only', async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      const { accessToken } = await t.signIn(a.admin.email);
      const response = await t.probe.get('/v1/scope-probe/members', bearer(accessToken));
      expect(response.status).toBe(200);
      const userIds = (response.body as { userIds: string[] }).userIds;
      expect(userIds.sort()).toEqual([a.admin.id, a.requester.id, a.finance.id].sort());
      expect(userIds).not.toContain(b.admin.id);
    });

    it("404 for another tenant's membership asked for by id, 200 for its own", async () => {
      const a = await newCustomer();
      const b = await newCustomer();
      const { accessToken } = await t.signIn(a.admin.email);
      const foreign = await membershipOf(b.admin.id, b.organisationId);
      const own = await membershipOf(a.requester.id, a.organisationId);
      const refused = await t.probe.get(`/v1/scope-probe/members/${foreign}`, bearer(accessToken));
      expect(refused.status).toBe(404);
      expect(refused.body).toMatchObject({ code: 'NOT_FOUND' });
      const unknown = await t.probe.get(
        '/v1/scope-probe/members/0192f3c0-0000-7000-8000-00000000dead',
        bearer(accessToken),
      );
      expect(unknown.status).toBe(404);
      const found = await t.probe.get(`/v1/scope-probe/members/${own}`, bearer(accessToken));
      expect(found.status).toBe(200);
      expect(found.body).toEqual({ userId: a.requester.id });
      expect(
        (await t.probe.get('/v1/scope-probe/members/not-a-uuid', bearer(accessToken))).status,
      ).toBe(404);
    });
  });
});
