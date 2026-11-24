// The booking state machine as pure data.
// Source: docs/02-architecture/BOOKING_STATE_MACHINE.md (§1 states, §3 transitions, §4 sub-states).
// test/booking-state-machine.doc.test.ts asserts equality with §1, §2 and §3 of the document
// and with the booking_transition rows of the reference-data migration.
//
// Guards and side effects are not modelled here: they belong to the BookingEngine (P3-07).

import type { RoleCode } from './permissions.js';

/** Equal to the Prisma enum `BookingStatus`, in the order of §1. */
export const BOOKING_STATUSES = [
  'REQUESTED',
  'COUNTERED',
  'ACCEPTED',
  'PAID',
  'HANDOVER_SET',
  'SAMPLE_RECORDED',
  'ON_HOLD',
  'RECEIVED',
  'UNDER_TEST',
  'REPORT_IN_REVIEW',
  'REPORT_RELEASED',
  'DISPUTED',
  'COMPLETED',
  'REJECTED',
  'EXPIRED',
  'EXPIRED_UNPAID',
  'NO_SHOW',
  'CANCELLED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** The Category column of §1. A transient state is left by the system immediately. */
export type BookingStatusCategory = 'active' | 'transient' | 'terminal';

export const BOOKING_STATUS_CATEGORIES: Readonly<Record<BookingStatus, BookingStatusCategory>> = {
  REQUESTED: 'active',
  COUNTERED: 'active',
  ACCEPTED: 'active',
  PAID: 'transient',
  HANDOVER_SET: 'active',
  SAMPLE_RECORDED: 'active',
  ON_HOLD: 'active',
  RECEIVED: 'active',
  UNDER_TEST: 'active',
  REPORT_IN_REVIEW: 'active',
  REPORT_RELEASED: 'active',
  DISPUTED: 'active',
  COMPLETED: 'terminal',
  REJECTED: 'terminal',
  EXPIRED: 'terminal',
  EXPIRED_UNPAID: 'terminal',
  NO_SHOW: 'terminal',
  CANCELLED: 'terminal',
};

export const TERMINAL_BOOKING_STATUSES: readonly BookingStatus[] = BOOKING_STATUSES.filter(
  (status) => BOOKING_STATUS_CATEGORIES[status] === 'terminal',
);

export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === 'string' && (BOOKING_STATUSES as readonly string[]).includes(value);
}

export function isTerminalStatus(status: BookingStatus): boolean {
  return BOOKING_STATUS_CATEGORIES[status] === 'terminal';
}

/** The commands of §3. */
export const BOOKING_COMMANDS = [
  'SubmitBooking',
  'EditBooking',
  'AcceptBooking',
  'CounterBooking',
  'RejectBooking',
  'ExpireDecision',
  'AcceptCounter',
  'DeclineCounter',
  'ExpireCounter',
  'ConfirmPayment',
  'ExpirePayment',
  'IssueHandover',
  'MarkNoShow',
  'SubmitReceipt',
  'ApproveReceipt',
  'ConfirmDiscrepancy',
  'CustomerProceed',
  'SubmitReplacementReceipt',
  'StartTesting',
  'SubmitReport',
  'ReturnReport',
  'PublishReport',
  'RaiseDispute',
  'CompleteBooking',
  'ResolveDispute',
  'CancelBooking',
  'RejectSample',
] as const;
export type BookingCommand = (typeof BOOKING_COMMANDS)[number];

/**
 * Qualifiers that §3 writes next to a role:
 * `OWN` "C-Req (own)", `OF_SITE` "L-Checker of the site", `ON_BEHALF` "(Ops on behalf)".
 */
export type RoleActorQualifier = 'OWN' | 'OF_SITE' | 'ON_BEHALF';

/** What triggers a system actor where §3 names it: "system (Payments)", "system (EC-01)". */
export type SystemActorSource = 'PAYMENTS' | 'EC-01';

/**
 * An actor of §3. `OWNER` is the booking's owner, whatever customer role they hold; `SYSTEM` is a
 * timer, a worker or another module. `Ops` and `P-Ops` in §3 are both `PLATFORM_OPS`.
 */
export type TransitionActor =
  | { readonly kind: 'ROLE'; readonly role: RoleCode; readonly qualifier?: RoleActorQualifier }
  | { readonly kind: 'OWNER' }
  | { readonly kind: 'SYSTEM'; readonly source?: SystemActorSource };

export interface TransitionCommand {
  readonly name: BookingCommand;
  readonly actors: readonly TransitionActor[];
}

export const TRANSITION_IDS = [
  'T-01',
  'T-02',
  'T-03',
  'T-04',
  'T-05',
  'T-06',
  'T-07',
  'T-08',
  'T-09',
  'T-10',
  'T-11',
  'T-12',
  'T-13',
  'T-14',
  'T-15',
  'T-16',
  'T-17',
  'T-18',
  'T-19',
  'T-20',
  'T-21',
  'T-22',
  'T-23',
  'T-24',
  'T-25',
  'T-26',
  'T-27',
  'T-28',
] as const;
export type TransitionId = (typeof TRANSITION_IDS)[number];

export function isTransitionId(value: unknown): value is TransitionId {
  return typeof value === 'string' && (TRANSITION_IDS as readonly string[]).includes(value);
}

export interface BookingTransition {
  readonly id: TransitionId;
  /** The states the transition leaves. Empty only for T-01, which creates the booking. */
  readonly from: readonly BookingStatus[];
  readonly to: BookingStatus;
  /**
   * Usually one command. T-08 has two (`DeclineCounter` by the owner, `ExpireCounter` by the
   * system), so each command carries its own actors.
   */
  readonly commands: readonly TransitionCommand[];
}

const role = (code: RoleCode, qualifier?: RoleActorQualifier): TransitionActor =>
  qualifier ? { kind: 'ROLE', role: code, qualifier } : { kind: 'ROLE', role: code };
const OWNER: TransitionActor = { kind: 'OWNER' };
const SYSTEM: TransitionActor = { kind: 'SYSTEM' };
const C_ADMIN = role('CUSTOMER_ADMIN');
const L_CHECKER = role('LAB_CHECKER');
const L_MAKER = role('LAB_MAKER');
const OPS = role('PLATFORM_OPS');
const SYSTEM_EC_01: TransitionActor = { kind: 'SYSTEM', source: 'EC-01' };

function single(name: BookingCommand, ...actors: TransitionActor[]): TransitionCommand[] {
  return [{ name, actors }];
}

/** The transition table of §3, in order. */
export const BOOKING_TRANSITIONS: readonly BookingTransition[] = [
  {
    id: 'T-01',
    from: [],
    to: 'REQUESTED',
    commands: single(
      'SubmitBooking',
      C_ADMIN,
      role('CUSTOMER_REQUESTER'),
      role('PLATFORM_OPS', 'ON_BEHALF'),
    ),
  },
  {
    id: 'T-02',
    from: ['REQUESTED'],
    to: 'REQUESTED',
    commands: single('EditBooking', OWNER, C_ADMIN),
  },
  {
    id: 'T-03',
    from: ['REQUESTED'],
    to: 'ACCEPTED',
    commands: single('AcceptBooking', role('LAB_CHECKER', 'OF_SITE')),
  },
  {
    id: 'T-04',
    from: ['REQUESTED'],
    to: 'COUNTERED',
    commands: single('CounterBooking', L_CHECKER),
  },
  { id: 'T-05', from: ['REQUESTED'], to: 'REJECTED', commands: single('RejectBooking', L_CHECKER) },
  { id: 'T-06', from: ['REQUESTED'], to: 'EXPIRED', commands: single('ExpireDecision', SYSTEM) },
  {
    id: 'T-07',
    from: ['COUNTERED'],
    to: 'ACCEPTED',
    commands: single('AcceptCounter', OWNER, C_ADMIN),
  },
  {
    id: 'T-08',
    from: ['COUNTERED'],
    to: 'EXPIRED',
    commands: [
      { name: 'DeclineCounter', actors: [OWNER] },
      { name: 'ExpireCounter', actors: [SYSTEM] },
    ],
  },
  {
    id: 'T-09',
    from: ['ACCEPTED'],
    to: 'PAID',
    commands: single('ConfirmPayment', { kind: 'SYSTEM', source: 'PAYMENTS' }),
  },
  {
    id: 'T-10',
    from: ['ACCEPTED'],
    to: 'EXPIRED_UNPAID',
    commands: single('ExpirePayment', SYSTEM),
  },
  { id: 'T-11', from: ['PAID'], to: 'HANDOVER_SET', commands: single('IssueHandover', SYSTEM) },
  { id: 'T-12', from: ['HANDOVER_SET'], to: 'NO_SHOW', commands: single('MarkNoShow', SYSTEM) },
  {
    id: 'T-13',
    from: ['HANDOVER_SET'],
    to: 'SAMPLE_RECORDED',
    commands: single('SubmitReceipt', role('LAB_MAKER', 'OF_SITE')),
  },
  {
    id: 'T-14',
    from: ['SAMPLE_RECORDED'],
    to: 'RECEIVED',
    commands: single('ApproveReceipt', L_CHECKER),
  },
  {
    id: 'T-15',
    from: ['SAMPLE_RECORDED'],
    to: 'ON_HOLD',
    commands: single('ConfirmDiscrepancy', L_CHECKER),
  },
  {
    id: 'T-16',
    from: ['ON_HOLD'],
    to: 'RECEIVED',
    commands: single('CustomerProceed', OWNER, C_ADMIN),
  },
  {
    id: 'T-17',
    from: ['ON_HOLD'],
    to: 'SAMPLE_RECORDED',
    commands: single('SubmitReplacementReceipt', L_MAKER),
  },
  {
    id: 'T-18',
    from: ['RECEIVED'],
    to: 'UNDER_TEST',
    commands: single('StartTesting', L_MAKER),
  },
  {
    id: 'T-19',
    from: ['UNDER_TEST'],
    to: 'REPORT_IN_REVIEW',
    commands: single('SubmitReport', L_MAKER),
  },
  {
    id: 'T-20',
    from: ['REPORT_IN_REVIEW'],
    to: 'UNDER_TEST',
    commands: single('ReturnReport', L_CHECKER),
  },
  {
    id: 'T-21',
    from: ['REPORT_IN_REVIEW'],
    to: 'REPORT_RELEASED',
    commands: single('PublishReport', L_CHECKER),
  },
  {
    id: 'T-22',
    from: ['REPORT_RELEASED'],
    to: 'DISPUTED',
    commands: single(
      'RaiseDispute',
      C_ADMIN,
      role('CUSTOMER_REQUESTER', 'OWN'),
      role('CUSTOMER_FINANCE'),
      L_CHECKER,
    ),
  },
  {
    id: 'T-23',
    from: ['REPORT_RELEASED'],
    to: 'COMPLETED',
    commands: single('CompleteBooking', SYSTEM),
  },
  {
    id: 'T-24',
    from: ['DISPUTED'],
    to: 'COMPLETED',
    commands: single('ResolveDispute', OPS, SYSTEM),
  },
  {
    id: 'T-25',
    from: ['REQUESTED', 'COUNTERED', 'ACCEPTED'],
    to: 'CANCELLED',
    commands: single('CancelBooking', OWNER, C_ADMIN, OPS, SYSTEM_EC_01),
  },
  {
    id: 'T-26',
    from: ['HANDOVER_SET'],
    to: 'CANCELLED',
    commands: single('CancelBooking', OWNER, C_ADMIN, L_CHECKER, OPS, SYSTEM_EC_01),
  },
  {
    id: 'T-27',
    from: ['SAMPLE_RECORDED', 'ON_HOLD', 'RECEIVED', 'UNDER_TEST'],
    to: 'CANCELLED',
    commands: single('CancelBooking', OWNER, C_ADMIN, L_CHECKER, OPS, SYSTEM_EC_01),
  },
  {
    id: 'T-28',
    from: ['SAMPLE_RECORDED'],
    to: 'CANCELLED',
    commands: single('RejectSample', L_CHECKER),
  },
];

// The tests assert that BOOKING_TRANSITIONS lists every TransitionId exactly once.
const BY_ID = Object.fromEntries(
  BOOKING_TRANSITIONS.map((transition) => [transition.id, transition]),
) as Readonly<Record<TransitionId, BookingTransition>>;

export function findTransition(id: TransitionId): BookingTransition {
  return BY_ID[id];
}

/** The transitions that may leave the given state. */
export function transitionsFrom(status: BookingStatus): BookingTransition[] {
  return BOOKING_TRANSITIONS.filter((transition) => transition.from.includes(status));
}

/**
 * True when transition `id` moves a booking from `from` to `to`. `from` is `null` only for T-01,
 * which creates the booking.
 */
export function canTransition(
  id: TransitionId,
  from: BookingStatus | null,
  to: BookingStatus,
): boolean {
  const transition = findTransition(id);
  if (transition.to !== to) return false;
  return from === null ? transition.from.length === 0 : transition.from.includes(from);
}

/** One row per (transition, from-state), like the `booking_transition` table: 33 rows. */
export interface BookingTransitionRow {
  readonly transitionId: TransitionId;
  readonly fromStatus: BookingStatus | null;
  readonly toStatus: BookingStatus;
}

export const BOOKING_TRANSITION_ROWS: readonly BookingTransitionRow[] = BOOKING_TRANSITIONS.flatMap(
  (transition): BookingTransitionRow[] =>
    transition.from.length === 0
      ? [{ transitionId: transition.id, fromStatus: null, toStatus: transition.to }]
      : transition.from.map((fromStatus) => ({
          transitionId: transition.id,
          fromStatus,
          toStatus: transition.to,
        })),
);

// ---------------------------------------------------------------------------------------------
// Sub-state machines (§4). Only the ones §4 states unambiguously are here: payment order,
// package, receipt record, report version and booking line. The dispute and payout lines of §4
// are left out until they are settled (see the P2-07 report). Each edge is exactly one arrow of
// §4; nothing is inferred.

export interface SubStateMachine<S extends string> {
  readonly states: readonly S[];
  readonly transitions: readonly (readonly [from: S, to: S])[];
}

export function canSubTransition<S extends string>(
  machine: SubStateMachine<S>,
  from: S,
  to: S,
): boolean {
  return machine.transitions.some(([a, b]) => a === from && b === to);
}

/** Equal to the Prisma enum `PaymentOrderStatus`. */
export type PaymentOrderStatus =
  'CREATED' | 'PENDING' | 'CAPTURED' | 'FAILED' | 'EXPIRED' | 'REFUNDED_PARTIAL' | 'REFUNDED_FULL';

export const PAYMENT_ORDER_STATE_MACHINE: SubStateMachine<PaymentOrderStatus> = {
  states: [
    'CREATED',
    'PENDING',
    'CAPTURED',
    'FAILED',
    'EXPIRED',
    'REFUNDED_PARTIAL',
    'REFUNDED_FULL',
  ],
  transitions: [
    ['CREATED', 'PENDING'],
    ['PENDING', 'CAPTURED'],
    ['PENDING', 'FAILED'],
    ['PENDING', 'EXPIRED'],
    ['CAPTURED', 'REFUNDED_PARTIAL'],
    ['CAPTURED', 'REFUNDED_FULL'],
  ],
};

/** Equal to the Prisma enum `PackageStatus`. A reprint voids the label and issues a new one. */
export type PackageStatus = 'ISSUED' | 'RECEIVED' | 'MISSING' | 'VOIDED';

export const PACKAGE_STATE_MACHINE: SubStateMachine<PackageStatus> = {
  states: ['ISSUED', 'RECEIVED', 'MISSING', 'VOIDED'],
  transitions: [
    ['ISSUED', 'RECEIVED'],
    ['ISSUED', 'MISSING'],
    ['ISSUED', 'VOIDED'],
  ],
};

/**
 * `SUBMITTED` is not a database value: a submitted receipt record has `decision` NULL, and the
 * other three states equal the Prisma enum `ReceiptDecision`.
 */
export type ReceiptRecordStatus = 'SUBMITTED' | 'APPROVED' | 'HOLD_CONFIRMED' | 'REJECTED_UNFIT';

export const RECEIPT_RECORD_STATE_MACHINE: SubStateMachine<ReceiptRecordStatus> = {
  states: ['SUBMITTED', 'APPROVED', 'HOLD_CONFIRMED', 'REJECTED_UNFIT'],
  transitions: [
    ['SUBMITTED', 'APPROVED'],
    ['SUBMITTED', 'HOLD_CONFIRMED'],
    ['SUBMITTED', 'REJECTED_UNFIT'],
  ],
};

/** Equal to the Prisma enum `ReportVersionStatus`. */
export type ReportVersionStatus = 'DRAFT' | 'IN_REVIEW' | 'RETURNED' | 'RELEASED' | 'SUPERSEDED';

export const REPORT_VERSION_STATE_MACHINE: SubStateMachine<ReportVersionStatus> = {
  states: ['DRAFT', 'IN_REVIEW', 'RETURNED', 'RELEASED', 'SUPERSEDED'],
  transitions: [
    ['DRAFT', 'IN_REVIEW'],
    ['IN_REVIEW', 'RETURNED'],
    ['IN_REVIEW', 'RELEASED'],
    ['RELEASED', 'SUPERSEDED'],
  ],
};

/** Equal to the Prisma enum `BookingLineStatus`. Cancellation is "by agreement" (§4). */
export type BookingLineStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export const BOOKING_LINE_STATE_MACHINE: SubStateMachine<BookingLineStatus> = {
  states: ['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'CANCELLED'],
  transitions: [
    ['NOT_STARTED', 'IN_PROGRESS'],
    ['IN_PROGRESS', 'DONE'],
    ['NOT_STARTED', 'CANCELLED'],
    ['IN_PROGRESS', 'CANCELLED'],
  ],
};
