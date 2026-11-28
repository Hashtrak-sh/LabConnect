import type { TimerType } from '@labconnect/database';
import { describe, expect, it } from 'vitest';
import {
  createBookingTimerHandlers,
  createBookingTransitionRegistry,
  registerBookingTimerHandlers,
  runDueTimers,
  TimerHandlerRegistry,
} from '../../src/index.js';
import { useBookingHarness } from './booking-support.js';
import { uuid } from './support.js';

// I3-LAB-01: the slot hold is released when a booking leaves the request without a booking: the
// worker's timers expire an undecided request (T-06), an unanswered counter (T-08) and an unpaid
// acceptance (T-10). The release runs from the shared registry (`createBookingTransitionRegistry`),
// so the worker frees the place exactly as the API's reject does.

describe('the slot hold is released by the timer transitions', () => {
  const h = useBookingHarness();
  const { as, callers, rows } = h;
  const handlers = () => {
    const registry = new TimerHandlerRegistry();
    registerBookingTimerHandlers(
      registry,
      createBookingTimerHandlers({
        engine: h.engine(createBookingTransitionRegistry()),
        outbox: h.services.outbox,
        hasPendingPayment: () => Promise.resolve(false),
      }),
    );
    return registry;
  };
  const schedule = (bookingId: string, type: TimerType, dueAt: Date) =>
    as(callers.system(), (tx) =>
      h.services.timers.schedule(tx, {
        type,
        aggregate: { type: 'booking', id: bookingId },
        dueAt,
      }),
    );

  let slotCount = 0;
  /** A slot of the booking's site with one place taken by this booking's live hold. */
  const holdFor = async (bookingId: string, kind: 'SOFT' | 'CONFIRMED') => {
    const [booking] = await rows<{
      lab_site_id: string;
      lab_org_id: string;
      customer_org_id: string;
    }>('SELECT lab_site_id, lab_org_id, customer_org_id FROM booking WHERE id = $1', [bookingId]);
    if (!booking) throw new Error('no booking');
    const slotId = uuid();
    slotCount += 1;
    // A distinct start per slot (unique per site, discipline and start).
    const startsAt = new Date(Date.UTC(2031, 0, 6, 4, slotCount));
    await h.db().query(
      `INSERT INTO slot (id, organisation_id, lab_site_id, slot_date, starts_at, ends_at, capacity,
                         held_count, booked_count)
       VALUES ($1, $2, $3, $4::date, $5::timestamptz, $5::timestamptz + interval '1 hour', 3,
               $6, $7)`,
      [
        slotId,
        booking.lab_org_id,
        booking.lab_site_id,
        startsAt.toISOString().slice(0, 10),
        startsAt.toISOString(),
        kind === 'SOFT' ? 1 : 0,
        kind === 'SOFT' ? 0 : 1,
      ],
    );
    await h.db().query(
      `INSERT INTO slot_hold (id, booking_id, customer_org_id, lab_org_id, slot_id, kind, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6::hold_kind, $7)`,
      [
        uuid(),
        bookingId,
        booking.customer_org_id,
        booking.lab_org_id,
        slotId,
        kind,
        kind === 'SOFT' ? new Date('2026-11-30T00:00:00Z') : null,
      ],
    );
    return slotId;
  };
  const state = async (bookingId: string, slotId: string) => {
    const [hold] = await rows<{ released: boolean }>(
      'SELECT released_at IS NOT NULL AS released FROM slot_hold WHERE booking_id = $1',
      [bookingId],
    );
    const [slot] = await rows<{ held_count: number; booked_count: number }>(
      'SELECT held_count, booked_count FROM slot WHERE id = $1',
      [slotId],
    );
    const [booking] = await rows<{ status: string }>('SELECT status FROM booking WHERE id = $1', [
      bookingId,
    ]);
    return { status: booking?.status, released: hold?.released, ...slot };
  };

  it('T-06: an undecided request expires and its soft hold is released', async () => {
    h.clock.set('2026-11-25T10:00:00Z');
    const id = await h.placeBooking('REQUESTED');
    const slotId = await holdFor(id, 'SOFT');
    await schedule(id, 'LAB_DECISION_DUE', new Date('2026-11-25T14:00:00Z'));
    h.clock.set('2026-11-25T14:00:01Z');
    await runDueTimers(h.worker(), h.clock, handlers());
    expect(await state(id, slotId)).toEqual({
      status: 'EXPIRED',
      released: true,
      held_count: 0,
      booked_count: 0,
    });
  });

  it('T-08: an unanswered counter-offer expires and the soft hold is released', async () => {
    h.clock.set('2026-11-25T10:00:00Z');
    const id = await h.placeBooking('COUNTERED');
    const slotId = await holdFor(id, 'SOFT');
    // The offer the timer answers (this harness places the booking without one).
    await h.db().query(
      `INSERT INTO counter_offer (id, booking_id, customer_org_id, lab_org_id, per_line_quantity,
                                  message, expires_at, proposed_by_user_id)
       SELECT $1, id, customer_org_id, lab_org_id, '[]'::jsonb, 'DEMO counter', $2,
              requester_user_id
         FROM booking WHERE id = $3`,
      [uuid(), new Date('2026-11-26T10:00:00Z'), id],
    );
    await schedule(id, 'COUNTER_RESPONSE_DUE', new Date('2026-11-26T10:00:00Z'));
    h.clock.set('2026-11-26T10:00:01Z');
    await runDueTimers(h.worker(), h.clock, handlers());
    expect(await state(id, slotId)).toEqual({
      status: 'EXPIRED',
      released: true,
      held_count: 0,
      booked_count: 0,
    });
    // ExpireCounter answers the offer itself: EXPIRED, by no user.
    expect(
      await rows<{ status: string; responded_by_user_id: string | null }>(
        'SELECT status, responded_by_user_id FROM counter_offer WHERE booking_id = $1',
        [id],
      ),
    ).toEqual([{ status: 'EXPIRED', responded_by_user_id: null }]);
  });

  it('T-10: an unpaid acceptance expires and its confirmed place is given back', async () => {
    h.clock.set('2026-11-25T10:00:00Z');
    const id = await h.placeBooking('ACCEPTED');
    const slotId = await holdFor(id, 'CONFIRMED');
    await schedule(id, 'PAYMENT_DUE', new Date('2026-11-26T10:00:00Z'));
    h.clock.set('2026-11-26T10:00:01Z');
    await runDueTimers(h.worker(), h.clock, handlers());
    expect(await state(id, slotId)).toEqual({
      status: 'EXPIRED_UNPAID',
      released: true,
      held_count: 0,
      booked_count: 0,
    });
  });
});
