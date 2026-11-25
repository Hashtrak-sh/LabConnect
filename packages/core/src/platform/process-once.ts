import type { Prisma } from '@labconnect/database';

const MAX_CONSUMER = 60;

export type ProcessOnceResult<T> = { processed: true; result: T } | { processed: false };

/**
 * Idempotent consumption (AUDIT_AND_EVENT_ARCHITECTURE.md section 3). Records
 * (`consumer`, `eventId`) in `processed_event` and runs `work` in the same transaction, so
 * either both happen or neither does. If the pair is already recorded, `work` is skipped.
 *
 * Two deliveries racing on the same event: the second INSERT waits for the first
 * transaction. If that one commits, the second does nothing; if it rolls back (the work
 * failed), the second goes ahead. `processed_event` is readable and writable only in the
 * system or platform context, so call this inside `withDbContext(prisma, { kind: 'system' }, ...)`.
 */
export async function processOnce<T>(
  tx: Prisma.TransactionClient,
  consumer: string,
  eventId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<ProcessOnceResult<T>> {
  if (consumer.length === 0 || consumer.length > MAX_CONSUMER) {
    throw new RangeError(`The consumer name must be 1 to ${String(MAX_CONSUMER)} characters.`);
  }
  const inserted = await tx.$executeRaw`
    INSERT INTO processed_event (consumer, event_id)
    VALUES (${consumer}, ${eventId}::uuid)
    ON CONFLICT (consumer, event_id) DO NOTHING`;
  if (inserted === 0) return { processed: false };
  return { processed: true, result: await work(tx) };
}
