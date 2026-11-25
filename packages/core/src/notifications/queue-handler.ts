import type { EventEnvelope } from '../platform/events.js';
import {
  consumeBatch,
  type ConsumeResult,
  type MessageDisposition,
  type QueueConsumer,
  type QueueMessage,
  type ReceiveOptions,
} from '../platform/queue-consumer.js';
import { QUEUES } from '../platform/routes.js';
import { handleNotificationEvent, type NotificationDeps } from './dispatch.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A message of `lc-notifications.fifo` that is not a usable event envelope. It is retried and ends in the dead-letter queue. */
export class MalformedNotificationMessageError extends Error {
  override name = 'MalformedNotificationMessageError';
}

/** The envelope in a message body. The relay publishes the JSON of an `EventEnvelope`. */
export function parseNotificationMessage(body: string): EventEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new MalformedNotificationMessageError('The message is not JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new MalformedNotificationMessageError('The message is not an object.');
  }
  const envelope = parsed as Partial<Record<keyof EventEnvelope, unknown>>;
  const aggregate = envelope.aggregate as { id?: unknown; type?: unknown } | null | undefined;
  if (
    typeof envelope.id !== 'string' ||
    !UUID.test(envelope.id) ||
    typeof envelope.type !== 'string' ||
    envelope.type === '' ||
    typeof aggregate !== 'object' ||
    aggregate === null ||
    typeof aggregate.id !== 'string' ||
    typeof aggregate.type !== 'string'
  ) {
    throw new MalformedNotificationMessageError('The message is not an event envelope.');
  }
  return envelope as unknown as EventEnvelope;
}

/**
 * One pass over `lc-notifications.fifo`. The queue's message group is the aggregate id (for a
 * booking its id), and SQS hands out a group's messages in order, several at a time. To keep that
 * order here, messages are handled one after the other in the order received, and once a message
 * fails, the later messages of the same group in this pass are left unhandled (they stay on the
 * queue and come back after their visibility timeout, behind the failed one, as SQS keeps a
 * group's order). Other groups carry on. An acknowledged message is deleted; a failed or left one
 * is not, so the queue's redrive policy parks a message that keeps failing.
 */
export function consumeNotificationsQueue(
  consumer: QueueConsumer,
  deps: NotificationDeps,
  options?: ReceiveOptions,
  /** The per-event work; only tests replace it. */
  handle: (
    deps: NotificationDeps,
    envelope: EventEnvelope,
  ) => Promise<unknown> = handleNotificationEvent,
): Promise<ConsumeResult> {
  const failedGroups = new Set<string>();
  return consumeBatch(
    consumer,
    QUEUES.notifications,
    async (message: QueueMessage): Promise<MessageDisposition> => {
      const envelope = parseNotificationMessage(message.body);
      const group = envelope.aggregate.id;
      if (failedGroups.has(group)) return 'leave';
      try {
        await handle(deps, envelope);
      } catch (error) {
        failedGroups.add(group);
        throw error;
      }
      return 'acknowledge';
    },
    options,
  );
}
