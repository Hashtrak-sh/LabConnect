import type { PartyType } from '@labconnect/database';
import { ROLES } from '@labconnect/shared';
import { BookingError } from './errors.js';
import { configParsers } from '../platform/config-parameters.js';
import type { BookingActor, BookingColumns, TransitionContext } from './types.js';

/** Config keys (seeds in packages/database/src/seed/reference-data.ts) the engine reads. */
export const BOOKING_CONFIG_KEYS = {
  paymentWindowMinutes: 'payment.window_minutes', // BR-030
  paymentReminderBeforeMinutes: 'payment.reminder_before_minutes', // BR-031
  counterResponseMinutes: 'booking.counter_response_minutes', // BR-018
  holdDecisionMinutes: 'handover.hold_decision_minutes', // BR-046
  disputeWindowMinutes: 'dispute.window_minutes', // BR-077, BR-080
} as const;

const MS_PER_MINUTE = 60_000;

export function addMinutes(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * MS_PER_MINUTE);
}

/** The `party_type` of an actor, as written to the status history and `cancelled_by_party`. */
export function partyOf(actor: BookingActor): PartyType {
  if (actor.kind === 'SYSTEM') return 'SYSTEM';
  switch (ROLES[actor.role].orgType) {
    case 'CUSTOMER':
      return 'CUSTOMER';
    case 'LAB':
      return 'LAB';
    case 'PLATFORM':
      return 'PLATFORM';
  }
}

function invalid(field: string, message: string): BookingError {
  return new BookingError('VALIDATION_FAILED', {
    detail: message,
    meta: { fields: [field] },
  });
}

function text(
  input: Readonly<Record<string, unknown>> | undefined,
  field: string,
): string | undefined {
  const value = input?.[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalid(field, `${field} must be a string.`);
  return value;
}

function requiredText(input: Readonly<Record<string, unknown>> | undefined, field: string): string {
  const value = text(input, field);
  if (value === undefined || value.trim().length === 0)
    throw invalid(field, `${field} is required.`);
  return value;
}

function isoDate(value: string, field: string): Date {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : undefined;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw invalid(field, `${field} must be a date as YYYY-MM-DD.`);
  }
  return parsed;
}

/**
 * Checks that the documents state as plain "required" inputs of a transition, and the
 * columns of `booking` that the new state fixes: those the CHECK constraints need in the
 * same UPDATE as the status (C-44) and the status timestamps the schema has. Everything
 * here comes from BOOKING_STATE_MACHINE.md section 3 or the schema; nothing needs another
 * module's data.
 *
 * - T-03, T-07 (to ACCEPTED): `payment_due_at` = now + `payment.window_minutes` (BR-030).
 * - T-05: `rejection_reason_node_id` ("reason_code required"). `input.rejectionReasonNodeId`.
 * - T-25 to T-28 (to CANCELLED): `cancellation_code_node_id` (`input.cancellationCodeNodeId`),
 *   `cancelled_by_party` from the actor, optional `cancellation_notes`.
 * - T-15 and T-28: a `reason` ("Reason required").
 * - T-16: `deviation_noted` ("Deviation flag on booking"), optional `deviation_notes`.
 * - T-18: `expected_report_date` ("required"), `input.expectedReportDate` as YYYY-MM-DD.
 * - T-21: `report_released_at` and `dispute_window_ends_at` = now + `dispute.window_minutes`.
 * - to COMPLETED: `completed_at`.
 */
export async function statusColumns(context: TransitionContext): Promise<BookingColumns> {
  const { transition, command, now, tx, services } = context;
  const input = command.input;
  const columns: BookingColumns = {};

  if (transition.id === 'T-15' || transition.id === 'T-28') {
    if (command.reason === undefined || command.reason.trim().length === 0) {
      throw invalid('reason', 'A reason is required.');
    }
  }

  switch (transition.to) {
    case 'ACCEPTED': {
      const minutes = await services.config.get(
        tx,
        BOOKING_CONFIG_KEYS.paymentWindowMinutes,
        configParsers.positiveInteger,
      );
      columns.paymentDueAt = addMinutes(now, minutes);
      break;
    }
    case 'REJECTED':
      columns.rejectionReasonNodeId = requiredText(input, 'rejectionReasonNodeId');
      columns.rejectionNotes = text(input, 'rejectionNotes') ?? null;
      break;
    case 'CANCELLED':
      columns.cancellationCodeNodeId = requiredText(input, 'cancellationCodeNodeId');
      columns.cancelledByParty = partyOf(command.actor);
      columns.cancellationNotes = text(input, 'cancellationNotes') ?? null;
      break;
    case 'COMPLETED':
      columns.completedAt = now;
      break;
    case 'REPORT_RELEASED': {
      const minutes = await services.config.get(
        tx,
        BOOKING_CONFIG_KEYS.disputeWindowMinutes,
        configParsers.positiveInteger,
      );
      columns.reportReleasedAt = now;
      columns.disputeWindowEndsAt = addMinutes(now, minutes);
      break;
    }
    default:
      break;
  }

  if (transition.id === 'T-16') {
    columns.deviationNoted = true;
    const notes = text(input, 'deviationNotes');
    if (notes !== undefined) columns.deviationNotes = notes;
  }
  if (transition.id === 'T-18') {
    columns.expectedReportDate = isoDate(
      requiredText(input, 'expectedReportDate'),
      'expectedReportDate',
    );
  }
  return columns;
}
