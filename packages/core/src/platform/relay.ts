import { type Prisma, type PrismaClient, withDbContext } from '@labconnect/database';
import type { Clock } from './clock.js';
import type { EventEnvelope, StoredPayload } from './events.js';
import type { QueuePublisher } from './queue.js';
import { queuesFor } from './routes.js';

export const DEFAULT_RELAY_BATCH_SIZE = 100;
/** A row that failed this many times is left alone until someone looks at it (OQ-66). */
export const DEFAULT_RELAY_MAX_ATTEMPTS = 50;
const MAX_ERROR_LENGTH = 500;
const RELAY_LOCK_NAME = 'labconnect.outbox_event.relay';

export interface RelayOptions {
  batchSize?: number;
  maxAttempts?: number;
}

export interface RelayResult {
  published: number;
  failed: number;
  /** Left for the next pass because an earlier event of the same aggregate failed in this one. */
  deferred: number;
  /** Another relay was running, so this call did nothing. */
  busy: boolean;
}

interface OutboxRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  event_version: number;
  payload: unknown;
  occurred_at: Date;
}

/**
 * Publishes unpublished outbox events (AUDIT_AND_EVENT_ARCHITECTURE.md section 3).
 *
 * In one transaction as the worker, it locks up to `batchSize` rows in `occurred_at` order
 * with `FOR UPDATE SKIP LOCKED`, publishes each to the queues of its route, and sets
 * `published_at`. Only one relay runs at a time (a transaction-scoped advisory lock; a
 * second call returns `busy`), because two relays working on different batches could
 * publish one aggregate's events out of order. A failure increments `attempts` and
 * stores a truncated error (never the payload) and the row stays for the next pass. A
 * failing event does not stop the others; but later events of the same aggregate are
 * deferred in that pass, so one aggregate's events never arrive out of order.
 *
 * Delivery is at least once: if the transaction fails after a publish, the event is
 * published again, so consumers deduplicate on the event id (`processOnce`).
 */
export async function relayOutbox(
  prisma: Pick<PrismaClient, '$transaction'>,
  publisher: QueuePublisher,
  clock: Clock,
  options: RelayOptions = {},
): Promise<RelayResult> {
  const batchSize = options.batchSize ?? DEFAULT_RELAY_BATCH_SIZE;
  const maxAttempts = options.maxAttempts ?? DEFAULT_RELAY_MAX_ATTEMPTS;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError('batchSize must be a positive integer.');
  }

  return withDbContext(
    prisma,
    { kind: 'system' },
    async (tx) => {
      // One relay at a time. With two, the second would take a later batch and could publish
      // event 2 of an aggregate before the first has published its event 1.
      const lock = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${RELAY_LOCK_NAME}, 0)) AS locked`;
      if (lock[0]?.locked !== true) return { published: 0, failed: 0, deferred: 0, busy: true };

      const rows = await tx.$queryRaw<OutboxRow[]>`
        SELECT id::text AS id, aggregate_type, aggregate_id::text AS aggregate_id, event_type,
               event_version, payload, occurred_at
          FROM outbox_event
         WHERE published_at IS NULL AND attempts < ${maxAttempts}
         ORDER BY occurred_at, id
         LIMIT ${batchSize}
           FOR UPDATE SKIP LOCKED`;

      const result: RelayResult = { published: 0, failed: 0, deferred: 0, busy: false };
      const blocked = new Set<string>();
      for (const row of rows) {
        const aggregateKey = `${row.aggregate_type}:${row.aggregate_id}`;
        if (blocked.has(aggregateKey)) {
          result.deferred += 1;
          continue;
        }
        try {
          const envelope = toEnvelope(row);
          for (const queue of queuesFor(row.event_type)) {
            await publisher.publish(queue, envelope);
          }
          await markPublished(tx, row.id, clock.now());
          result.published += 1;
        } catch (error) {
          blocked.add(aggregateKey);
          await markFailed(tx, row.id, error);
          result.failed += 1;
        }
      }
      return result;
    },
    { maxWait: 30_000, timeout: 120_000 },
  );
}

function toEnvelope(row: OutboxRow): EventEnvelope {
  const stored = row.payload as Partial<StoredPayload> | null;
  return {
    id: row.id,
    type: row.event_type,
    version: row.event_version,
    occurredAt: row.occurred_at.toISOString(),
    aggregate: { type: row.aggregate_type, id: row.aggregate_id },
    actor: stored?.actor ?? 'SYSTEM',
    data: stored?.data ?? null,
  };
}

async function markPublished(tx: Prisma.TransactionClient, id: string, at: Date): Promise<void> {
  await tx.outboxEvent.updateMany({ where: { id }, data: { publishedAt: at, lastError: null } });
}

async function markFailed(tx: Prisma.TransactionClient, id: string, error: unknown): Promise<void> {
  await tx.outboxEvent.updateMany({
    where: { id },
    data: { attempts: { increment: 1 }, lastError: describeError(error) },
  });
}

/** The error's name and message, cut short. The payload is never part of it. */
function describeError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
  return text.slice(0, MAX_ERROR_LENGTH);
}
