import { type Prisma, uuidv7 } from '@labconnect/database';
import type { Clock } from './clock.js';
import type { EventEnvelope, NewEvent, StoredPayload } from './events.js';

const MAX_EVENT_TYPE = 100;
const MAX_AGGREGATE_TYPE = 60;

/**
 * Writes domain events to `outbox_event` in the same transaction as the change that
 * caused them (AUDIT_AND_EVENT_ARCHITECTURE.md section 3). The relay publishes them later.
 */
export class OutboxService {
  constructor(private readonly clock: Clock) {}

  /**
   * Adds one event and returns its envelope. Uses `createMany`: the API role may insert
   * into `outbox_event` but has no SELECT privilege, so `INSERT ... RETURNING` (Prisma
   * `create`) is refused.
   */
  async enqueue(tx: Prisma.TransactionClient, event: NewEvent): Promise<EventEnvelope> {
    if (event.type.length === 0 || event.type.length > MAX_EVENT_TYPE) {
      throw new RangeError(`The event type must be 1 to ${String(MAX_EVENT_TYPE)} characters.`);
    }
    if (event.aggregate.type.length === 0 || event.aggregate.type.length > MAX_AGGREGATE_TYPE) {
      throw new RangeError(
        `The aggregate type must be 1 to ${String(MAX_AGGREGATE_TYPE)} characters.`,
      );
    }
    const version = event.version ?? 1;
    if (!Number.isInteger(version) || version < 1) {
      throw new RangeError('The event version must be a positive integer.');
    }
    const occurredAt = this.clock.now();
    const id = uuidv7(occurredAt.getTime());
    const stored: { actor: StoredPayload['actor']; data: Prisma.InputJsonValue } = {
      actor: event.actor,
      data: event.data,
    };
    // An interface has no index signature, which Prisma's JSON type asks for; the shape is plain JSON.
    const payload = stored as unknown as Prisma.InputJsonObject;

    await tx.outboxEvent.createMany({
      data: [
        {
          id,
          aggregateType: event.aggregate.type,
          aggregateId: event.aggregate.id,
          eventType: event.type,
          eventVersion: version,
          payload,
          occurredAt,
        },
      ],
    });
    return {
      id,
      type: event.type,
      version,
      occurredAt: occurredAt.toISOString(),
      aggregate: event.aggregate,
      actor: event.actor,
      data: event.data as EventEnvelope['data'],
    };
  }
}
