// Negative control of the isolation kit (P3-05): the same kit against a route that drops its
// organisation predicate and runs under the system context (FixtureLeakyController). The kit must
// fail on it, for a read by id and for a list. If these ever pass, the kit has stopped checking.
import { beforeAll, describe, expect, it } from 'vitest';
import { IsolationFixtureModule } from '../../support/fixtures/isolation-fixtures.js';
import { useIdentityApp } from '../../support/identity-app.js';
import { expectIsolated, expectListExcludes } from '../../support/isolation/kit.js';
import {
  buildWorld,
  type Client,
  clientFactory,
  type World,
} from '../../support/isolation/world.js';

describe('the isolation kit rejects a route that leaks', () => {
  const t = useIdentityApp({ imports: [IsolationFixtureModule] });
  const clientOf = clientFactory(t);
  let w: World;
  let admin: Client;

  beforeAll(async () => {
    w = await buildWorld(t);
    admin = clientOf(w.customerA.user('CUSTOMER_ADMIN'));
  });

  it('really leaks: the leaky route returns the other tenant membership with a 200', async () => {
    const victim = w.customerB.user('CUSTOMER_ADMIN');
    const response = await admin.get(`/v1/fx-iso-leaky/members/${victim.membershipId}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ userId: victim.id });
  });

  it('expectIsolated fails on it', async () => {
    const victim = w.customerB.user('CUSTOMER_ADMIN');
    await expect(
      expectIsolated({
        route: 'GET /v1/fx-iso-leaky/members/:id',
        as: admin,
        resourceOf: w.customerB,
        resourceId: victim.membershipId,
        request: (c) => c.get(`/v1/fx-iso-leaky/members/${victim.membershipId}`),
      }),
    ).rejects.toThrow(/expected 200 to be 404/);
  });

  it('expectListExcludes fails on its list', async () => {
    await expect(
      expectListExcludes({
        as: admin,
        resourceOf: w.customerB,
        request: (c) => c.get('/v1/fx-iso-leaky/members'),
        extract: (body) => (body as { ids: string[] }).ids,
      }),
    ).rejects.toThrow(/rows of customer B/);
  });

  it('the registered route of the correct endpoint is the one the kit accepts', async () => {
    // The kit refuses a route that is not in the registry, so a test cannot invent its own case.
    await expect(
      expectIsolated({
        route: 'GET /v1/not-registered/:id',
        as: admin,
        resourceOf: w.customerB,
        request: (c) =>
          c.get('/v1/fx-iso/members/' + w.customerB.user('CUSTOMER_ADMIN').membershipId),
      }),
    ).rejects.toThrow(/is not in test\/isolation\/registry\.ts/);
  });
});
