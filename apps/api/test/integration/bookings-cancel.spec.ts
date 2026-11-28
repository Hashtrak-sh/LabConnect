import { randomUUID } from 'node:crypto';
import { bookingInState, loadReference } from '@labconnect/database/test-utils';
import { ROLES } from '@labconnect/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from '../support/identity-app.js';
import { buildWorld, type TenantUser, type World } from '../support/isolation/world.js';

// `cancelBooking` before handover (T-25, free) over HTTP, held to the contract, on a real
// database (I3-LAB-01): from REQUESTED, COUNTERED and ACCEPTED, the slot place given back, the
// timers cancelled, a pending counter-offer closed; and who may cancel.

interface ViewBody {
  status: string;
  cancellation: { reason: { code: string }; byParty: string; notes: string | null } | null;
}

describe('bookings: the customer cancels before handover', () => {
  const t = useIdentityApp();
  let w: World;
  const tokens = new Map<string, string>();

  const tokenOf = async (user: TenantUser): Promise<string> => {
    const known = tokens.get(user.id);
    if (known !== undefined) return known;
    const session =
      ROLES[user.role].mfa === 'REQUIRED'
        ? await t.signInWithMfa(user.email)
        : await t.signIn(user.email);
    tokens.set(user.id, session.accessToken);
    return session.accessToken;
  };
  const owner = () => w.customerA.user('CUSTOMER_REQUESTER');
  const admin = () => w.customerA.user('CUSTOMER_ADMIN');
  const one = async <T>(sql: string, id: string) =>
    (await t.db().query<T & Record<string, unknown>>(sql, [id])).rows[0];
  const lockOf = async (id: string) =>
    (await one<{ lock_version: number }>('SELECT lock_version FROM booking WHERE id = $1', id))
      ?.lock_version ?? -1;
  const cancel = async (
    user: TenantUser,
    id: string,
    options: { ifMatch?: string | null; body?: object; invalidRequest?: string } = {},
  ) =>
    t.api.post(`/v1/bookings/${id}/cancel`, {
      token: await tokenOf(user),
      headers: {
        ...(options.ifMatch !== null && {
          'If-Match': options.ifMatch ?? `"${String(await lockOf(id))}"`,
        }),
      },
      body: options.body ?? { reasonCode: 'CUSTOMER_REQUEST', notes: 'DEMO: plans changed.' },
      ...(options.invalidRequest !== undefined && { invalidRequest: options.invalidRequest }),
    });
  const make = (state: 'REQUESTED' | 'COUNTERED' | 'ACCEPTED' | 'HANDOVER_SET') =>
    t.owner(async (tx) =>
      bookingInState(tx, state, {
        reference: await loadReference(tx),
        customer: w.fixtures.customerA,
        lab: w.fixtures.labA,
      }),
    );
  const holdOf = (id: string) =>
    one<{ kind: string; slot_id: string; released: boolean }>(
      'SELECT kind, slot_id, released_at IS NOT NULL AS released FROM slot_hold WHERE booking_id = $1',
      id,
    );
  const countsOf = (slotId: string) =>
    one<{ held_count: number; booked_count: number }>(
      'SELECT held_count, booked_count FROM slot WHERE id = $1',
      slotId,
    );
  const pendingTimers = async (id: string) =>
    (await t.db().query("SELECT 1 FROM timer WHERE aggregate_id = $1 AND status = 'PENDING'", [id]))
      .rowCount;

  beforeAll(async () => {
    w = await buildWorld(t);
  }, 300_000);

  it('cancels a request: CANCELLED with the reason, the held place given back, no timer left', async () => {
    const booking = await make('REQUESTED');
    const hold = await holdOf(booking.id);
    const before = await countsOf(hold?.slot_id ?? '');
    const response = await cancel(owner(), booking.id);
    expect(response.status).toBe(200);
    expect(response.body as ViewBody).toMatchObject({
      status: 'CANCELLED',
      cancellation: {
        reason: { code: 'CUSTOMER_REQUEST' },
        byParty: 'CUSTOMER',
        notes: 'DEMO: plans changed.',
      },
    });
    expect((await holdOf(booking.id))?.released).toBe(true);
    expect((await countsOf(hold?.slot_id ?? ''))?.held_count).toBe((before?.held_count ?? 0) - 1);
    expect(await pendingTimers(booking.id)).toBe(0);
  });

  it('cancels an accepted booking: the booked place given back', async () => {
    const booking = await make('ACCEPTED');
    const hold = await holdOf(booking.id);
    expect(hold?.kind).toBe('CONFIRMED');
    const before = await countsOf(hold?.slot_id ?? '');
    const response = await cancel(admin(), booking.id, { body: { reasonCode: 'OTHER' } });
    expect(response.status).toBe(200);
    expect((response.body as ViewBody).cancellation?.notes).toBeNull();
    expect((await countsOf(hold?.slot_id ?? ''))?.booked_count).toBe(
      (before?.booked_count ?? 0) - 1,
    );
  });

  it('cancels a countered booking and closes the pending counter-offer as EXPIRED', async () => {
    const booking = await make('COUNTERED');
    const response = await cancel(owner(), booking.id);
    expect(response.status).toBe(200);
    expect(
      await one<{ status: string; responded_by_user_id: string | null }>(
        'SELECT status, responded_by_user_id FROM counter_offer WHERE booking_id = $1',
        booking.id,
      ),
    ).toEqual({ status: 'EXPIRED', responded_by_user_id: null });
  });

  it('refuses after handover (409: T-26 is not built), and a second cancel (409)', async () => {
    const handed = await make('HANDOVER_SET');
    const late = await cancel(owner(), handed.id);
    expect(late.status).toBe(409);
    expect((late.body as { code: string }).code).toBe('INVALID_STATE_TRANSITION');
    const booking = await make('REQUESTED');
    expect((await cancel(owner(), booking.id)).status).toBe(200);
    expect((await cancel(owner(), booking.id)).status).toBe(409);
  });

  it('lets only the owner or a Customer Admin cancel', async () => {
    const booking = await make('REQUESTED');
    for (const user of [
      w.labA.user('LAB_CHECKER'),
      w.customerA.user('CUSTOMER_FINANCE'),
      w.platform.user('PLATFORM_OPS'),
    ]) {
      expect((await cancel(user, booking.id, { ifMatch: '"0"' })).status, user.role).toBe(403);
    }
    expect((await cancel(w.customerB.user('CUSTOMER_ADMIN'), booking.id)).status).toBe(404);
    expect((await cancel(owner(), randomUUID(), { ifMatch: '"0"' })).status).toBe(404);
    expect(
      (await one<{ status: string }>('SELECT status FROM booking WHERE id = $1', booking.id))
        ?.status,
    ).toBe('REQUESTED');
  });

  it('needs a known reason (422), If-Match (400) and the current one (412)', async () => {
    const booking = await make('REQUESTED');
    const unknown = await cancel(owner(), booking.id, { body: { reasonCode: 'NO_SUCH_REASON' } });
    expect(unknown.status).toBe(422);
    expect((unknown.body as { errors?: { path: string }[] }).errors?.[0]?.path).toBe('reasonCode');
    const missing = await cancel(owner(), booking.id, {
      ifMatch: null,
      invalidRequest: 'If-Match is required',
    });
    expect(missing.status).toBe(400);
    const stale = await cancel(owner(), booking.id, { ifMatch: '"99"' });
    expect(stale.status).toBe(412);
  });
});
