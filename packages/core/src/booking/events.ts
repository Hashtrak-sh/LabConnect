import type { TransitionId } from '@labconnect/shared';
import type { BookingActor } from './types.js';

/**
 * The event codes of a transition (BOOKING_STATE_MACHINE.md section 3: "Every transition
 * writes ... outbox_event"). The table names an event for only some transitions and never
 * its code; the codes come from the Trigger column of `docs/01-product/NOTIFICATIONS_MATRIX.md`,
 * which names the state or transition that raises each event. Where that matrix gives a
 * state, every transition into the state raises it.
 *
 * Transitions with no event (nothing in the matrix is raised by them):
 * - T-02 `EditBooking`: no event; the state does not change.
 * - T-09 `ConfirmPayment`: the matrix puts `payment.succeeded` on "PAID -> HANDOVER_SET",
 *   that is T-11, where the receipt, instructions and QR exist (OQ-99).
 * - T-23 `CompleteBooking`: COMPLETED has no event in the matrix (`payout.released` belongs
 *   to the payout).
 * - T-24 `ResolveDispute`: `dispute.decided` belongs to the disputes module, which writes
 *   the decision (OQ-99).
 */
const EVENTS: Readonly<Record<TransitionId, readonly string[]>> = {
  'T-01': ['booking.requested'],
  'T-02': [],
  'T-03': ['booking.accepted'],
  'T-04': ['booking.countered'],
  'T-05': ['booking.rejected'],
  'T-06': ['booking.expired'],
  // The customer answered the counter ("Counter accepted or declined") and the payment window opened.
  'T-07': ['booking.accepted', 'booking.counter_response'],
  'T-08': ['booking.expired'],
  'T-09': [],
  'T-10': ['payment.expired'],
  'T-11': ['payment.succeeded'],
  'T-12': ['booking.no_show'],
  'T-13': ['receipt.recorded'],
  'T-14': ['receipt.approved'],
  'T-15': ['receipt.on_hold'],
  // RECEIVED is the trigger of `receipt.approved` ("Received, ETA"), however the booking got there.
  'T-16': ['receipt.approved'],
  // The Checker has to look at the replacement receipt: SAMPLE_RECORDED is the trigger of `receipt.recorded`.
  'T-17': ['receipt.recorded'],
  'T-18': ['testing.started'],
  'T-19': ['report.submitted'],
  'T-20': ['report.returned'],
  'T-21': ['report.released'],
  'T-22': ['dispute.opened'],
  'T-23': [],
  'T-24': [],
  'T-25': ['booking.cancelled'],
  'T-26': ['booking.cancelled'],
  'T-27': ['booking.cancelled'],
  'T-28': ['booking.cancelled'],
};

/** Transitions for which the table raises no event at all. */
export const TRANSITIONS_WITHOUT_EVENT: readonly TransitionId[] = (
  Object.keys(EVENTS) as TransitionId[]
).filter((id) => EVENTS[id].length === 0);

export function eventTypesFor(transitionId: TransitionId, actor: BookingActor): string[] {
  const types = [...EVENTS[transitionId]];
  // T-08: the customer declining is a counter response; a lapse is not ("accepted or declined").
  if (transitionId === 'T-08' && actor.kind === 'USER') types.push('booking.counter_response');
  return types;
}
