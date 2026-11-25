import { uuidv7 } from '@labconnect/database/test-utils';
import {
  type EventEnvelope,
  InMemoryNotificationContext,
  type NotificationContext,
  type NotificationDeps,
} from '../../src/index.js';
import { useAccess } from './access-support.js';

export interface NotificationRow {
  recipient_user_id: string;
  organisation_id: string;
  channel: 'EMAIL' | 'IN_APP';
  status: string;
  is_action_required: boolean;
  template_version: number;
  payload: Record<string, unknown>;
  sent_at: Date | null;
  delivery_attempts: number;
  next_attempt_at: Date | null;
  error: string | null;
  provider_message_id: string | null;
}

/** The access world plus the pieces every notifications test needs. */
type Access = ReturnType<typeof useAccess>;

export interface NotificationTest extends Omit<Access, 'deps'> {
  context: InMemoryNotificationContext;
  deps: () => NotificationDeps;
  event: (type: string, aggregateId: string, data?: Record<string, unknown>) => EventEnvelope;
  booking: (overrides?: Partial<NotificationContext>) => string;
  rowsOf: (eventId: string) => Promise<NotificationRow[]>;
  summary: (rows: readonly NotificationRow[]) => string[];
  key: (userId: string, channel: 'EMAIL' | 'IN_APP', status: string) => string;
}

export function useNotifications(): NotificationTest {
  const t = useAccess();
  const context = new InMemoryNotificationContext();

  const deps = (): NotificationDeps => ({ prisma: t.worker(), clock: t.clock, context });

  /** An envelope for an aggregate (a booking, normally). */
  const event = (
    type: string,
    aggregateId: string,
    data: Record<string, unknown> = {},
  ): EventEnvelope => ({
    id: uuidv7(),
    type,
    version: 1,
    occurredAt: t.clock.now().toISOString(),
    aggregate: { type: 'booking', id: aggregateId },
    actor: 'SYSTEM',
    data: { bookingId: aggregateId, ...data },
  });

  /**
   * A booking of customer organisation A (requester `a.requester`) at the lab's first site,
   * registered with the context port. Returns its id.
   */
  const booking = (overrides: Partial<NotificationContext> = {}): string => {
    const { a, lab } = t.world();
    const bookingId = uuidv7();
    context.set(bookingId, {
      bookingId,
      bookingNo: `LC-2026-${bookingId.slice(-6).toUpperCase()}`,
      labName: 'DEMO Lab',
      customers: [{ organisationId: a.organisationId, userIds: [a.requester] }],
      lab: { organisationId: lab.organisationId, siteId: lab.siteIds[0] },
      ...overrides,
    });
    return bookingId;
  };

  const rowsOf = async (eventId: string): Promise<NotificationRow[]> =>
    (
      await t.db().query<NotificationRow>(
        `SELECT recipient_user_id::text, organisation_id::text, channel::text, status::text,
                is_action_required, template_version, payload, sent_at, delivery_attempts,
                next_attempt_at, error, provider_message_id
           FROM notification WHERE event_id = $1::uuid ORDER BY recipient_user_id, channel`,
        [eventId],
      )
    ).rows;

  /** `userId:CHANNEL:STATUS` of each row, sorted, for compact assertions. */
  const summary = (rows: readonly NotificationRow[]): string[] =>
    rows.map((row) => `${row.recipient_user_id}:${row.channel}:${row.status}`).sort();

  const key = (userId: string, channel: 'EMAIL' | 'IN_APP', status: string): string =>
    `${userId}:${channel}:${status}`;

  return { ...t, context, deps, event, booking, rowsOf, summary, key };
}
