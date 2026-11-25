// Tenant isolation on the real `/me` family (P3-05): the routes the app serves today that take a
// membership id from the client (`X-Active-Membership`, `POST /me/active-membership`). They take
// no id in the path, so the coverage rule does not require these cases; they show the harness
// on real routes. The app is the real one (no fixture controllers).
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from '../../support/identity-app.js';
import { expectIsolated, expectNoLeak } from '../../support/isolation/kit.js';
import {
  buildWorld,
  type Client,
  clientFactory,
  type World,
} from '../../support/isolation/world.js';

describe('tenant isolation on /v1/me', () => {
  const t = useIdentityApp();
  const clientOf = clientFactory(t);
  let w: World;
  let admin: Client;

  beforeAll(async () => {
    w = await buildWorld(t);
    admin = clientOf(w.customerA.user('CUSTOMER_ADMIN'));
  });

  it("POST /me/active-membership with another tenant's membership: 404, the same answer as for an unknown id", async () => {
    const victim = w.customerB.user('CUSTOMER_ADMIN').membershipId;
    await expectIsolated({
      route: 'POST /v1/me/active-membership',
      as: admin,
      resourceOf: w.customerB,
      resourceId: victim,
      request: (c) => c.post('/v1/me/active-membership', { body: { membershipId: victim } }),
      unknownRequest: (c) =>
        c.post('/v1/me/active-membership', { body: { membershipId: randomUUID() } }),
    });
    // Nothing switched: the user still acts as A.
    const me = await admin.get('/v1/me');
    expect((me.body as { activeMembershipId: string }).activeMembershipId).toBe(
      w.customerA.user('CUSTOMER_ADMIN').membershipId,
    );
  });

  it("GET /me with X-Active-Membership of another tenant's user: 404", async () => {
    const victim = w.labB.user('LAB_CHECKER').membershipId;
    await expectIsolated({
      route: 'GET /v1/me',
      as: admin,
      resourceOf: w.labB,
      resourceId: victim,
      request: (c) => c.asMembership(victim).get('/v1/me'),
    });
  });

  it('GET /me shows the user their own memberships and nothing of any other tenant', async () => {
    const own = await admin.get('/v1/me');
    expect(own.status).toBe(200);
    for (const other of [w.customerB, w.labA, w.labB, w.platform]) expectNoLeak(own, other);
  });

  it('a user in two organisations sees both memberships, and choosing one changes the active organisation only', async () => {
    const consultant = clientOf(w.dual.inA);
    const me = await consultant.get('/v1/me');
    const memberships = (me.body as { memberships: { id: string }[] }).memberships.map((m) => m.id);
    expect(memberships.sort()).toEqual([w.dual.inA.membershipId, w.dual.inB.membershipId].sort());
    // Their own organisation B is theirs to see, but none of B's other users are.
    const others = w.customerB.users.flatMap((u) => [u.id, u.email, u.membershipId]);
    for (const value of others) expect(JSON.stringify(me.body)).not.toContain(value);
    const inB = await consultant.asMembership(w.dual.inB.membershipId).get('/v1/me');
    expect(inB.status).toBe(200);
    expect((inB.body as { activeMembershipId: string }).activeMembershipId).toBe(
      w.dual.inB.membershipId,
    );
  });
});
