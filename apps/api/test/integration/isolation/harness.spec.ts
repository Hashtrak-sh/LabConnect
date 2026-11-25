// The tenant-isolation harness on test-only routes backed by real tenant tables (P3-05): two
// customers, two labs with two sites each, the platform team, a user in two organisations and a
// Maker assigned to one site. Real sign-in, real memberships, row-level security on. The routes
// are test/support/fixtures/isolation-fixtures.ts; they are built the way a real endpoint is
// (TenantScope + repository), so a real endpoint's isolation test has the same shape as these.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { IsolationFixtureModule } from '../../support/fixtures/isolation-fixtures.js';
import { useIdentityApp } from '../../support/identity-app.js';
import {
  expectIsolated,
  expectListExcludes,
  expectNoLeak,
  expectOwnVisible,
} from '../../support/isolation/kit.js';
import {
  buildWorld,
  type Client,
  clientFactory,
  type Tenant,
  type World,
} from '../../support/isolation/world.js';

const ids = (body: unknown): string[] => (body as { ids: string[] }).ids;

describe('tenant isolation on repository-backed routes', () => {
  const t = useIdentityApp({ imports: [IsolationFixtureModule] });
  const clientOf = clientFactory(t);
  let w: World;
  let admin: Client; // customer A admin
  let labChecker: Client; // lab A checker (all sites)

  beforeAll(async () => {
    w = await buildWorld(t);
    admin = clientOf(w.customerA.user('CUSTOMER_ADMIN'));
    labChecker = clientOf(w.labA.user('LAB_CHECKER'));
  });

  describe('members/:id (MembershipRepository)', () => {
    const memberOfB = () => w.customerB.user('CUSTOMER_ADMIN').membershipId;

    it("404 for another customer's membership, the same answer as for an id that does not exist", async () => {
      await expectIsolated({
        route: 'GET /v1/fx-iso/members/:id',
        as: admin,
        resourceOf: w.customerB,
        resourceId: memberOfB(),
        request: (c) => c.get(`/v1/fx-iso/members/${memberOfB()}`),
        unknownRequest: (c) => c.get(`/v1/fx-iso/members/${randomUUID()}`),
      });
    });

    it('404 across tenant kinds in every direction', async () => {
      const pairs: [Client, Tenant, string][] = [
        [admin, w.labB, w.labB.user('LAB_CHECKER').membershipId],
        [labChecker, w.customerB, memberOfB()],
        [labChecker, w.labB, w.labB.user('LAB_CHECKER').membershipId],
        [admin, w.platform, w.platform.user('PLATFORM_OPS').membershipId],
        [labChecker, w.platform, w.platform.user('PLATFORM_ADMIN').membershipId],
      ];
      for (const [as, resourceOf, id] of pairs) {
        await expectIsolated({
          route: 'GET /v1/fx-iso/members/:id',
          as,
          resourceOf,
          resourceId: id,
          request: (c) => c.get(`/v1/fx-iso/members/${id}`),
        });
      }
    });

    it('404 for an id that is not a UUID, never a database error', async () => {
      const response = await admin.get('/v1/fx-iso/members/not-a-uuid');
      expect(response.status).toBe(404);
    });

    it('200 for its own tenant', async () => {
      const own = w.customerA.user('CUSTOMER_REQUESTER').membershipId;
      await expectOwnVisible({
        route: 'GET /v1/fx-iso/members/:id',
        as: admin,
        request: (c) => c.get(`/v1/fx-iso/members/${own}`),
        expectBody: (body) => {
          expect(body).toMatchObject({ id: own });
        },
      });
    });

    it('lists only the memberships of its own organisation', async () => {
      const own = [
        ...w.customerA.users.map((user) => user.membershipId),
        w.dual.inA.membershipId, // the consultant's membership in A
      ];
      await expectListExcludes({
        as: admin,
        resourceOf: w.customerB,
        request: (c) => c.get('/v1/fx-iso/members'),
        extract: ids,
        expectOwn: own,
      });
      const listed = await admin.get('/v1/fx-iso/members');
      expect(ids(listed.body)).not.toContain(w.dual.inB.membershipId);
    });
  });

  describe('a client-supplied organisation id is never an authority', () => {
    it('in the query string and in a header, the list is the actor organisation anyway', async () => {
      const own = [...w.customerA.users.map((user) => user.membershipId), w.dual.inA.membershipId];
      const foreign = w.customerB.organisationId;
      for (const [label, request] of [
        ['query', (c: Client) => c.get(`/v1/fx-iso/members?orgId=${foreign}`)],
        [
          'header',
          (c: Client) => c.get('/v1/fx-iso/members', { headers: { 'X-Org-Id': foreign } }),
        ],
      ] as const) {
        const ids_ = await expectListExcludes({
          as: admin,
          resourceOf: w.customerB,
          request,
          extract: ids,
          expectOwn: own,
          sent: [foreign],
        });
        expect(ids_.length, label).toBe(own.length);
      }
      // The handler did receive B's id (it echoes what it was sent) and still got nothing of B.
      const echoed = await admin.get(`/v1/fx-iso/members?orgId=${foreign}`);
      expect((echoed.body as { asked: unknown[] }).asked).toContain(foreign);
    });

    it('in a header that names the foreign organisation membership: 404, not a switch', async () => {
      await expectIsolated({
        route: 'GET /v1/fx-iso/members/:id',
        as: admin,
        resourceOf: w.customerB,
        resourceId: w.customerB.user('CUSTOMER_ADMIN').membershipId,
        request: (c) =>
          c
            .asMembership(w.customerB.user('CUSTOMER_ADMIN').membershipId)
            .get(`/v1/fx-iso/members/${w.customerA.user('CUSTOMER_ADMIN').membershipId}`),
      });
    });
  });

  describe('customer-sites/:id (a customer-owned table)', () => {
    const siteOfB = () => w.customerB.siteIds[0] ?? '';

    it("404 for another customer's site, 200 for its own, and the list holds only its own", async () => {
      await expectIsolated({
        route: 'GET /v1/fx-iso/customer-sites/:id',
        as: admin,
        resourceOf: w.customerB,
        resourceId: siteOfB(),
        request: (c) => c.get(`/v1/fx-iso/customer-sites/${siteOfB()}`),
        unknownRequest: (c) => c.get(`/v1/fx-iso/customer-sites/${randomUUID()}`),
      });
      const ownSite = w.customerA.siteIds[0] ?? '';
      await expectOwnVisible({
        route: 'GET /v1/fx-iso/customer-sites/:id',
        as: admin,
        request: (c) => c.get(`/v1/fx-iso/customer-sites/${ownSite}`),
        expectBody: (body) => {
          expect(body).toMatchObject({ id: ownSite });
        },
      });
      await expectListExcludes({
        as: admin,
        resourceOf: w.customerB,
        request: (c) => c.get('/v1/fx-iso/customer-sites'),
        extract: ids,
        expectOwn: [ownSite],
      });
    });

    it('a lab or platform user finds no customer sites by id: the repository keeps to its own organisation', async () => {
      const labUser = labChecker;
      await expectIsolated({
        route: 'GET /v1/fx-iso/customer-sites/:id',
        as: labUser,
        resourceOf: w.customerB,
        resourceId: siteOfB(),
        request: (c) => c.get(`/v1/fx-iso/customer-sites/${siteOfB()}`),
      });
    });
  });

  describe('lab-sites/:id (public to RLS, kept apart by the repository and the site scope)', () => {
    const siteA1 = () => w.labA.siteIds[0] ?? '';
    const siteA2 = () => w.labA.siteIds[1] ?? '';
    const siteOfLabB = () => w.labB.siteIds[0] ?? '';

    it("404 for another lab's site even though row-level security would show it", async () => {
      await expectIsolated({
        route: 'GET /v1/fx-iso/lab-sites/:id',
        as: labChecker,
        resourceOf: w.labB,
        resourceId: siteOfLabB(),
        request: (c) => c.get(`/v1/fx-iso/lab-sites/${siteOfLabB()}`),
        unknownRequest: (c) => c.get(`/v1/fx-iso/lab-sites/${randomUUID()}`),
      });
      await expectListExcludes({
        as: labChecker,
        resourceOf: w.labB,
        request: (c) => c.get('/v1/fx-iso/lab-sites'),
        extract: ids,
        expectOwn: [...w.labA.siteIds],
      });
    });

    it('a Maker assigned to one site sees that site only (rule 4): the other site of the same lab is 404', async () => {
      const siteMaker = clientOf(w.siteMaker);
      await expectOwnVisible({
        route: 'GET /v1/fx-iso/lab-sites/:id',
        as: siteMaker,
        request: (c) => c.get(`/v1/fx-iso/lab-sites/${siteA1()}`),
      });
      const refused = await siteMaker.get(`/v1/fx-iso/lab-sites/${siteA2()}`);
      expect(refused.status).toBe(404);
      expect(refused.body).toMatchObject({ code: 'NOT_FOUND' });
      const listed = await siteMaker.get('/v1/fx-iso/lab-sites');
      expect(ids(listed.body)).toEqual([siteA1()]);
      // The same lab, another user assigned to every site, still sees both.
      expect((await labChecker.get(`/v1/fx-iso/lab-sites/${siteA2()}`)).status).toBe(200);
    });
  });

  describe('a user with memberships in both organisations', () => {
    const consultant = () => clientOf(w.dual.inA);
    const siteA = () => w.customerA.siteIds[0] ?? '';
    const siteB = () => w.customerB.siteIds[0] ?? '';

    it('sees only the organisation of the active membership, and switching switches the data', async () => {
      const asDefault = await consultant().get('/v1/fx-iso/customer-sites');
      expect(ids(asDefault.body)).toEqual([siteA()]);
      const asB = await consultant()
        .asMembership(w.dual.inB.membershipId)
        .get('/v1/fx-iso/customer-sites');
      expect(ids(asB.body)).toEqual([siteB()]);
      expect(ids((await consultant().get('/v1/fx-iso/customer-sites')).body)).toEqual([siteA()]);
    });

    it("the other organisation's site is 404 while it is not the active one, 200 once it is", async () => {
      await expectIsolated({
        route: 'GET /v1/fx-iso/customer-sites/:id',
        as: consultant(),
        resourceOf: w.customerB,
        resourceId: siteB(),
        request: (c) => c.get(`/v1/fx-iso/customer-sites/${siteB()}`),
      });
      const active = await consultant()
        .asMembership(w.dual.inB.membershipId)
        .get(`/v1/fx-iso/customer-sites/${siteB()}`);
      expect(active.status).toBe(200);
      // And now A's site is the foreign one.
      const foreign = await consultant()
        .asMembership(w.dual.inB.membershipId)
        .get(`/v1/fx-iso/customer-sites/${siteA()}`);
      expect(foreign.status).toBe(404);
      expectNoLeak(foreign, w.customerA, [siteA()]);
    });
  });

  describe('platform staff (TENANT_ISOLATION rule 6 and the as-built notes)', () => {
    const ops = () => clientOf(w.platform.user('PLATFORM_OPS'));

    it('through a repository the platform sees its own organisation only: other tenants are 404, the list is the platform team', async () => {
      await expectIsolated({
        route: 'GET /v1/fx-iso/members/:id',
        as: ops(),
        resourceOf: w.customerA,
        resourceId: w.customerA.user('CUSTOMER_ADMIN').membershipId,
        request: (c) =>
          c.get(`/v1/fx-iso/members/${w.customerA.user('CUSTOMER_ADMIN').membershipId}`),
      });
      await expectListExcludes({
        as: ops(),
        resourceOf: w.customerA,
        request: (c) => c.get('/v1/fx-iso/members'),
        extract: ids,
        expectOwn: w.platform.users.map((user) => user.membershipId),
      });
    });

    it('through a deliberate raw read the platform context sees every tenant; a tenant sees only itself (OQ-111)', async () => {
      const platformWide = await ops().get('/v1/fx-iso/platform-wide/customer-sites');
      expect((platformWide.body as { organisationIds: string[] }).organisationIds).toEqual(
        expect.arrayContaining([w.customerA.organisationId, w.customerB.organisationId]),
      );
      const tenantWide = await admin.get('/v1/fx-iso/platform-wide/customer-sites');
      expect((tenantWide.body as { organisationIds: string[] }).organisationIds).toEqual([
        w.customerA.organisationId,
      ]);
    });

    it('platform roles still need the permission: Finance does not hold org_user.manage', async () => {
      const finance = clientOf(w.platform.user('PLATFORM_FINANCE'));
      const response = await finance.get('/v1/fx-iso/members');
      expect(response.status).toBe(403);
    });
  });
});
