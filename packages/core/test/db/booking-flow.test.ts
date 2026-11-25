import type { TimerType } from '@labconnect/database';
import { describe, expect, it } from 'vitest';
import {
  BookingError,
  createBookingTimerHandlers,
  registerBookingTimerHandlers,
  registerDefaultBookingEffects,
  runDueTimers,
  TimerHandlerRegistry,
  TransitionRegistry,
} from '../../src/index.js';
import { useBookingHarness } from './booking-support.js';
import { uuid } from './support.js';

// P3-07: the default timer effects, the timer handlers, and the happy path of the MVP flow,
// all through the engine only.

const MINUTE = 60_000;

describe('booking timers and the main flow', () => {
  const h = useBookingHarness();
  const { as, callers, rows } = h;
  const registry = () => registerDefaultBookingEffects(new TransitionRegistry());
  const engine = () => h.engine(registry());
  const handlers = () => {
    const timerRegistry = new TimerHandlerRegistry();
    registerBookingTimerHandlers(
      timerRegistry,
      createBookingTimerHandlers({
        engine: engine(),
        outbox: h.services.outbox,
        hasPendingPayment: () => Promise.resolve(false),
      }),
    );
    return timerRegistry;
  };
  const runTimers = (timerRegistry = handlers()) =>
    runDueTimers(h.worker(), h.clock, timerRegistry);

  const timersOf = (bookingId: string) =>
    rows<{ timer_type: TimerType; status: string; due_at: Date }>(
      'SELECT timer_type::text AS timer_type, status::text AS status, due_at FROM timer WHERE aggregate_id = $1 ORDER BY timer_type',
      [bookingId],
    );
  const pending = async (bookingId: string) =>
    (await timersOf(bookingId)).filter((t) => t.status === 'PENDING').map((t) => t.timer_type);

  const move = (
    caller: ReturnType<typeof callers.checker>,
    bookingId: string,
    transitionId: Parameters<ReturnType<typeof engine>['transition']>[1]['transitionId'],
    input: Record<string, unknown> = {},
    reason?: string,
  ) =>
    as(caller, (tx) =>
      engine().transition(tx, {
        bookingId,
        transitionId,
        actor: caller.actor,
        input,
        ...(reason ? { reason } : {}),
      }),
    );

  const schedule = (bookingId: string, type: TimerType, dueAt: Date) =>
    as(callers.system(), (tx) =>
      h.services.timers.schedule(tx, {
        type,
        aggregate: { type: 'booking', id: bookingId },
        dueAt,
      }),
    );

  describe('default effects', () => {
    it('T-03 schedules the payment window and its reminder, and drops the lab decision timers', async () => {
      h.clock.set('2026-11-25T10:00:00Z');
      const id = await h.placeBooking('REQUESTED');
      const soon = new Date(h.clock.now().getTime() + 60 * MINUTE);
      await schedule(id, 'LAB_DECISION_DUE', soon);
      await schedule(id, 'LAB_DECISION_REMINDER_50', soon);
      await schedule(id, 'PAYMENT_RECONCILE', soon); // not a booking-state timer: left alone
      await move(callers.checker(), id, 'T-03');

      const timers = await timersOf(id);
      const by = (type: TimerType) => timers.find((t) => t.timer_type === type);
      expect(by('LAB_DECISION_DUE')?.status).toBe('CANCELLED');
      expect(by('LAB_DECISION_REMINDER_50')?.status).toBe('CANCELLED');
      expect(by('PAYMENT_RECONCILE')?.status).toBe('PENDING');
      expect(by('PAYMENT_DUE')).toMatchObject({ status: 'PENDING' });
      expect(by('PAYMENT_DUE')?.due_at.toISOString()).toBe('2026-11-26T10:00:00.000Z'); // 24 h, BR-030
      expect(by('PAYMENT_REMINDER')?.due_at.toISOString()).toBe('2026-11-26T08:00:00.000Z'); // 2 h before, BR-031
      const [booking] = await rows<{ payment_due_at: Date }>(
        'SELECT payment_due_at FROM booking WHERE id = $1',
        [id],
      );
      expect(booking?.payment_due_at.toISOString()).toBe('2026-11-26T10:00:00.000Z');
    });

    it('T-04, T-07, T-15, T-21, T-22 and T-25 start and stop their timers', async () => {
      h.clock.set('2026-11-25T10:00:00Z');
      const countered = await h.placeBooking('REQUESTED');
      await move(callers.checker(), countered, 'T-04');
      expect(await pending(countered)).toEqual(['COUNTER_RESPONSE_DUE']);
      expect((await timersOf(countered))[0]?.due_at.toISOString()).toBe('2026-11-26T10:00:00.000Z'); // BR-018
      await move(callers.requester(), countered, 'T-07');
      expect(await pending(countered)).toEqual(['PAYMENT_DUE', 'PAYMENT_REMINDER']);
      await move(callers.customerAdmin(), countered, 'T-25', {
        cancellationCodeNodeId: h.world().nodes.cancelReason,
      });
      expect(await pending(countered)).toEqual([]);

      const hold = await h.placeBooking('SAMPLE_RECORDED');
      await move(callers.checker(), hold, 'T-15', {}, 'discrepancy');
      expect(await pending(hold)).toEqual(['HOLD_DECISION_DUE']);
      expect((await timersOf(hold))[0]?.due_at.toISOString()).toBe('2026-11-26T10:00:00.000Z'); // BR-046
      await move(callers.requester(), hold, 'T-16');
      expect(await pending(hold)).toEqual([]);

      const released = await h.placeBooking('REPORT_IN_REVIEW');
      await move(callers.checker(), released, 'T-21');
      expect(await pending(released)).toEqual(['DISPUTE_WINDOW_END']);
      expect((await timersOf(released))[0]?.due_at.toISOString()).toBe('2026-11-28T10:00:00.000Z'); // 72 h
      const [row] = await rows<{ report_released_at: Date; dispute_window_ends_at: Date }>(
        'SELECT report_released_at, dispute_window_ends_at FROM booking WHERE id = $1',
        [released],
      );
      expect(row?.report_released_at.toISOString()).toBe('2026-11-25T10:00:00.000Z');
      expect(row?.dispute_window_ends_at.toISOString()).toBe('2026-11-28T10:00:00.000Z');
      await move(callers.finance(), released, 'T-22');
      expect(await pending(released)).toEqual([]);
    });

    it('keeps REPORT_DUE across a returned report and drops it when the report is released', async () => {
      const id = await h.placeBooking('UNDER_TEST');
      await schedule(id, 'REPORT_DUE', new Date('2026-12-20T00:00:00Z'));
      await move(callers.maker(), id, 'T-19');
      await move(callers.checker(), id, 'T-20', {}, 'fix the units');
      expect(await pending(id)).toEqual(['REPORT_DUE']);
      await move(callers.maker(), id, 'T-19');
      await move(callers.checker(), id, 'T-21');
      expect(await pending(id)).toEqual(['DISPUTE_WINDOW_END']);
    });

    it('T-02 leaves the booking timers alone', async () => {
      const id = await h.placeBooking('REQUESTED');
      await schedule(id, 'LAB_DECISION_DUE', new Date('2026-11-25T12:00:00Z'));
      await move(callers.requester(), id, 'T-02');
      expect(await pending(id)).toEqual(['LAB_DECISION_DUE']);
    });
  });

  describe('timer handlers', () => {
    it('LAB_DECISION_DUE applies T-06 once, as SYSTEM, and is idempotent', async () => {
      h.clock.set('2026-11-25T10:00:00Z');
      const id = await h.placeBooking('REQUESTED');
      await schedule(id, 'LAB_DECISION_DUE', new Date('2026-11-25T14:00:00Z'));
      h.clock.set('2026-11-25T14:00:01Z');
      const first = await runTimers();
      expect(first.fired).toBeGreaterThanOrEqual(1);
      const [booking] = await rows<{ status: string; lock_version: number }>(
        'SELECT status, lock_version FROM booking WHERE id = $1',
        [id],
      );
      expect(booking).toMatchObject({ status: 'EXPIRED', lock_version: 1 });
      const history = await rows<{
        transition_id: string;
        actor_party: string;
        actor_user_id: string | null;
      }>(
        'SELECT transition_id, actor_party, actor_user_id FROM booking_status_history WHERE booking_id = $1',
        [id],
      );
      expect(history).toEqual([
        { transition_id: 'T-06', actor_party: 'SYSTEM', actor_user_id: null },
      ]);
      const events = await rows<{ event_type: string }>(
        'SELECT event_type FROM outbox_event WHERE aggregate_id = $1',
        [id],
      );
      expect(events.map((e) => e.event_type)).toEqual(['booking.expired']);

      await runTimers();
      expect(
        await rows('SELECT 1 FROM booking_status_history WHERE booking_id = $1', [id]),
      ).toHaveLength(1);
    });

    it('does nothing, without error, when the booking has moved on', async () => {
      h.clock.set('2026-11-25T10:00:00Z');
      const id = await h.placeBooking('ACCEPTED');
      const timerId = (await schedule(id, 'LAB_DECISION_DUE', new Date('2026-11-25T11:00:00Z'))).id;
      h.clock.set('2026-11-25T11:00:01Z');
      await runTimers();
      const [timer] = await rows<{ status: string; attempts: number }>(
        'SELECT status, attempts FROM timer WHERE id = $1',
        [timerId],
      );
      expect(timer).toMatchObject({ status: 'FIRED', attempts: 0 });
      const [booking] = await rows<{ status: string; lock_version: number }>(
        'SELECT status, lock_version FROM booking WHERE id = $1',
        [id],
      );
      expect(booking).toMatchObject({ status: 'ACCEPTED', lock_version: 0 }); // untouched
      expect(
        await rows('SELECT 1 FROM booking_status_history WHERE booking_id = $1', [id]),
      ).toHaveLength(0);
    });

    it('a booking that does not exist is a no-op, not a failure', async () => {
      h.clock.set('2026-11-25T10:00:00Z');
      const timerId = (await schedule(uuid(), 'NO_SHOW_DUE', new Date('2026-11-25T10:30:00Z'))).id;
      h.clock.set('2026-11-25T10:30:01Z');
      await runTimers();
      const [timer] = await rows<{ status: string }>('SELECT status FROM timer WHERE id = $1', [
        timerId,
      ]);
      expect(timer?.status).toBe('FIRED');
    });

    it('NO_SHOW_DUE, COUNTER_RESPONSE_DUE and DISPUTE_WINDOW_END apply T-12, T-08 and T-23', async () => {
      h.clock.set('2026-11-25T10:00:00Z');
      const noShow = await h.placeBooking('HANDOVER_SET');
      const counter = await h.placeBooking('COUNTERED');
      const window = await h.placeBooking('REPORT_RELEASED');
      const due = new Date('2026-11-25T10:10:00Z');
      await schedule(noShow, 'NO_SHOW_DUE', due);
      await schedule(counter, 'COUNTER_RESPONSE_DUE', due);
      await schedule(window, 'DISPUTE_WINDOW_END', due);
      h.clock.set('2026-11-25T10:10:01Z');
      await runTimers();
      const status = async (id: string) =>
        (await rows<{ status: string }>('SELECT status FROM booking WHERE id = $1', [id]))[0]
          ?.status;
      expect(await status(noShow)).toBe('NO_SHOW');
      expect(await status(counter)).toBe('EXPIRED');
      expect(await status(window)).toBe('COMPLETED');
    });

    it('PAYMENT_DUE expires an unpaid booking only when the payments check says nothing is pending', async () => {
      h.clock.set('2026-11-25T10:00:00Z');
      const paying = await h.placeBooking('ACCEPTED');
      const lapsed = await h.placeBooking('ACCEPTED');
      const due = new Date('2026-11-25T10:10:00Z');
      await schedule(paying, 'PAYMENT_DUE', due);
      await schedule(lapsed, 'PAYMENT_DUE', due);
      h.clock.set('2026-11-25T10:10:01Z');
      const timerRegistry = new TimerHandlerRegistry();
      registerBookingTimerHandlers(
        timerRegistry,
        createBookingTimerHandlers({
          engine: engine(),
          outbox: h.services.outbox,
          hasPendingPayment: (_tx, bookingId) => Promise.resolve(bookingId === paying),
        }),
      );
      await runTimers(timerRegistry);
      const status = async (id: string) =>
        (await rows<{ status: string }>('SELECT status FROM booking WHERE id = $1', [id]))[0]
          ?.status;
      expect(await status(paying)).toBe('ACCEPTED');
      expect(await status(lapsed)).toBe('EXPIRED_UNPAID');
    });

    it('a reminder emits only its documented event, and only while the state matches', async () => {
      h.clock.set('2026-11-25T10:00:00Z');
      const waiting = await h.placeBooking('ACCEPTED');
      const paid = await h.placeBooking('HANDOVER_SET');
      const due = new Date('2026-11-25T10:20:00Z');
      await schedule(waiting, 'PAYMENT_REMINDER', due);
      await schedule(paid, 'PAYMENT_REMINDER', due);
      h.clock.set('2026-11-25T10:20:01Z');
      await runTimers();
      const events = await rows<{ aggregate_id: string; event_type: string; payload: unknown }>(
        'SELECT aggregate_id::text AS aggregate_id, event_type, payload FROM outbox_event WHERE aggregate_id = ANY($1::uuid[])',
        [[waiting, paid]],
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        aggregate_id: waiting,
        event_type: 'payment.window_ending',
      });
      expect((events[0]?.payload as { actor: unknown }).actor).toBe('SYSTEM');
    });

    it('without a payments check there is no PAYMENT_DUE handler', () => {
      const without = createBookingTimerHandlers({ engine: engine(), outbox: h.services.outbox });
      expect(without.PAYMENT_DUE).toBeUndefined();
      expect(without.LAB_DECISION_DUE).toBeDefined();
    });
  });

  describe('the main flow', () => {
    it('request, accept, pay, drop, receipt, approve, testing, report, release, completed', async () => {
      h.clock.set('2026-11-25T10:00:00Z');
      const w = h.world();
      const customer = callers.customerAdmin();
      const submitted = await as(customer, (tx) =>
        engine().submit(tx, {
          actor: customer.actor,
          booking: {
            bookingNo: 'LC-2611-77001',
            customerOrgId: w.orgs.customer,
            requesterUserId: w.users.customerAdmin,
            labSiteId: w.lab.site,
            labOrgId: w.lab.org,
            itemName: 'DEMO cement sample',
            declaredPackageCount: 1,
            preferredDropDate: new Date('2026-12-01T00:00:00Z'),
            priceListId: w.lab.priceList,
            subtotalPaise: 100_000n,
            gstPaise: 18_000n,
            totalPaise: 118_000n,
            labSnapshot: { site: 'DEMO' },
          },
        }),
      );
      const id = submitted.bookingId;
      const tick = () => {
        h.clock.advance(5 * MINUTE);
      };

      const steps: [
        ReturnType<typeof callers.checker>,
        Parameters<typeof move>[2],
        Record<string, unknown>,
        string | undefined,
      ][] = [
        [callers.checker(), 'T-03', {}, undefined],
        [callers.system('PAYMENTS'), 'T-09', {}, undefined],
        [callers.system(), 'T-11', {}, undefined],
        [callers.maker(), 'T-13', {}, undefined],
        [callers.checker(), 'T-14', {}, undefined],
        [callers.maker(), 'T-18', { expectedReportDate: '2026-12-10' }, undefined],
        [callers.maker(), 'T-19', {}, undefined],
        [callers.checker(), 'T-21', {}, undefined],
      ];
      for (const [caller, transitionId, input, reason] of steps) {
        tick();
        await move(caller, id, transitionId, input, reason);
      }
      expect(await pending(id)).toEqual(['DISPUTE_WINDOW_END']);

      // 72 h later the timer completes the booking.
      h.clock.advance(72 * 60 * MINUTE);
      await runTimers();

      const history = await rows<{
        transition_id: string;
        from_status: string | null;
        to_status: string;
      }>(
        'SELECT transition_id, from_status, to_status FROM booking_status_history WHERE booking_id = $1 ORDER BY occurred_at, id',
        [id],
      );
      expect(history.map((r) => `${r.transition_id}:${r.to_status}`)).toEqual([
        'T-01:REQUESTED',
        'T-03:ACCEPTED',
        'T-09:PAID',
        'T-11:HANDOVER_SET',
        'T-13:SAMPLE_RECORDED',
        'T-14:RECEIVED',
        'T-18:UNDER_TEST',
        'T-19:REPORT_IN_REVIEW',
        'T-21:REPORT_RELEASED',
        'T-23:COMPLETED',
      ]);
      // each row continues from the previous one
      for (const [i, row] of history.slice(1).entries()) {
        expect(row.from_status).toBe(history[i]?.to_status);
      }

      const [booking] = await rows<{
        status: string;
        lock_version: number;
        completed_at: Date | null;
      }>('SELECT status, lock_version, completed_at FROM booking WHERE id = $1', [id]);
      expect(booking).toMatchObject({ status: 'COMPLETED', lock_version: 9 });
      expect(booking?.completed_at).not.toBeNull();
      const audit = await rows('SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = $2', [
        id,
        'booking.transition',
      ]);
      expect(audit).toHaveLength(10);
      const events = await rows<{ event_type: string }>(
        'SELECT event_type FROM outbox_event WHERE aggregate_id = $1 ORDER BY id',
        [id],
      );
      expect(events.map((e) => e.event_type)).toEqual([
        'booking.requested',
        'booking.accepted',
        'payment.succeeded',
        'receipt.recorded',
        'receipt.approved',
        'testing.started',
        'report.submitted',
        'report.released',
      ]);
      expect(await pending(id)).toEqual([]);
    });

    it('a BookingError is what callers see (and carries the catalogue code)', async () => {
      const id = await h.placeBooking('COMPLETED');
      const caller = callers.checker();
      const error = await move(caller, id, 'T-03').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BookingError);
      expect((error as BookingError).status).toBe(409);
    });
  });
});
