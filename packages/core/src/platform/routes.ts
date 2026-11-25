/**
 * Which queue an event goes to. The only place that knows. Queue names are logical; the
 * URLs come from configuration (`queueUrlsFromEnv`).
 *
 * AUDIT_AND_EVENT_ARCHITECTURE.md section 3 names five queues and what consumes them but
 * not which events go where, so only the routes that follow from the documents are here:
 *
 * - every event code in NOTIFICATIONS_MATRIX.md goes to `lc-notifications.fifo`
 *   (`MessageGroupId` is the aggregate id, which for booking events is the booking id);
 * - every event also goes to `lc-analytics` (FS section 14.1: "funnels and SLA reports come
 *   from one stream"), which is also the default for an event type no route mentions, so
 *   an event is never dropped for want of a route.
 *
 * - the events SEARCH.md section 2 names, and the two notification events that also change what
 *   search shows, go to `lc-search-sync` (P3-10, `SEARCH_SYNC_EVENT_TYPES`). Most of them are not
 *   emitted yet: the modules that emit them are not built (OQ-158).
 *
 * Not routed yet, because no document names the events: `lc-files` (scan results, PDF
 * validation, stamping) and `lc-timers`. Add a route here when the consuming task defines the
 * event (OQ-64).
 */
export const QUEUES = {
  notifications: 'lc-notifications.fifo',
  searchSync: 'lc-search-sync',
  files: 'lc-files',
  timers: 'lc-timers',
  analytics: 'lc-analytics',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Event codes of NOTIFICATIONS_MATRIX.md. `auth.otp` is left out on purpose: an OTP must
 * not be stored in an event payload (CLAUDE.md section 5), so the identity module has to
 * send it some other way (OQ-65).
 */
export const NOTIFICATION_EVENT_TYPES: ReadonlySet<string> = new Set([
  'booking.requested',
  'booking.sla_reminder',
  'booking.accepted',
  'booking.rejected',
  'booking.expired',
  'booking.countered',
  'booking.counter_response',
  'payment.window_ending',
  'payment.succeeded',
  'payment.expired',
  'handover.deadline_approaching',
  'handover.overdue',
  'booking.no_show',
  'receipt.recorded',
  'receipt.approved',
  'receipt.on_hold',
  'hold.reminder',
  'hold.escalated',
  'approval.sla_reminder',
  'testing.started',
  'report.eta_revised',
  'report.submitted',
  'report.returned',
  'report.released',
  'report.amended',
  'label.reprint_requested',
  'booking.cancelled',
  'refund.processed',
  'payout.released',
  'dispute.opened',
  'dispute.updated',
  'dispute.decided',
  'accreditation.changed',
  'lab.became_bookable',
  'user.invited',
]);

/**
 * Events that make the search index re-read a site (SEARCH.md section 2). The consumer is
 * `handleSearchSyncEvent` in `search/sync.ts`; it keeps its own list of the same codes (the
 * platform module cannot import it), and `routes.test.ts` checks that the two agree.
 */
export const SEARCH_SYNC_EVENT_TYPES: ReadonlySet<string> = new Set([
  'masterdata.published',
  'pricelist.published',
  'lab_site.bookability_changed',
  'slot.capacity_changed',
  'rating.updated',
  'accreditation.changed',
  'lab.became_bookable',
]);

/** The queues an event type is published to, in order. Never empty. */
export function queuesFor(eventType: string): QueueName[] {
  const queues: QueueName[] = [];
  if (NOTIFICATION_EVENT_TYPES.has(eventType)) queues.push(QUEUES.notifications);
  if (SEARCH_SYNC_EVENT_TYPES.has(eventType)) queues.push(QUEUES.searchSync);
  queues.push(QUEUES.analytics);
  return queues;
}
