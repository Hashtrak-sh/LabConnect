import { randomUUID } from 'node:crypto';
import {
  addMember,
  type BookingFixture,
  bookingInState,
  createUser,
  loadReference,
} from '@labconnect/database/test-utils';
import { ROLES } from '@labconnect/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from '../support/identity-app.js';
import { buildWorld, type TenantUser, type World } from '../support/isolation/world.js';

// The customer's answer to a counter-offer over HTTP, held to the contract, on a real database
// (I3-LAB-01): accept (T-07: the slot swap, the agreed quantity on the lines, the payment window)
// and decline (T-08: EXPIRED, the hold released), with the counter-offer row answered. And who
// may answer: the owner, a Customer Admin for accept only; never the lab.

interface ViewBody {
  viewerParty: string;
  status: string;
  lockVersion: number;
  paymentDueAt: string | null;
  slot: { id: string } | null;
  counterOffer: { status: string } | null;
  lines: {
    id: string;
    requiredSampleQty: number | null;
    snapshot: { sampleQty: number; sampleUnit: { code: string } };
  }[];
  statusHistory: { transitionId: string }[];
}

describe('bookings: the customer answers a counter-offer', () => {
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
  const checker = () => w.labA.user('LAB_CHECKER');

  const lockOf = async (bookingId: string) =>
    (
      await t
        .db()
        .query<{ lock_version: number }>('SELECT lock_version FROM booking WHERE id = $1', [
          bookingId,
        ])
    ).rows[0]?.lock_version ?? -1;
  const answer = async (
    user: TenantUser,
    action: 'accept' | 'decline',
    id: string,
    options: { ifMatch?: string | null; invalidRequest?: string } = {},
  ) =>
    t.api.post(`/v1/bookings/${id}/counter/${action}`, {
      token: await tokenOf(user),
      headers: {
        ...(options.ifMatch !== null && {
          'If-Match': options.ifMatch ?? `"${String(await lockOf(id))}"`,
        }),
      },
      ...(options.invalidRequest !== undefined && { invalidRequest: options.invalidRequest }),
    });
  const liveHoldOf = async (bookingId: string) =>
    (
      await t
        .db()
        .query<{ kind: string; slot_id: string }>(
          'SELECT kind, slot_id FROM slot_hold WHERE booking_id = $1 AND released_at IS NULL',
          [bookingId],
        )
    ).rows[0];
  const countsOf = async (slotId: string) =>
    (
      await t
        .db()
        .query<{ held_count: number; booked_count: number }>(
          'SELECT held_count, booked_count FROM slot WHERE id = $1',
          [slotId],
        )
    ).rows[0];
  const offerStatusOf = async (bookingId: string) =>
    (
      await t
        .db()
        .query<{ status: string; responded_by_user_id: string | null }>(
          'SELECT status, responded_by_user_id::text FROM counter_offer WHERE booking_id = $1',
          [bookingId],
        )
    ).rows[0];
  const otherSlot = async (booking: BookingFixture) =>
    (
      await t.db().query<{ id: string }>(
        `SELECT id FROM slot
          WHERE lab_site_id = $1 AND status = 'OPEN' AND held_count + booked_count < capacity
            AND starts_at > now()
            AND id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          ORDER BY starts_at LIMIT 1`,
        [booking.labSiteId, booking.slotId ?? null],
      )
    ).rows[0]?.id ?? '';

  /** A REQUESTED booking of customer A's requester, countered by lab A's Checker over HTTP. */
  const countered = async (options: { slot?: boolean; more?: boolean } = {}) => {
    const booking = await t.owner(async (tx) =>
      bookingInState(tx, 'REQUESTED', {
        reference: await loadReference(tx),
        customer: w.fixtures.customerA,
        lab: w.fixtures.labA,
      }),
    );
    const view = (
      await t.api.get(`/v1/bookings/${booking.id}`, { token: await tokenOf(checker()) })
    ).body as ViewBody;
    const line = view.lines[0];
    const slotId = options.slot === false ? undefined : await otherSlot(booking);
    const response = await t.api.post(`/v1/bookings/${booking.id}/counter`, {
      token: await tokenOf(checker()),
      headers: { 'If-Match': `"${String(view.lockVersion)}"` },
      body: {
        ...(slotId !== undefined && { proposedSlotId: slotId }),
        ...(options.more !== false && {
          perLineQuantity: [
            {
              lineId: line?.id ?? '',
              sampleQty: (line?.snapshot.sampleQty ?? 0) + 2,
              unitCode: line?.snapshot.sampleUnit.code ?? '',
            },
          ],
        }),
        message: 'DEMO: another slot and more sample.',
      },
    });
    expect(response.status).toBe(200);
    return { booking, slotId, line, oldSlotId: booking.slotId ?? '' };
  };

  beforeAll(async () => {
    w = await buildWorld(t);
  }, 300_000);

  it('accepts: ACCEPTED, the booking moved to the proposed slot, the quantity agreed, payment due', async () => {
    const { booking, slotId, line, oldSlotId } = await countered();
    const oldBefore = await countsOf(oldSlotId);
    const newBefore = await countsOf(slotId ?? '');

    const response = await answer(owner(), 'accept', booking.id);
    expect(response.status).toBe(200);
    const body = response.body as ViewBody;
    expect(body.viewerParty).toBe('CUSTOMER');
    expect(body.status).toBe('ACCEPTED');
    expect(body.paymentDueAt).not.toBeNull();
    expect(body.slot?.id).toBe(slotId);
    expect(body.lines[0]?.requiredSampleQty).toBe((line?.snapshot.sampleQty ?? 0) + 2);
    expect(body.statusHistory.map((change) => change.transitionId)).toContain('T-07');
    expect(response.headers.etag).toBe(`"${String(body.lockVersion)}"`);

    // The slot swap: the old held place released, a booked place in the new slot.
    expect(await liveHoldOf(booking.id)).toEqual({ kind: 'CONFIRMED', slot_id: slotId });
    expect(await countsOf(oldSlotId)).toEqual({
      held_count: (oldBefore?.held_count ?? 0) - 1,
      booked_count: oldBefore?.booked_count ?? 0,
    });
    expect(await countsOf(slotId ?? '')).toEqual({
      held_count: newBefore?.held_count ?? 0,
      booked_count: (newBefore?.booked_count ?? 0) + 1,
    });
    expect(await offerStatusOf(booking.id)).toEqual({
      status: 'ACCEPTED',
      responded_by_user_id: owner().id,
    });
  });

  it('accepts a counter for more sample only: the hold stays in its slot and is confirmed', async () => {
    const { booking, oldSlotId } = await countered({ slot: false });
    const response = await answer(admin(), 'accept', booking.id);
    expect(response.status).toBe(200);
    expect((response.body as ViewBody).slot?.id).toBe(oldSlotId);
    expect(await liveHoldOf(booking.id)).toEqual({ kind: 'CONFIRMED', slot_id: oldSlotId });
  });

  it('declines: EXPIRED, the hold released, the offer DECLINED', async () => {
    const { booking, oldSlotId } = await countered();
    const before = await countsOf(oldSlotId);
    const response = await answer(owner(), 'decline', booking.id);
    expect(response.status).toBe(200);
    expect((response.body as ViewBody).status).toBe('EXPIRED');
    expect(await liveHoldOf(booking.id)).toBeUndefined();
    expect((await countsOf(oldSlotId))?.held_count).toBe((before?.held_count ?? 0) - 1);
    expect((await offerStatusOf(booking.id))?.status).toBe('DECLINED');
  });

  it('refuses to accept a counter past its expiry, or when the proposed slot has filled (409)', async () => {
    const lapsed = await countered();
    await t.owner(
      (tx) =>
        tx.$executeRaw`UPDATE counter_offer SET expires_at = ${new Date(t.clock.now().getTime() - 60_000)} WHERE booking_id = ${lapsed.booking.id}::uuid`,
    );
    const late = await answer(owner(), 'accept', lapsed.booking.id);
    expect(late.status).toBe(409);
    expect((late.body as { code: string }).code).toBe('INVALID_STATE_TRANSITION');

    const full = await countered();
    await t.owner(
      (tx) =>
        tx.$executeRaw`UPDATE slot SET status = 'CLOSED' WHERE id = ${full.slotId ?? ''}::uuid`,
    );
    try {
      const response = await answer(owner(), 'accept', full.booking.id);
      expect(response.status).toBe(409);
      expect((response.body as { code: string }).code).toBe('SLOT_UNAVAILABLE');
      expect((await offerStatusOf(full.booking.id))?.status).toBe('PENDING');
      expect((await liveHoldOf(full.booking.id))?.slot_id).toBe(full.oldSlotId);
    } finally {
      await t.owner(
        (tx) =>
          tx.$executeRaw`UPDATE slot SET status = 'OPEN' WHERE id = ${full.slotId ?? ''}::uuid`,
      );
    }
  });

  it('lets the owner answer, an admin accept but not decline, and no one else', async () => {
    const { booking } = await countered();
    const adminDecline = await answer(admin(), 'decline', booking.id);
    expect(adminDecline.status).toBe(403);
    const lab = await answer(checker(), 'accept', booking.id);
    expect(lab.status).toBe(403);
    const finance = await answer(w.customerA.user('CUSTOMER_FINANCE'), 'accept', booking.id);
    expect(finance.status).toBe(403);
    const otherCustomer = await answer(w.customerB.user('CUSTOMER_ADMIN'), 'accept', booking.id);
    expect(otherCustomer.status).toBe(404);
    const unknown = await answer(owner(), 'accept', randomUUID(), { ifMatch: '"0"' });
    expect(unknown.status).toBe(404);
    expect((await offerStatusOf(booking.id))?.status).toBe('PENDING');
  });

  it('needs If-Match (400) and the current one (412), and a COUNTERED booking (409)', async () => {
    const { booking } = await countered();
    const missing = await answer(owner(), 'accept', booking.id, {
      ifMatch: null,
      invalidRequest: 'If-Match is required',
    });
    expect(missing.status).toBe(400);
    const stale = await answer(owner(), 'accept', booking.id, { ifMatch: '"0"' });
    expect(stale.status).toBe(412);
    expect((stale.body as { code: string }).code).toBe('CONCURRENT_MODIFICATION');
    expect((await answer(owner(), 'decline', booking.id)).status).toBe(200);
    const again = await answer(owner(), 'accept', booking.id);
    expect(again.status).toBe(409);
    expect((again.body as { code: string }).code).toBe('INVALID_STATE_TRANSITION');
  });

  it('lets a member who is both requester and admin accept a colleague’s booking as the admin', async () => {
    const email = `two.roles.${randomUUID().slice(0, 8)}@demo.labconnect.test`;
    const both: TenantUser = await t.owner(async (tx) => {
      const userId = await createUser(tx, { email, fullName: 'DEMO Requester and Admin' });
      // The requester role first, so a "first customer role" choice would pick it.
      const membershipId = await addMember(
        tx,
        userId,
        w.fixtures.customerA.organisationId,
        'CUSTOMER_REQUESTER',
        [],
      );
      await tx.membershipRole.create({
        data: { id: randomUUID(), membershipId, role: 'CUSTOMER_ADMIN' },
      });
      return {
        id: userId,
        email,
        role: 'CUSTOMER_ADMIN',
        organisationId: w.fixtures.customerA.organisationId,
        membershipId,
      };
    });
    const { booking } = await countered();
    const response = await answer(both, 'accept', booking.id);
    expect(response.status).toBe(200);
    const role = await t
      .db()
      .query<{ actor_role: string }>(
        "SELECT actor_role FROM booking_status_history WHERE booking_id = $1 AND transition_id = 'T-07'",
        [booking.id],
      );
    expect(role.rows[0]?.actor_role).toBe('CUSTOMER_ADMIN');
  });

  it('records a decline of an offer already past its expiry as EXPIRED, by no one', async () => {
    const { booking } = await countered();
    await t.owner(
      (tx) =>
        tx.$executeRaw`UPDATE counter_offer SET expires_at = ${new Date(t.clock.now().getTime() - 60_000)} WHERE booking_id = ${booking.id}::uuid`,
    );
    const response = await answer(owner(), 'decline', booking.id);
    expect(response.status).toBe(200);
    expect((response.body as ViewBody).status).toBe('EXPIRED');
    expect(await offerStatusOf(booking.id)).toEqual({
      status: 'EXPIRED',
      responded_by_user_id: null,
    });
  });

  it('moves to the proposed slot also when the old hold has already gone', async () => {
    const { booking, slotId, oldSlotId } = await countered();
    // The soft hold released earlier (as an expiry would): one place given back.
    await t.owner(async (tx) => {
      await tx.$executeRaw`UPDATE slot_hold SET released_at = now() WHERE booking_id = ${booking.id}::uuid AND released_at IS NULL`;
      await tx.$executeRaw`UPDATE slot SET held_count = held_count - 1 WHERE id = ${oldSlotId}::uuid`;
    });
    const oldBefore = await countsOf(oldSlotId);
    const response = await answer(owner(), 'accept', booking.id);
    expect(response.status).toBe(200);
    expect(await liveHoldOf(booking.id)).toEqual({ kind: 'CONFIRMED', slot_id: slotId });
    expect(await countsOf(oldSlotId)).toEqual(oldBefore);
  });

  it('refuses a counter quantity with more than three decimals (the line stores three)', async () => {
    const booking = await t.owner(async (tx) =>
      bookingInState(tx, 'REQUESTED', {
        reference: await loadReference(tx),
        customer: w.fixtures.customerA,
        lab: w.fixtures.labA,
      }),
    );
    const view = (
      await t.api.get(`/v1/bookings/${booking.id}`, { token: await tokenOf(checker()) })
    ).body as ViewBody;
    const line = view.lines[0];
    const response = await t.api.post(`/v1/bookings/${booking.id}/counter`, {
      token: await tokenOf(checker()),
      headers: { 'If-Match': `"${String(view.lockVersion)}"` },
      body: {
        perLineQuantity: [
          {
            lineId: line?.id ?? '',
            sampleQty: (line?.snapshot.sampleQty ?? 0) + 0.0004,
            unitCode: line?.snapshot.sampleUnit.code ?? '',
          },
        ],
        message: 'DEMO: a hair more.',
      },
      invalidRequest: 'sampleQty has more than three decimals',
    });
    expect(response.status).toBe(422);
    const problem = response.body as { code: string; errors?: { path: string }[] };
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(problem.errors?.[0]?.path).toBe('perLineQuantity[0].sampleQty');
  });
});
