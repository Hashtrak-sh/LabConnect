// Tenant isolation of the notification routes (P3-05 checklist, step 4): `markNotificationRead`
// takes an id in its path, so another user's notification is `404 NOT_FOUND`, indistinguishable
// from an unknown id. A notification belongs to one user, so the rule also holds inside one
// organisation, which the tenant kit does not cover on its own.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
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
  type World,
} from '../../support/isolation/world.js';

describe('tenant isolation on the notification routes', () => {
  const t = useIdentityApp();
  const clientOf = clientFactory(t);
  let w: World;
  let requesterA: Client;
  let adminA: Client;
  let makerLab: Client;
  let checkerLab: Client;
  let adminB: Client;
  const notified: Record<string, string> = {};

  const insert = async (userId: string, organisationId: string): Promise<string> => {
    const id = randomUUID();
    await t.db().query(
      `INSERT INTO notification (id, recipient_user_id, organisation_id, event_code, event_id, channel,
                                 template_version, payload, status, sent_at)
       VALUES ($1, $2, $3, 'booking.accepted', $4, 'IN_APP', 0, '{"bookingNo":"LC-1"}'::jsonb, 'SENT', now())`,
      [id, userId, organisationId, randomUUID()],
    );
    return id;
  };

  beforeAll(async () => {
    w = await buildWorld(t);
    requesterA = clientOf(w.customerA.user('CUSTOMER_REQUESTER'));
    adminA = clientOf(w.customerA.user('CUSTOMER_ADMIN'));
    adminB = clientOf(w.customerB.user('CUSTOMER_ADMIN'));
    makerLab = clientOf(w.labA.user('LAB_MAKER'));
    checkerLab = clientOf(w.labA.user('LAB_CHECKER'));
    for (const [label, tenant, role] of [
      ['requesterA', w.customerA, 'CUSTOMER_REQUESTER'],
      ['adminA', w.customerA, 'CUSTOMER_ADMIN'],
      ['adminB', w.customerB, 'CUSTOMER_ADMIN'],
      ['maker', w.labA, 'LAB_MAKER'],
      ['checker', w.labA, 'LAB_CHECKER'],
    ] as const) {
      notified[label] = await insert(tenant.user(role).id, tenant.organisationId);
    }
  });

  const read = (id: string) => (client: Client) => client.post(`/v1/me/notifications/${id}/read`);
  const readAtOf = async (id: string) =>
    (
      await t
        .db()
        .query<{ read_at: Date | null }>('SELECT read_at FROM notification WHERE id = $1', [id])
    ).rows[0]?.read_at;

  it("POST /me/notifications/{id}/read with another tenant's notification: 404, the same answer as for an unknown id", async () => {
    const victim = notified.adminB ?? '';
    await expectIsolated({
      route: 'POST /v1/me/notifications/:id/read',
      as: requesterA,
      resourceOf: w.customerB,
      resourceId: victim,
      request: read(victim),
      unknownRequest: read(randomUUID()),
    });
    expect(await readAtOf(victim)).toBeNull();
  });

  it("answers 404 for a colleague's notification in the same organisation, and marks nothing", async () => {
    for (const [asClient, victimLabel] of [
      [adminA, 'requesterA'],
      [requesterA, 'adminA'],
      [makerLab, 'checker'],
      [checkerLab, 'maker'],
    ] as const) {
      const victim = notified[victimLabel] ?? '';
      const response = await read(victim)(asClient);
      expect(response.status, `${asClient.user.role} reading ${victimLabel}`).toBe(404);
      expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
      expect(await readAtOf(victim)).toBeNull();
    }
    // Their own: 204.
    expect((await read(notified.requesterA ?? '')(requesterA)).status).toBe(204);
    expect(await readAtOf(notified.requesterA ?? '')).toBeInstanceOf(Date);
  });

  it("GET /me/notifications lists only the caller's own rows, never a colleague's or another tenant's", async () => {
    const ids = await expectListExcludes({
      as: adminA,
      resourceOf: w.customerB,
      request: (client) => client.get('/v1/me/notifications?limit=100'),
      extract: (body) => (body as { data: { id: string }[] }).data.map((item) => item.id),
      expectOwn: [notified.adminA ?? ''],
    });
    expect(ids).not.toContain(notified.requesterA);
    for (const other of [w.customerB, w.labA, w.labB, w.platform]) {
      const response = await adminA.get('/v1/me/notifications?limit=100');
      expectNoLeak(response, other);
    }
    await expectOwnVisible({
      as: makerLab,
      request: (client) => client.get('/v1/me/notifications'),
      expectBody: (body) => {
        expect((body as { data: { id: string }[] }).data.map((item) => item.id)).toEqual([
          notified.maker,
        ]);
      },
    });
  });

  it('ignores an organisation or user id sent by the client', async () => {
    const response = await adminA.get(
      `/v1/me/notifications?organisationId=${w.customerB.organisationId}&userId=${w.customerB.user('CUSTOMER_ADMIN').id}`,
    );
    // The contract has no such parameters: unknown query parameters change nothing.
    expect([200, 422]).toContain(response.status);
    if (response.status === 200) {
      const ids = (response.body as { data: { id: string }[] }).data.map((item) => item.id);
      expect(ids).toEqual([notified.adminA]);
    }
    expect(JSON.stringify(response.body)).not.toContain(notified.adminB ?? 'x');
  });

  it("keeps a user's mute settings to the user", async () => {
    const patch = await requesterA.call('patch', '/v1/me/notification-preferences', {
      body: { preferences: [{ eventCode: 'booking.expired', channel: 'EMAIL', muted: true }] },
    });
    expect(patch.status).toBe(204);
    const own = await requesterA.get('/v1/me/notification-preferences');
    expect((own.body as { data: unknown[] }).data).toHaveLength(1);
    for (const client of [adminA, adminB, makerLab, checkerLab]) {
      const other = await client.get('/v1/me/notification-preferences');
      expect(other.status).toBe(200);
      expect((other.body as { data: unknown[] }).data).toEqual([]);
    }
  });
});
