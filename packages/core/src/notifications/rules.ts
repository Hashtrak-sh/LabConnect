import { NOTIFICATION_EVENT_TYPES } from '../platform/routes.js';

// Who is told about which event, on which channel, and whether they may switch it off.
// Source: docs/01-product/NOTIFICATIONS_MATRIX.md, row by row. A test reads the matrix and
// compares it with this table (`rules.test.ts`), so the two cannot drift apart.

/** The MVP channels (SMS and WhatsApp wait for a provider, OQ-11). */
export type DeliveryChannel = 'EMAIL' | 'IN_APP';

/**
 * Who the matrix columns mean:
 * - `CUSTOMER`: the users the context names on the customer side (the requester of the booking);
 * - `LAB_MAKER`, `LAB_CHECKER`: active holders of that role in the lab organisation, assigned to the site;
 * - `OPS`: active `PLATFORM_OPS` users;
 * - `INVITEE`: the one user the event names (`user.invited`, the matrix has "Invite (E)" for every role).
 */
export type Party = 'CUSTOMER' | 'LAB_MAKER' | 'LAB_CHECKER' | 'OPS' | 'INVITEE';

/** The `data` of an event. Never trusted: a rule reads it defensively. */
export type EventData = Readonly<Record<string, unknown>>;

export interface RecipientRule {
  party: Party;
  channels: readonly DeliveryChannel[];
  /**
   * A bold cell of the matrix: the party must act, so muting is ignored (NOTIFICATIONS_MATRIX.md,
   * rules; SCHEMA_SPECIFICATION 12.3).
   */
  actionRequired: boolean;
  /**
   * A cell that applies only under a condition written in the matrix ("at 90%", "if > 3 days").
   * The event field names are an assumption of this task (OQ-141). A missing field means the
   * condition is not met, so the party is not notified.
   */
  when?: (data: EventData) => boolean;
}

const E: readonly DeliveryChannel[] = ['EMAIL'];
const I: readonly DeliveryChannel[] = ['IN_APP'];
const IE: readonly DeliveryChannel[] = ['IN_APP', 'EMAIL'];

const info = (
  party: Party,
  channels: readonly DeliveryChannel[],
  when?: RecipientRule['when'],
): RecipientRule => ({ party, channels, actionRequired: false, ...(when ? { when } : {}) });
const act = (
  party: Party,
  channels: readonly DeliveryChannel[],
  when?: RecipientRule['when'],
): RecipientRule => ({ party, channels, actionRequired: true, ...(when ? { when } : {}) });

function numberField(data: EventData, key: string): number | undefined {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** `percent` (of the SLA) is at least `threshold`. */
const percentAtLeast =
  (threshold: number): RecipientRule['when'] =>
  (data) =>
    (numberField(data, 'percent') ?? 0) >= threshold;

export const NOTIFICATION_RULES: Readonly<Record<string, readonly RecipientRule[]>> = {
  'booking.requested': [info('CUSTOMER', IE), info('LAB_MAKER', I), act('LAB_CHECKER', IE)],
  'booking.sla_reminder': [act('LAB_CHECKER', IE), info('OPS', I, percentAtLeast(90))],
  'booking.accepted': [act('CUSTOMER', IE)],
  'booking.rejected': [info('CUSTOMER', IE)],
  'booking.expired': [info('CUSTOMER', IE), info('LAB_CHECKER', I), info('OPS', I)],
  'booking.countered': [act('CUSTOMER', IE)],
  'booking.counter_response': [info('LAB_MAKER', I), info('LAB_CHECKER', IE)],
  'payment.window_ending': [act('CUSTOMER', IE)],
  'payment.succeeded': [info('CUSTOMER', IE), info('LAB_MAKER', I), info('LAB_CHECKER', IE)],
  'payment.expired': [info('CUSTOMER', IE), info('LAB_CHECKER', I)],
  'handover.deadline_approaching': [act('CUSTOMER', IE)],
  'handover.overdue': [info('CUSTOMER', IE), info('LAB_MAKER', I), info('OPS', I)],
  'booking.no_show': [info('CUSTOMER', IE), info('LAB_MAKER', I), info('LAB_CHECKER', I)],
  'receipt.recorded': [info('CUSTOMER', I), act('LAB_CHECKER', IE)],
  'receipt.approved': [info('CUSTOMER', IE), info('LAB_MAKER', I)],
  'receipt.on_hold': [act('CUSTOMER', IE), info('OPS', I)],
  'hold.reminder': [act('CUSTOMER', IE)],
  'hold.escalated': [act('CUSTOMER', IE), act('OPS', IE)],
  'approval.sla_reminder': [
    act('LAB_CHECKER', IE),
    info('OPS', I, (data) => data.breached === true),
  ],
  'testing.started': [info('CUSTOMER', I)],
  'report.eta_revised': [
    info('CUSTOMER', IE),
    info('OPS', I, (data) => (numberField(data, 'delayDays') ?? 0) > 3),
  ],
  'report.submitted': [act('LAB_CHECKER', IE)],
  'report.returned': [act('LAB_MAKER', IE)],
  'report.released': [act('CUSTOMER', IE), info('LAB_MAKER', I), info('LAB_CHECKER', I)],
  'report.amended': [info('CUSTOMER', IE), info('LAB_MAKER', I), info('LAB_CHECKER', I)],
  'label.reprint_requested': [act('LAB_CHECKER', I)],
  'booking.cancelled': [
    info('CUSTOMER', IE),
    info('LAB_MAKER', I),
    info('LAB_CHECKER', IE),
    info('OPS', I, (data) => data.cancelledBy === 'LAB'),
  ],
  'refund.processed': [info('CUSTOMER', IE)],
  'payout.released': [info('LAB_CHECKER', E)],
  'dispute.opened': [info('CUSTOMER', IE), act('LAB_CHECKER', IE), act('OPS', IE)],
  'dispute.updated': [info('CUSTOMER', IE), info('LAB_CHECKER', IE)],
  'dispute.decided': [info('CUSTOMER', IE), info('LAB_CHECKER', IE)],
  'accreditation.changed': [info('CUSTOMER', IE), info('LAB_CHECKER', IE), act('OPS', I)],
  'lab.became_bookable': [info('CUSTOMER', E)],
  // The matrix lists "Invite (E)" under Customer, Lab Maker and Lab Checker: the invited user,
  // whatever role they are invited to. An invitation cannot be muted: the user has no
  // preferences yet and nothing else tells them (OQ-142).
  'user.invited': [act('INVITEE', E)],
};

/** The rules of an event, or `undefined` for a code that is not a notification event. */
export function rulesFor(eventType: string): readonly RecipientRule[] | undefined {
  return NOTIFICATION_RULES[eventType];
}

/** Every channel any party of the event can receive: the "MVP" column of the matrix. */
export function channelsOf(eventType: string): DeliveryChannel[] {
  const channels = new Set<DeliveryChannel>();
  for (const rule of NOTIFICATION_RULES[eventType] ?? []) {
    for (const channel of rule.channels) channels.add(channel);
  }
  return [...channels].sort();
}

/** True when `eventType` has a rule for every notification event and for no other code. */
export function rulesCoverEveryEvent(): boolean {
  const codes = Object.keys(NOTIFICATION_RULES);
  return (
    codes.length === NOTIFICATION_EVENT_TYPES.size &&
    codes.every((code) => NOTIFICATION_EVENT_TYPES.has(code))
  );
}

export type SuppressionReason = 'MUTED';

/**
 * What to do with one (recipient, channel) pair. An action-required notification is always
 * delivered; any other one is suppressed when the user muted that event on that channel.
 */
export function deliveryDecision(input: {
  actionRequired: boolean;
  muted: boolean;
}): 'DELIVER' | 'SUPPRESS' {
  if (input.actionRequired) return 'DELIVER';
  return input.muted ? 'SUPPRESS' : 'DELIVER';
}
