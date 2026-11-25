import { type DbContext, withDbContext } from '@labconnect/database';
import { describe, expect, it } from 'vitest';
import {
  FixedClock,
  InMemoryQueuePublisher,
  OutboxService,
  QUEUES,
  relayOutbox,
  type QueuePublisher,
} from '../../src/index.js';
import { failure, gate, PG, usePlatform, uuid } from './support.js';

// P3-01: the outbox and its relay, connected as the real roles.

describe('outbox and relay', () => {
  const { api, worker, db } = usePlatform();
  const clock = new FixedClock('2026-11-25T10:00:00Z');
  const outbox = new OutboxService(clock);
  const tenant = (): DbContext => ({ kind: 'tenant', orgId: uuid(), userId: uuid() });

  const enqueue = (type: string, aggregateId: string, data: Record<string, string> = {}) =>
    withDbContext(api(), tenant(), (tx) =>
      outbox.enqueue(tx, {
        type,
        aggregate: { type: 'booking', id: aggregateId },
        actor: { userId: uuid(), role: 'LAB_CHECKER' },
        data,
      }),
    );

  const state = async () =>
    (
      await db().query<{
        id: string;
        published_at: Date | null;
        attempts: number;
        last_error: string | null;
      }>(
        'SELECT id::text, published_at, attempts, last_error FROM outbox_event ORDER BY occurred_at, id',
      )
    ).rows;

  const reset = async () => {
    await db().query('DELETE FROM outbox_event');
    clock.set('2026-11-25T10:00:00Z');
  };

  it('stores the envelope fields as the API role, which cannot read them back', async () => {
    await reset();
    const aggregateId = uuid();
    const envelope = await enqueue('booking.accepted', aggregateId, { bookingId: aggregateId });
    expect(envelope).toMatchObject({
      type: 'booking.accepted',
      version: 1,
      occurredAt: '2026-11-25T10:00:00.000Z',
      aggregate: { type: 'booking', id: aggregateId },
      data: { bookingId: aggregateId },
    });

    const row = (
      await db().query<Record<string, unknown>>('SELECT * FROM outbox_event WHERE id = $1', [
        envelope.id,
      ])
    ).rows[0];
    expect(row).toMatchObject({
      aggregate_type: 'booking',
      aggregate_id: aggregateId,
      event_type: 'booking.accepted',
      event_version: 1,
      published_at: null,
      attempts: 0,
    });
    expect((row?.payload as { data: unknown }).data).toEqual({ bookingId: aggregateId });

    const read = await failure(() =>
      withDbContext(api(), tenant(), (tx) => tx.outboxEvent.count()),
    );
    expect(read.state).toBe(PG.privilege);
    const update = await failure(() =>
      withDbContext(api(), tenant(), (tx) => tx.outboxEvent.updateMany({ data: { attempts: 9 } })),
    );
    expect(update.state).toBe(PG.privilege);
  });

  it('lets the worker change only published_at, attempts and last_error', async () => {
    const refused = await failure(() =>
      withDbContext(worker(), { kind: 'system' }, (tx) =>
        tx.outboxEvent.updateMany({ data: { eventType: 'tampered' } }),
      ),
    );
    expect(refused.state).toBe(PG.privilege);
  });

  it('publishes events in the order they happened and marks them published', async () => {
    await reset();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push((await enqueue('booking.accepted', uuid())).id);
      clock.advance(1000);
    }
    const publisher = new InMemoryQueuePublisher();
    const result = await relayOutbox(worker(), publisher, clock, { batchSize: 100 });
    expect(result).toEqual({ published: 5, failed: 0, deferred: 0 });
    const notified = publisher.published.filter((m) => m.queue === QUEUES.notifications);
    expect(notified.map((m) => m.envelope.id)).toEqual(ids);
    expect(publisher.published.filter((m) => m.queue === QUEUES.analytics)).toHaveLength(5);
    expect((await state()).every((row) => row.published_at !== null)).toBe(true);

    expect(await relayOutbox(worker(), publisher, clock)).toEqual({
      published: 0,
      failed: 0,
      deferred: 0,
    });
    expect(publisher.published).toHaveLength(10);
  });

  it('carries the actor and data through to the message', async () => {
    await reset();
    const aggregateId = uuid();
    const sent = await enqueue('payment.succeeded', aggregateId, { paymentId: 'p-1' });
    const publisher = new InMemoryQueuePublisher();
    await relayOutbox(worker(), publisher, clock);
    expect(publisher.published[0]?.envelope).toEqual(sent);
  });

  it('retries a failure later, records it without the payload, and does not block other aggregates', async () => {
    await reset();
    const bad = uuid();
    const badFirst = await enqueue('booking.accepted', bad, { secretish: 'PAYLOAD-MARKER' });
    clock.advance(1000);
    const badSecond = await enqueue('booking.cancelled', bad);
    clock.advance(1000);
    const good = await enqueue('booking.accepted', uuid());

    let failing = true;
    const publisher = new InMemoryQueuePublisher((_queue, envelope) =>
      failing && envelope.aggregate.id === bad
        ? new Error(`broker unavailable ${'x'.repeat(2000)}`)
        : undefined,
    );
    const first = await relayOutbox(worker(), publisher, clock);
    expect(first).toEqual({ published: 1, failed: 1, deferred: 1 });
    expect(publisher.published.every((m) => m.envelope.id === good.id)).toBe(true);

    const afterFirst = await state();
    const failedRow = afterFirst.find((row) => row.id === badFirst.id);
    expect(failedRow?.published_at).toBeNull();
    expect(failedRow?.attempts).toBe(1);
    expect(failedRow?.last_error?.startsWith('Error: broker unavailable')).toBe(true);
    expect(failedRow?.last_error?.length).toBeLessThanOrEqual(500);
    expect(failedRow?.last_error).not.toContain('PAYLOAD-MARKER');
    // The deferred event of the same aggregate was not touched.
    expect(afterFirst.find((row) => row.id === badSecond.id)).toMatchObject({
      attempts: 0,
      published_at: null,
    });

    failing = false;
    const second = await relayOutbox(worker(), publisher, clock);
    expect(second).toEqual({ published: 2, failed: 0, deferred: 0 });
    const order = publisher.published
      .filter((m) => m.queue === QUEUES.analytics && m.envelope.aggregate.id === bad)
      .map((m) => m.envelope.id);
    expect(order).toEqual([badFirst.id, badSecond.id]);
  });

  it('stops retrying a row that has failed maxAttempts times', async () => {
    await reset();
    await enqueue('booking.accepted', uuid());
    const publisher = new InMemoryQueuePublisher(() => new Error('down'));
    await relayOutbox(worker(), publisher, clock, { maxAttempts: 2 });
    await relayOutbox(worker(), publisher, clock, { maxAttempts: 2 });
    expect(await relayOutbox(worker(), publisher, clock, { maxAttempts: 2 })).toEqual({
      published: 0,
      failed: 0,
      deferred: 0,
    });
    expect((await state())[0]?.attempts).toBe(2);
  });

  it('never publishes the same row twice when two relays run at once', async () => {
    await reset();
    for (let i = 0; i < 10; i += 1) {
      await enqueue('booking.accepted', uuid());
      clock.advance(1000);
    }
    const holding = gate();
    const firstLocked = gate();
    const slow: QueuePublisher = {
      async publish(queue) {
        if (queue === QUEUES.analytics) return;
        firstLocked.open();
        await holding.wait;
      },
    };
    const fast = new InMemoryQueuePublisher();

    // The first relay locks five rows and waits inside its publisher; the second must skip
    // those five, not wait for them, so it can finish while the first is still holding.
    const slowRun = relayOutbox(worker(), slow, clock, { batchSize: 5 });
    await firstLocked.wait;
    const fastResult = await relayOutbox(worker(), fast, clock, { batchSize: 5 });
    expect(fastResult.published).toBe(5);
    holding.open();
    const slowResult = await slowRun;
    expect(slowResult.published).toBe(5);

    const rows = await state();
    expect(rows).toHaveLength(10);
    expect(rows.every((row) => row.published_at !== null && row.attempts === 0)).toBe(true);
    const fastIds = new Set(fast.published.map((m) => m.envelope.id));
    expect(fastIds.size).toBe(5);
  });
});
