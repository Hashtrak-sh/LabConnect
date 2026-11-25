import type { Prisma, TimerType } from '@labconnect/database';
import type { BookingStatus, TransitionId } from '@labconnect/shared';
import type { OutboxService } from '../platform/outbox.js';
import type { DueTimer, TimerHandler, TimerHandlerRegistry } from '../platform/timers.js';
import { BOOKING_AGGREGATE } from './default-effects.js';
import type { BookingEngine } from './engine.js';

/**
 * Expiry timers whose documented effect is "apply transition T-xx if the booking is still in
 * state S" (BOOKING_STATE_MACHINE.md section 3, rules: "Timers check the current state when
 * they fire and do nothing if it has moved on").
 */
const EXPIRY_TIMERS: Readonly<
  Partial<Record<TimerType, { transition: TransitionId; from: BookingStatus }>>
> = {
  LAB_DECISION_DUE: { transition: 'T-06', from: 'REQUESTED' }, // ExpireDecision
  COUNTER_RESPONSE_DUE: { transition: 'T-08', from: 'COUNTERED' }, // ExpireCounter
  PAYMENT_DUE: { transition: 'T-10', from: 'ACCEPTED' }, // ExpirePayment
  NO_SHOW_DUE: { transition: 'T-12', from: 'HANDOVER_SET' }, // MarkNoShow
  DISPUTE_WINDOW_END: { transition: 'T-23', from: 'REPORT_RELEASED' }, // CompleteBooking
};

/**
 * Reminder timers: while the booking is in the state, emit the one event code
 * NOTIFICATIONS_MATRIX.md assigns to the timer, and nothing else (no transition, no data
 * beyond ids and the state). `HOLD_DECISION_DUE` is the expiry of the hold window: BR-047 says
 * escalate to Ops (`hold.escalated`), never cancel automatically.
 */
const REMINDER_TIMERS: Readonly<
  Partial<Record<TimerType, { status: BookingStatus; event: string }>>
> = {
  LAB_DECISION_REMINDER_50: { status: 'REQUESTED', event: 'booking.sla_reminder' },
  LAB_DECISION_REMINDER_90: { status: 'REQUESTED', event: 'booking.sla_reminder' },
  PAYMENT_REMINDER: { status: 'ACCEPTED', event: 'payment.window_ending' },
  DROP_REMINDER: { status: 'HANDOVER_SET', event: 'handover.deadline_approaching' },
  DROP_DEADLINE: { status: 'HANDOVER_SET', event: 'handover.overdue' },
  RECEIPT_APPROVAL_REMINDER: { status: 'SAMPLE_RECORDED', event: 'approval.sla_reminder' },
  REPORT_APPROVAL_REMINDER: { status: 'REPORT_IN_REVIEW', event: 'approval.sla_reminder' },
  HOLD_DECISION_DUE: { status: 'ON_HOLD', event: 'hold.escalated' },
};

export interface BookingTimerHandlerDeps {
  engine: BookingEngine;
  outbox: OutboxService;
  /**
   * BR-032: a payment order that is still pending at the end of the payment window extends
   * the window instead of expiring the booking (T-10 guard "No pending payment order"). That
   * data belongs to the payments module, so the app passes a check. Without it the
   * `PAYMENT_DUE` timer gets no handler: expiring a booking that is being paid is worse than
   * not expiring it (OQ-100).
   */
  hasPendingPayment?: (tx: Prisma.TransactionClient, bookingId: string) => Promise<boolean>;
}

export type BookingTimerHandlers = Partial<Record<TimerType, TimerHandler>>;

/**
 * Timer handlers of the booking module, by timer type. Each re-checks the booking's state
 * and silently does nothing if it has moved on, or the booking is not there. Run them in the
 * system context (the timer runner does).
 */
export function createBookingTimerHandlers(deps: BookingTimerHandlerDeps): BookingTimerHandlers {
  const handlers: BookingTimerHandlers = {};

  for (const [type, rule] of Object.entries(EXPIRY_TIMERS) as [
    TimerType,
    { transition: TransitionId; from: BookingStatus },
  ][]) {
    if (type === 'PAYMENT_DUE' && !deps.hasPendingPayment) continue;
    handlers[type] = async (tx, timer) => {
      if (timer.aggregate.type !== BOOKING_AGGREGATE) return;
      if (type === 'PAYMENT_DUE' && (await deps.hasPendingPayment?.(tx, timer.aggregate.id))) {
        return; // the payments module extends the window (BR-032)
      }
      await deps.engine.transitionIfStatus(
        tx,
        {
          bookingId: timer.aggregate.id,
          transitionId: rule.transition,
          actor: { kind: 'SYSTEM' },
          reason: `Timer ${type}`,
        },
        rule.from,
      );
    };
  }

  for (const [type, rule] of Object.entries(REMINDER_TIMERS) as [
    TimerType,
    { status: BookingStatus; event: string },
  ][]) {
    handlers[type] = (tx, timer) => remind(deps.outbox, tx, timer, rule);
  }
  return handlers;
}

async function remind(
  outbox: OutboxService,
  tx: Prisma.TransactionClient,
  timer: DueTimer,
  rule: { status: BookingStatus; event: string },
): Promise<void> {
  if (timer.aggregate.type !== BOOKING_AGGREGATE) return;
  const booking = await tx.booking.findUnique({
    where: { id: timer.aggregate.id },
    select: { status: true },
  });
  if (booking?.status !== rule.status) return;
  await outbox.enqueue(tx, {
    type: rule.event,
    aggregate: { type: BOOKING_AGGREGATE, id: timer.aggregate.id },
    actor: 'SYSTEM',
    data: { bookingId: timer.aggregate.id, status: rule.status, timerType: timer.type },
  });
}

/** Adds the handlers to a registry such as the worker's `TIMER_HANDLERS`. */
export function registerBookingTimerHandlers(
  registry: TimerHandlerRegistry,
  handlers: BookingTimerHandlers,
): void {
  for (const [type, handler] of Object.entries(handlers) as [TimerType, TimerHandler][]) {
    registry.register(type, handler);
  }
}
