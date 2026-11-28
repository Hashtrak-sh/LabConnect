// Tenant isolation of the booking reads (I3-SHR-01): a booking of another customer or another lab
// is `404 NOT_FOUND`, the same answer as an unknown id, and so is a booking at a lab site the
// member is not assigned to (RR-3). The list never shows another tenant's bookings.
import { randomUUID } from 'node:crypto';
import { bookingInState, loadReference } from '@labconnect/database/test-utils';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from '../../support/identity-app.js';
import { expectIsolated, expectListExcludes } from '../../support/isolation/kit.js';
import {
  buildWorld,
  type Client,
  clientFactory,
  type World,
} from '../../support/isolation/world.js';

describe('tenant isolation on the booking routes', () => {
  const t = useIdentityApp();
  const clientOf = clientFactory(t);
  let w: World;
  /** Customer B's booking at lab B: no member of customer A or lab A is a party to it. */
  let bookingOfB: string;
  /** Customer A's booking at lab A's second site. */
  let atSecondSite: string;
  let ownOfA: string;

  beforeAll(async () => {
    w = await buildWorld(t);
    const { customerA, customerB, labA, labB } = w.fixtures;
    const secondSite = labA.sites[1];
    if (!secondSite) throw new Error('lab A needs two sites');
    await t.owner(async (tx) => {
      const reference = await loadReference(tx);
      bookingOfB = (
        await bookingInState(tx, 'REQUESTED', { reference, customer: customerB, lab: labB })
      ).id;
      atSecondSite = (
        await bookingInState(tx, 'REQUESTED', {
          reference,
          customer: customerA,
          lab: labA,
          site: secondSite,
        })
      ).id;
      ownOfA = (
        await bookingInState(tx, 'REQUESTED', { reference, customer: customerA, lab: labA })
      ).id;
    });
  }, 300_000);

  const read = (id: string) => (client: Client) => client.get(`/v1/bookings/${id}`);

  it("GET /bookings/{id} with another customer's booking: 404, like an unknown id", async () => {
    await expectIsolated({
      route: 'GET /v1/bookings/:id',
      as: clientOf(w.customerA.user('CUSTOMER_ADMIN')),
      resourceOf: w.customerB,
      resourceId: bookingOfB,
      request: read(bookingOfB),
      unknownRequest: read(randomUUID()),
    });
  });

  it("GET /bookings/{id} with another lab's booking: 404, like an unknown id", async () => {
    await expectIsolated({
      route: 'GET /v1/bookings/:id',
      as: clientOf(w.labA.user('LAB_CHECKER')),
      resourceOf: w.labB,
      resourceId: bookingOfB,
      request: read(bookingOfB),
      unknownRequest: read(randomUUID()),
    });
  });

  /** The calls of one decision on a booking id, and a check that bookingOfB did not change. */
  const decision = (action: 'accept' | 'reject' | 'counter') => {
    const body =
      action === 'reject'
        ? { reasonCode: 'NO_CAPACITY', notes: 'x' }
        : action === 'counter'
          ? { proposedSlotId: randomUUID(), message: 'x' }
          : undefined;
    const call = (id: string) => (client: Client) =>
      client.post(`/v1/bookings/${id}/${action}`, {
        headers: { 'If-Match': '"0"' },
        ...(body !== undefined && { body }),
      });
    return {
      as: clientOf(w.labA.user('LAB_CHECKER')),
      resourceOf: w.labB,
      resourceId: bookingOfB,
      request: call(bookingOfB),
      unknownRequest: call(randomUUID()),
    };
  };
  const unchanged = async () => {
    const status = await t
      .db()
      .query<{ status: string }>('SELECT status FROM booking WHERE id = $1', [bookingOfB]);
    expect(status.rows[0]?.status).toBe('REQUESTED');
  };

  it("POST /bookings/{id}/accept on another lab's booking: 404, like an unknown id", async () => {
    await expectIsolated({ route: 'POST /v1/bookings/:id/accept', ...decision('accept') });
    await unchanged();
  });

  it("POST /bookings/{id}/reject on another lab's booking: 404, like an unknown id", async () => {
    await expectIsolated({ route: 'POST /v1/bookings/:id/reject', ...decision('reject') });
    await unchanged();
  });

  it("POST /bookings/{id}/counter on another lab's booking: 404, like an unknown id", async () => {
    await expectIsolated({ route: 'POST /v1/bookings/:id/counter', ...decision('counter') });
    await unchanged();
  });

  it('GET /bookings/{id} at a site the Maker is not assigned to: 404, like an unknown id', async () => {
    const maker = clientOf(w.siteMaker);
    const response = await maker.get(`/v1/bookings/${atSecondSite}`);
    expect(response.status).toBe(404);
    expect((await maker.get(`/v1/bookings/${randomUUID()}`)).status).toBe(404);
    expect((await maker.get(`/v1/bookings/${ownOfA}`)).status).toBe(200);
  });

  it('GET /bookings lists only the caller’s bookings', async () => {
    await expectListExcludes({
      as: clientOf(w.customerA.user('CUSTOMER_ADMIN')),
      resourceOf: w.customerB,
      request: (client) => client.get('/v1/bookings?limit=100'),
      extract: (body) => (body as { data: { id: string }[] }).data.map((row) => row.id),
      expectOwn: [ownOfA, atSecondSite],
    });
    await expectListExcludes({
      as: clientOf(w.labA.user('LAB_CHECKER')),
      resourceOf: w.labB,
      request: (client) => client.get('/v1/bookings?limit=100'),
      extract: (body) => (body as { data: { id: string }[] }).data.map((row) => row.id),
      expectOwn: [ownOfA, atSecondSite],
    });
  });
});
