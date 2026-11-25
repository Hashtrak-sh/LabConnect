import type { TimerType } from '@labconnect/database';
import type { BookingStatus } from '@labconnect/shared';
import { configParsers } from '../platform/config-parameters.js';
import type { TimerAggregate } from '../platform/timers.js';
import type { TransitionRegistry } from './registry.js';
import { addMinutes, BOOKING_CONFIG_KEYS } from './status-columns.js';
import type { EffectContext } from './types.js';

export const BOOKING_AGGREGATE = 'booking';

export const bookingAggregate = (bookingId: string): TimerAggregate => ({
  type: BOOKING_AGGREGATE,
  id: bookingId,
});

/**
 * The states in which each booking timer is meaningful: a timer scheduled when the booking
 * enters one of them is obsolete once the booking is in any other state. Read off
 * BOOKING_STATE_MACHINE.md section 3 (the transition that schedules the timer and the states
 * its command is accepted in) and the timer list of AUDIT_AND_EVENT_ARCHITECTURE.md section 4.
 *
 * - `REPORT_DUE` spans UNDER_TEST and REPORT_IN_REVIEW: a returned report (T-20) goes back to
 *   UNDER_TEST, and the lab's ETA keeps running.
 * - `DISPUTE_WINDOW_END` ends with REPORT_RELEASED: a dispute (T-22) makes T-23 impossible.
 * - `PAYMENT_RECONCILE` is left out on purpose. It is the payments module's timer, and the
 *   documents do not say which aggregate it is scheduled on (OQ-96).
 */
export const TIMER_LIVE_STATES: Readonly<Partial<Record<TimerType, readonly BookingStatus[]>>> = {
  LAB_DECISION_REMINDER_50: ['REQUESTED'],
  LAB_DECISION_REMINDER_90: ['REQUESTED'],
  LAB_DECISION_DUE: ['REQUESTED'],
  COUNTER_RESPONSE_DUE: ['COUNTERED'],
  PAYMENT_REMINDER: ['ACCEPTED'],
  PAYMENT_DUE: ['ACCEPTED'],
  DROP_REMINDER: ['HANDOVER_SET'],
  DROP_DEADLINE: ['HANDOVER_SET'],
  NO_SHOW_DUE: ['HANDOVER_SET'],
  RECEIPT_APPROVAL_REMINDER: ['SAMPLE_RECORDED'],
  HOLD_DECISION_DUE: ['ON_HOLD'],
  REPORT_DUE: ['UNDER_TEST', 'REPORT_IN_REVIEW'],
  REPORT_APPROVAL_REMINDER: ['REPORT_IN_REVIEW'],
  DISPUTE_WINDOW_END: ['REPORT_RELEASED'],
};

/** The timer types that are obsolete when a booking is in `status`. */
export function timersObsoleteIn(status: BookingStatus): TimerType[] {
  return (Object.keys(TIMER_LIVE_STATES) as TimerType[]).filter(
    (type) => !TIMER_LIVE_STATES[type]?.includes(status),
  );
}

async function minutesOf(context: EffectContext, key: string): Promise<number> {
  return context.services.config.get(context.tx, key, configParsers.positiveInteger);
}

/**
 * Registers the timer effects the state machine fully specifies. Each one names an exact
 * timer type and a duration that a config parameter of the seeds already holds, and needs
 * nothing outside the booking row:
 *
 * - every transition: cancel the booking's pending timers that the new state makes obsolete;
 * - T-03, T-07: `PAYMENT_DUE` at `payment_due_at` (24 h, BR-030) and `PAYMENT_REMINDER` 2 h
 *   before it (BR-031);
 * - T-04: `COUNTER_RESPONSE_DUE` after `booking.counter_response_minutes` (24 h, BR-018);
 * - T-15: `HOLD_DECISION_DUE` after `handover.hold_decision_minutes` (24 h, BR-046);
 * - T-21: `DISPUTE_WINDOW_END` at `dispute_window_ends_at` (72 h, BR-077).
 *
 * Not registered, for lack of specification (OQ-96): T-01 `LAB_DECISION_DUE` and its
 * reminders and T-02's restart (business hours of the lab site, and the "SLA + grace"
 * duration is not stated precisely), T-11 `DROP_DEADLINE`/`NO_SHOW_DUE` (BR-040 needs the
 * slot date and the lab's allowance), T-13 and T-19 approval reminders (business time, and
 * "50% and 90%" are two instants for one timer type), T-18 `REPORT_DUE` (a date, no time of day).
 */
export function registerDefaultBookingEffects(registry: TransitionRegistry): TransitionRegistry {
  registry.addEffect('ALL', {
    name: 'booking.cancel-obsolete-timers',
    async run(context) {
      // T-02 stays in REQUESTED; restarting its SLA timers is the edit feature's job.
      if (context.fromStatus === context.transition.to) return;
      const types = timersObsoleteIn(context.transition.to);
      if (types.length === 0) return;
      await context.services.timers.cancelForAggregate(
        context.tx,
        bookingAggregate(context.updated.id),
        types,
      );
    },
  });

  registry.addEffect(['T-03', 'T-07'], {
    name: 'booking.schedule-payment-timers',
    async run(context) {
      const due = context.updated.paymentDueAt;
      if (due === null) throw new Error('payment_due_at was not set for an accepted booking.');
      const aggregate = bookingAggregate(context.updated.id);
      await context.services.timers.schedule(context.tx, {
        type: 'PAYMENT_DUE',
        aggregate,
        dueAt: due,
      });
      const reminder = addMinutes(
        due,
        -(await minutesOf(context, BOOKING_CONFIG_KEYS.paymentReminderBeforeMinutes)),
      );
      if (reminder.getTime() > context.now.getTime()) {
        await context.services.timers.schedule(context.tx, {
          type: 'PAYMENT_REMINDER',
          aggregate,
          dueAt: reminder,
        });
      }
    },
  });

  registry.addEffect('T-04', {
    name: 'booking.schedule-counter-response-timer',
    async run(context) {
      const minutes = await minutesOf(context, BOOKING_CONFIG_KEYS.counterResponseMinutes);
      await context.services.timers.schedule(context.tx, {
        type: 'COUNTER_RESPONSE_DUE',
        aggregate: bookingAggregate(context.updated.id),
        dueAt: addMinutes(context.now, minutes),
      });
    },
  });

  registry.addEffect('T-15', {
    name: 'booking.schedule-hold-decision-timer',
    async run(context) {
      const minutes = await minutesOf(context, BOOKING_CONFIG_KEYS.holdDecisionMinutes);
      await context.services.timers.schedule(context.tx, {
        type: 'HOLD_DECISION_DUE',
        aggregate: bookingAggregate(context.updated.id),
        dueAt: addMinutes(context.now, minutes),
      });
    },
  });

  registry.addEffect('T-21', {
    name: 'booking.schedule-dispute-window-timer',
    async run(context) {
      const due = context.updated.disputeWindowEndsAt;
      if (due === null)
        throw new Error('dispute_window_ends_at was not set for a released report.');
      await context.services.timers.schedule(context.tx, {
        type: 'DISPUTE_WINDOW_END',
        aggregate: bookingAggregate(context.updated.id),
        dueAt: due,
      });
    },
  });

  return registry;
}
