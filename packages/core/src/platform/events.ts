import type { Prisma, RoleCode } from '@labconnect/database';

/** Who caused an event. `'SYSTEM'` for timers, jobs and webhooks. */
export interface EventActor {
  userId: string;
  role?: RoleCode;
  orgId?: string;
}

export interface EventAggregate {
  type: string;
  id: string;
}

/** What a module hands to `OutboxService.enqueue`. */
export interface NewEvent {
  /** Event code such as `booking.accepted` (NOTIFICATIONS_MATRIX.md), at most 100 characters. */
  type: string;
  /** Schema version of `data`. Defaults to 1. */
  version?: number;
  aggregate: EventAggregate;
  actor: EventActor | 'SYSTEM';
  /**
   * The event's content. It travels through the database and a queue unredacted, so it
   * must not hold secrets, OTPs, tokens, bank details or report contents: send ids.
   */
  data: Prisma.InputJsonValue;
}

/**
 * The message consumers receive (AUDIT_AND_EVENT_ARCHITECTURE.md section 3).
 * `id` is the outbox row id and is what consumers deduplicate on (`processed_event`).
 */
export interface EventEnvelope {
  id: string;
  type: string;
  version: number;
  /** ISO 8601, UTC. */
  occurredAt: string;
  aggregate: EventAggregate;
  actor: EventActor | 'SYSTEM';
  data: Prisma.JsonValue;
}

/**
 * What the `outbox_event.payload` column holds. The schema says the payload is the
 * envelope's `data`, but the envelope also has an `actor` and the table has no column for
 * it, so the payload is `{ actor, data }` (OQ-63).
 */
export interface StoredPayload {
  actor: EventActor | 'SYSTEM';
  data: Prisma.JsonValue;
}
