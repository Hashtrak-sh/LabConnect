import type { components } from '@labconnect/api-contract';
import type { Problem } from '@/features/common/problem';
import type { AccessUser, RoleCode } from '@/features/access/roles';

// The lab's booking screens (I3-LAB-02, boards E2, E3, F5, K8, K9): what the pages and actions
// decide without the network. The API stays the authority on every call.

export type InboxItem = components['schemas']['LabInboxItem'];
export type BookingStatus = components['schemas']['BookingStatus'];

/** Who opens the lab screens (FR-LAB-01: both lab roles see the inbox). */
export const LAB_DESK_ROLES: readonly RoleCode[] = ['LAB_MAKER', 'LAB_CHECKER'];
/** Who decides on a request (`booking.decide`; Ops cannot decide for a lab, OQ-24). */
export const DECIDER_ROLES: readonly RoleCode[] = ['LAB_CHECKER'];
/** Who answers a counter-offer (`counter.respond`); the API narrows it to the owner or an admin. */
export const COUNTER_ROLES: readonly RoleCode[] = ['CUSTOMER_ADMIN', 'CUSTOMER_REQUESTER'];

/** The inbox tabs of board K8, and the booking states each one asks the API for. */
export const INBOX_TABS = ['new', 'waiting', 'drops', 'overdue'] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

export const TAB_STATUSES: Readonly<Record<InboxTab, readonly BookingStatus[]>> = {
  new: ['REQUESTED'],
  waiting: ['COUNTERED', 'ACCEPTED'],
  drops: ['PAID', 'HANDOVER_SET'],
  overdue: ['PAID', 'HANDOVER_SET'],
};

export function readTab(value: string | undefined): InboxTab {
  return (INBOX_TABS as readonly string[]).includes(value ?? '') ? (value as InboxTab) : 'new';
}

/** Whether a paid booking's drop deadline has passed (BR-040): the "Overdue drops" tab. */
export function isOverdue(item: InboxItem, now: Date): boolean {
  const deadline = item.booking.dropDeadlineAt;
  return deadline !== null && Date.parse(deadline) <= now.getTime();
}

/**
 * The rows of a tab from the page the API returned. "Paid, expecting drop" and "Overdue drops"
 * ask for the same states and split them by the drop deadline.
 */
export function rowsOfTab(tab: InboxTab, items: readonly InboxItem[], now: Date): InboxItem[] {
  if (tab === 'drops') return items.filter((item) => !isOverdue(item, now));
  if (tab === 'overdue') return items.filter((item) => isOverdue(item, now));
  return [...items];
}

/** Where a signed-in user lands when no page asked for them (I3-LAB-02). */
export function landingPath(user: AccessUser): string {
  const roles = user.active?.roles ?? [];
  if (roles.some((role) => LAB_DESK_ROLES.includes(role))) return '/lab';
  if (roles.includes('PLATFORM_OPS')) return '/admin/claims';
  return '/';
}

export type DecisionNotice =
  | 'signed-out'
  | 'forbidden'
  | 'not-found'
  | 'busy'
  | 'already-decided'
  | 'slot-unavailable'
  | 'site-not-bookable'
  | 'counter-field'
  | 'changed'
  | 'invalid'
  | 'rate-limited'
  | 'failed';

/** What a refused decision (accept, reject, counter) tells the Checker. */
export function decisionNotice(problem: Problem): DecisionNotice {
  switch (problem.status) {
    case 401:
      return 'signed-out';
    case 403:
      return 'forbidden';
    case 404:
      return 'not-found';
    case 409:
      if (problem.code === 'REQUEST_IN_PROGRESS') return 'busy';
      if (problem.code === 'SLOT_UNAVAILABLE') return 'slot-unavailable';
      return 'already-decided';
    case 412:
      return 'changed';
    case 422:
      if (problem.code === 'SITE_NOT_BOOKABLE') return 'site-not-bookable';
      if (problem.code === 'COUNTER_FIELD_NOT_ALLOWED') return 'counter-field';
      return 'invalid';
    case 429:
      return 'rate-limited';
    default:
      return 'failed';
  }
}

/** A sample quantity the line can store (more than 0, at most three decimals, as the API). */
export function readQuantity(raw: unknown): number | null | 'invalid' {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(raw.trim())) return 'invalid';
  const value = Number(raw.trim());
  return value > 0 ? value : 'invalid';
}

export type CounterLine = { lineId: string; unitCode: string; current: number };

/**
 * The counter-offer of the form: a slot other than the current one, more sample for some lines,
 * and the message. `null` fields mean "unchanged". A quantity not above the current one is a
 * field error, as the API would answer (BR-017).
 */
export function readCounter(
  form: { slotId: string; message: string; quantities: Record<string, unknown> },
  lines: readonly CounterLine[],
  currentSlotId: string | null,
):
  | {
      ok: true;
      body: {
        proposedSlotId?: string;
        perLineQuantity?: { lineId: string; sampleQty: number; unitCode: string }[];
        message: string;
      };
    }
  | { ok: false; errors: ('message' | 'nothing' | `qty:${string}`)[] } {
  const errors: ('message' | 'nothing' | `qty:${string}`)[] = [];
  const message = form.message.trim();
  if (message === '' || message.length > 2000) errors.push('message');
  const slot = form.slotId !== '' && form.slotId !== currentSlotId ? form.slotId : undefined;
  const quantities: { lineId: string; sampleQty: number; unitCode: string }[] = [];
  for (const line of lines) {
    const value = readQuantity(form.quantities[line.lineId]);
    if (value === null) continue;
    if (value === 'invalid' || value <= line.current) errors.push(`qty:${line.lineId}`);
    else quantities.push({ lineId: line.lineId, sampleQty: value, unitCode: line.unitCode });
  }
  if (slot === undefined && quantities.length === 0 && errors.length === 0) errors.push('nothing');
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      ...(slot === undefined ? {} : { proposedSlotId: slot }),
      ...(quantities.length === 0 ? {} : { perLineQuantity: quantities }),
      message,
    },
  };
}
