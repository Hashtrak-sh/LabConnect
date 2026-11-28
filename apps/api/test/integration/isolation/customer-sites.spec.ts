// Tenant isolation of the customer site routes (I2-CUS-03): a site of another organisation is
// `404 NOT_FOUND`, the same answer as an unknown id, for reading and for changing it, and the list
// never shows another organisation's sites. A lab or platform membership is refused with 403.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from '../../support/identity-app.js';
import { expectIsolated, expectListExcludes, expectNoLeak } from '../../support/isolation/kit.js';
import {
  buildWorld,
  type Client,
  clientFactory,
  type World,
} from '../../support/isolation/world.js';

describe('tenant isolation on the customer site routes', () => {
  const t = useIdentityApp();
  const clientOf = clientFactory(t);
  let w: World;
  let adminA: Client;
  let requesterA: Client;
  let siteOfB: string;

  beforeAll(async () => {
    w = await buildWorld(t);
    adminA = clientOf(w.customerA.user('CUSTOMER_ADMIN'));
    requesterA = clientOf(w.customerA.user('CUSTOMER_REQUESTER'));
    siteOfB = w.customerB.siteIds[0] ?? '';
    expect(siteOfB).not.toBe('');
  });

  const lockOf = async (id: string) =>
    (
      await t
        .db()
        .query<{ lock_version: number; name: string }>(
          'SELECT lock_version, name FROM customer_site WHERE id = $1',
          [id],
        )
    ).rows[0];

  it("GET /customer/sites/{id} with another organisation's site: 404, like an unknown id", async () => {
    await expectIsolated({
      route: 'GET /v1/customer/sites/:id',
      as: requesterA,
      resourceOf: w.customerB,
      resourceId: siteOfB,
      request: (client) => client.get(`/v1/customer/sites/${siteOfB}`),
      unknownRequest: (client) => client.get(`/v1/customer/sites/${randomUUID()}`),
    });
  });

  it("PATCH /customer/sites/{id} with another organisation's site: 404, and nothing changes", async () => {
    const before = await lockOf(siteOfB);
    const rename = (id: string) => (client: Client) =>
      client.call('patch', `/v1/customer/sites/${id}`, {
        body: { name: 'Taken over' },
        headers: { 'If-Match': `"${String(before?.lock_version ?? 0)}"` },
      });
    await expectIsolated({
      route: 'PATCH /v1/customer/sites/:id',
      as: adminA,
      resourceOf: w.customerB,
      resourceId: siteOfB,
      request: rename(siteOfB),
      unknownRequest: rename(randomUUID()),
    });
    expect(await lockOf(siteOfB)).toEqual(before);
  });

  it('GET /customer/sites lists only the caller organisation’s sites', async () => {
    await expectListExcludes({
      as: requesterA,
      resourceOf: w.customerB,
      request: (client) => client.get('/v1/customer/sites?limit=100'),
      extract: (body) => (body as { data: { id: string }[] }).data.map((site) => site.id),
      expectOwn: [...w.customerA.siteIds],
    });
    for (const other of [w.labA, w.labB, w.platform]) {
      expectNoLeak(await requesterA.get('/v1/customer/sites?limit=100'), other);
    }
  });

  it('refuses a lab or platform membership with 403, even with a permission that names sites', async () => {
    for (const client of [
      clientOf(w.labA.user('LAB_MAKER')),
      clientOf(w.labA.user('LAB_CHECKER')),
      clientOf(w.platform.user('PLATFORM_OPS')),
    ]) {
      const list = await client.get('/v1/customer/sites');
      expect(list.status, `${client.user.role} list`).toBe(403);
      const one = await client.get(`/v1/customer/sites/${siteOfB}`);
      expect(one.status, `${client.user.role} get`).toBe(403);
      expectNoLeak(one, w.customerB);
    }
    // LAB_CHECKER holds org_user.manage (for lab users): still no customer site.
    const checker = clientOf(w.labA.user('LAB_CHECKER'));
    const created = await checker.post('/v1/customer/sites', {
      body: {
        name: 'Not mine',
        address: {
          line1: '1 Road',
          line2: null,
          city: 'Delhi',
          district: null,
          stateCode: 'DL',
          pincode: '110001',
        },
      },
    });
    expect(created.status).toBe(403);
  });
});
