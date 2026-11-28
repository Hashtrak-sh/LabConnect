import { randomUUID } from 'node:crypto';
import {
  bookingInState,
  type BookingFixture,
  loadReference,
} from '@labconnect/database/test-utils';
import { ROLES } from '@labconnect/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from '../support/identity-app.js';
import { buildWorld, type TenantUser, type World } from '../support/isolation/world.js';

// The lab's decision on a request over HTTP, held to the contract, on a real database (I3-LAB-01):
// accept (T-03), reject (T-05) and counter (T-04) by a Checker of the site, through the booking
// engine, with what each moves: the slot hold and counts, the payment and counter timers, the
// counter-offer row. And who may not decide: a Maker, a customer, Ops, another lab.

interface ViewBody {
  viewerParty: string;
  status: string;
  lockVersion: number;
  paymentDueAt: string | null;
  rejection: { reason: { code: string }; notes: string | null } | null;
  counterOffer: {
    status: string;
    message: string;
    proposedSlot: { id: string } | null;
    perLineQuantity: { lineId: string; sampleQty: number; unitCode: string }[];
  } | null;
  lines: { id: string; snapshot: { sampleUnit: { code: string } } }[];
  statusHistory: { transitionId: string }[];
}

describe('bookings: the lab decides (accept, reject, counter)', () => {
  const t = useIdentityApp();
  let w: World;
  const tokens = new Map<string, string>();
  let siteA1: string;

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
  /** A fresh REQUESTED booking of customer A at lab A's first site (or the given state). */
  const newBooking = async (state: 'REQUESTED' | 'ACCEPTED' = 'REQUESTED') =>
    t.owner(async (tx) =>
      bookingInState(tx, state, {
        reference: await loadReference(tx),
        customer: w.fixtures.customerA,
        lab: w.fixtures.labA,
      }),
    );
  const decide = async (
    user: TenantUser,
    action: 'accept' | 'reject' | 'counter',
    id: string,
    options: { ifMatch?: string | null; body?: object; key?: string; invalidRequest?: string } = {},
  ) =>
    t.api.post(`/v1/bookings/${id}/${action}`, {
      token: await tokenOf(user),
      headers: {
        ...(options.ifMatch !== null && { 'If-Match': options.ifMatch ?? '"0"' }),
        ...(options.key !== undefined && { 'Idempotency-Key': options.key }),
      },
      ...(options.body !== undefined && { body: options.body }),
      ...(options.invalidRequest !== undefined && { invalidRequest: options.invalidRequest }),
    });
  const checker = () => w.labA.user('LAB_CHECKER');
  const holdOf = async (bookingId: string) =>
    (
      await t.db().query<{
        kind: string;
        expires_at: Date | null;
        released_at: Date | null;
        slot_id: string;
      }>('SELECT kind, expires_at, released_at, slot_id FROM slot_hold WHERE booking_id = $1', [bookingId])
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
  const timersOf = async (bookingId: string) =>
    (
      await t
        .db()
        .query<{ timer_type: string }>(
          "SELECT timer_type FROM timer WHERE aggregate_id = $1 AND status = 'PENDING' ORDER BY timer_type",
          [bookingId],
        )
    ).rows.map((row) => row.timer_type);
  /** Another open slot of the same site with room, not the booking's own. */
  const otherSlot = async (booking: BookingFixture) =>
    (
      await t.db().query<{ id: string }>(
        `SELECT id FROM slot
          WHERE lab_site_id = $1 AND status = 'OPEN' AND held_count + booked_count < capacity
            AND id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          ORDER BY starts_at LIMIT 1`,
        [booking.labSiteId, booking.slotId ?? null],
      )
    ).rows[0]?.id ?? '';

  beforeAll(async () => {
    w = await buildWorld(t);
    siteA1 = w.fixtures.labA.sites[0]?.id ?? '';
  }, 300_000);

  it('accepts: ACCEPTED, the hold confirmed, one place moved from held to booked, the payment timers', async () => {
    const booking = await newBooking();
    const hold = await holdOf(booking.id);
    expect(hold?.kind).toBe('SOFT');
    const before = await countsOf(hold?.slot_id ?? '');

    const response = await decide(checker(), 'accept', booking.id);
    expect(response.status).toBe(200);
    const body = response.body as ViewBody;
    expect(body.viewerParty).toBe('LAB');
    expect(body.status).toBe('ACCEPTED');
    expect(body.paymentDueAt).not.toBeNull();
    expect(body.statusHistory.map((change) => change.transitionId)).toContain('T-03');
    expect(response.headers.etag).toBe(`"${String(body.lockVersion)}"`);

    const after = await holdOf(booking.id);
    expect(after).toMatchObject({ kind: 'CONFIRMED', expires_at: null, released_at: null });
    expect(await countsOf(hold?.slot_id ?? '')).toEqual({
      held_count: (before?.held_count ?? 0) - 1,
      booked_count: (before?.booked_count ?? 0) + 1,
    });
    expect(await timersOf(booking.id)).toEqual(
      expect.arrayContaining(['PAYMENT_DUE', 'PAYMENT_REMINDER']),
    );
  });

  it('replays the same Idempotency-Key with the stored answer, without deciding twice', async () => {
    const booking = await newBooking();
    const key = randomUUID();
    const first = await decide(checker(), 'accept', booking.id, { key });
    expect(first.status).toBe(200);
    const again = await decide(checker(), 'accept', booking.id, { key });
    expect(again.status).toBe(200);
    expect((again.body as ViewBody).lockVersion).toBe((first.body as ViewBody).lockVersion);
    const history = await t
      .db()
      .query(
        "SELECT 1 FROM booking_status_history WHERE booking_id = $1 AND transition_id = 'T-03'",
        [booking.id],
      );
    expect(history.rowCount).toBe(1);
  });

  it('needs the current If-Match (412), refuses a booking that is not REQUESTED (409)', async () => {
    const booking = await newBooking();
    const stale = await decide(checker(), 'accept', booking.id, { ifMatch: '"7"' });
    expect(stale.status).toBe(412);
    expect((stale.body as { code: string }).code).toBe('CONCURRENT_MODIFICATION');
    const missing = await decide(checker(), 'accept', booking.id, {
      ifMatch: null,
      invalidRequest: 'If-Match is required',
    });
    expect(missing.status).toBe(400);

    const accepted = await newBooking('ACCEPTED');
    const lock = await t
      .db()
      .query<{ lock_version: number }>('SELECT lock_version FROM booking WHERE id = $1', [
        accepted.id,
      ]);
    const twice = await decide(checker(), 'accept', accepted.id, {
      ifMatch: `"${String(lock.rows[0]?.lock_version)}"`,
    });
    expect(twice.status).toBe(409);
    expect((twice.body as { code: string }).code).toBe('INVALID_STATE_TRANSITION');
  });

  it('refuses to accept for a site that is no longer bookable, with the reasons, and changes nothing', async () => {
    const booking = await newBooking();
    await t.owner(async (tx) => {
      await tx.$executeRaw`UPDATE lab_site SET is_bookable = false, listing_status = 'LISTED', bookability_reasons = ARRAY['NO_PUBLISHED_PRICE_LIST'] WHERE id = ${siteA1}::uuid`;
    });
    try {
      const response = await decide(checker(), 'accept', booking.id);
      expect(response.status).toBe(422);
      const problem = response.body as { code: string; meta?: { reasons?: string[] } };
      expect(problem.code).toBe('SITE_NOT_BOOKABLE');
      expect(problem.meta?.reasons).toEqual(['NO_PUBLISHED_PRICE_LIST']);
      expect((await holdOf(booking.id))?.kind).toBe('SOFT');
    } finally {
      await t.owner(async (tx) => {
        await tx.$executeRaw`UPDATE lab_site SET is_bookable = true, listing_status = 'BOOKABLE', bookability_reasons = '{}' WHERE id = ${siteA1}::uuid`;
      });
    }
  });

  it('rejects with a reason code and notes: REJECTED, and the slot hold released', async () => {
    const booking = await newBooking();
    const hold = await holdOf(booking.id);
    const before = await countsOf(hold?.slot_id ?? '');
    const response = await decide(checker(), 'reject', booking.id, {
      body: { reasonCode: 'NO_CAPACITY', notes: 'Fully booked that week.' },
    });
    expect(response.status).toBe(200);
    const body = response.body as ViewBody;
    expect(body.status).toBe('REJECTED');
    expect(body.rejection).toEqual({
      reason: { code: 'NO_CAPACITY', name: 'No capacity' },
      notes: 'Fully booked that week.',
    });
    expect((await holdOf(booking.id))?.released_at).not.toBeNull();
    expect((await countsOf(hold?.slot_id ?? ''))?.held_count).toBe((before?.held_count ?? 0) - 1);
  });

  it('refuses an unknown reason code or missing notes with 422', async () => {
    const booking = await newBooking();
    const unknown = await decide(checker(), 'reject', booking.id, {
      body: { reasonCode: 'NOT_A_REASON', notes: 'x' },
    });
    expect(unknown.status).toBe(422);
    expect((unknown.body as { errors: { path: string }[] }).errors[0]?.path).toBe('reasonCode');
    const noNotes = await decide(checker(), 'reject', booking.id, {
      body: { reasonCode: 'NO_CAPACITY' },
      invalidRequest: 'notes are required',
    });
    expect(noNotes.status).toBe(422);
  });

  it('counters with another slot and more sample: COUNTERED, the counter-offer, its timer', async () => {
    const booking = await newBooking();
    const slotId = await otherSlot(booking);
    const view = (
      await t.api.get(`/v1/bookings/${booking.id}`, { token: await tokenOf(checker()) })
    ).body as ViewBody;
    const line = view.lines[0];
    const response = await decide(checker(), 'counter', booking.id, {
      body: {
        proposedSlotId: slotId,
        perLineQuantity: [
          { lineId: line?.id ?? '', sampleQty: 3, unitCode: line?.snapshot.sampleUnit.code ?? '' },
        ],
        message: 'We need more sample for the retest.',
      },
    });
    expect(response.status).toBe(200);
    const body = response.body as ViewBody;
    expect(body.status).toBe('COUNTERED');
    expect(body.counterOffer).toMatchObject({
      status: 'PENDING',
      message: 'We need more sample for the retest.',
      proposedSlot: { id: slotId },
      perLineQuantity: [{ lineId: line?.id, sampleQty: 3 }],
    });
    expect(await timersOf(booking.id)).toContain('COUNTER_RESPONSE_DUE');
    // The proposed slot is not held (it is checked again when the customer accepts).
    expect((await holdOf(booking.id))?.slot_id).not.toBe(slotId);
  });

  it('refuses a counter that names a price or a method, another site’s slot, a wrong unit or a full slot', async () => {
    const booking = await newBooking();
    const price = await decide(checker(), 'counter', booking.id, {
      body: { message: 'x', priceOverride: 1 },
      invalidRequest: 'a price field is not allowed',
    });
    expect(price.status).toBe(422);
    expect((price.body as { code: string }).code).toBe('COUNTER_FIELD_NOT_ALLOWED');

    const siteA2 = w.fixtures.labA.sites[1]?.id ?? '';
    const foreignSlot = (
      await t
        .db()
        .query<{ id: string }>('SELECT id FROM slot WHERE lab_site_id = $1 LIMIT 1', [siteA2])
    ).rows[0]?.id;
    const foreign = await decide(checker(), 'counter', booking.id, {
      body: { proposedSlotId: foreignSlot, message: 'x' },
    });
    expect(foreign.status).toBe(422);
    expect((foreign.body as { errors: { path: string }[] }).errors[0]?.path).toBe('proposedSlotId');

    const view = (
      await t.api.get(`/v1/bookings/${booking.id}`, { token: await tokenOf(checker()) })
    ).body as ViewBody;
    const wrongUnit = await decide(checker(), 'counter', booking.id, {
      body: {
        perLineQuantity: [{ lineId: view.lines[0]?.id, sampleQty: 2, unitCode: 'NOT_THE_UNIT' }],
        message: 'x',
      },
    });
    expect(wrongUnit.status).toBe(422);

    const full = await otherSlot(booking);
    await t.owner(async (tx) => {
      await tx.$executeRaw`UPDATE slot SET status = 'CLOSED' WHERE id = ${full}::uuid`;
    });
    const closed = await decide(checker(), 'counter', booking.id, {
      body: { proposedSlotId: full, message: 'x' },
    });
    expect(closed.status).toBe(409);
    expect((closed.body as { code: string }).code).toBe('SLOT_UNAVAILABLE');
    // Nothing was decided.
    const status = await t
      .db()
      .query<{ status: string }>('SELECT status FROM booking WHERE id = $1', [booking.id]);
    expect(status.rows[0]?.status).toBe('REQUESTED');
  });

  it('lets only a Checker of the site decide: Maker, customer and Ops 403, another lab 404', async () => {
    const booking = await newBooking();
    for (const user of [
      w.labA.user('LAB_MAKER'),
      w.customerA.user('CUSTOMER_ADMIN'),
      w.platform.user('PLATFORM_OPS'),
    ]) {
      const response = await decide(user, 'accept', booking.id);
      expect(response.status, user.role).toBe(403);
    }
    const otherLab = await decide(w.labB.user('LAB_CHECKER'), 'accept', booking.id);
    expect(otherLab.status).toBe(404);
    const unknown = await decide(checker(), 'accept', randomUUID());
    expect(unknown.status).toBe(404);
    const status = await t
      .db()
      .query<{ status: string }>('SELECT status FROM booking WHERE id = $1', [booking.id]);
    expect(status.rows[0]?.status).toBe('REQUESTED');
  });
});
