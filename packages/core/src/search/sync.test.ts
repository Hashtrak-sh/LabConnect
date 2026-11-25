import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FixedClock } from '../platform/clock.js';
import { InMemoryQueueConsumer } from '../platform/queue-consumer.js';
import { QUEUES, SEARCH_SYNC_EVENT_TYPES, queuesFor } from '../platform/routes.js';
import { InMemorySearchIndex } from './memory-index.js';
import {
  SEARCH_SYNC_EVENTS,
  SearchSyncError,
  consumeSearchSyncQueue,
  handleSearchSyncEvent,
  parseSearchSyncMessage,
} from './sync.js';

const SITE = '0190d6a2-7c4e-7a1b-9c3d-0123456789ab';
const OTHER = '0190d6a2-7c4e-7a1b-9c3d-0123456789ac';

const envelope = (overrides: Record<string, unknown>): string =>
  JSON.stringify({
    id: randomUUID(),
    type: 'pricelist.published',
    version: 1,
    occurredAt: '2026-11-25T10:00:00Z',
    aggregate: { type: 'price_list', id: randomUUID() },
    actor: 'SYSTEM',
    data: {},
    ...overrides,
  });

describe('parseSearchSyncMessage', () => {
  it('takes the site from the aggregate, from data.labSiteId and from data.labSiteIds', () => {
    expect(
      parseSearchSyncMessage(envelope({ aggregate: { type: 'lab_site', id: SITE } }))?.labSiteIds,
    ).toEqual([SITE]);
    expect(parseSearchSyncMessage(envelope({ data: { labSiteId: SITE } }))?.labSiteIds).toEqual([
      SITE,
    ]);
    expect(
      parseSearchSyncMessage(envelope({ data: { labSiteIds: [SITE, OTHER, SITE.toUpperCase()] } }))
        ?.labSiteIds,
    ).toEqual([SITE, OTHER]);
  });

  it('ignores everything in the payload that is not a site id', () => {
    const event = parseSearchSyncMessage(
      envelope({
        data: {
          labSiteId: 'not-a-uuid',
          documents: [{ scopeLineId: 'x' }],
          isBookable: false,
          price: 1,
        },
      }),
    );
    expect(event?.labSiteIds).toEqual([]);
    expect(Object.keys(event ?? {}).sort()).toEqual(['eventId', 'labSiteIds', 'type']);
  });

  it('does not take the aggregate id of another kind of aggregate for a site', () => {
    expect(
      parseSearchSyncMessage(envelope({ aggregate: { type: 'price_list', id: SITE } }))?.labSiteIds,
    ).toEqual([]);
  });

  it('returns null for what is not a search event', () => {
    expect(parseSearchSyncMessage('nope')).toBeNull();
    expect(parseSearchSyncMessage(envelope({ type: 'booking.accepted' }))).toBeNull();
    expect(parseSearchSyncMessage(envelope({ id: 5 }))).toBeNull();
    const many = Array.from({ length: 501 }, () => randomUUID());
    expect(parseSearchSyncMessage(envelope({ data: { labSiteIds: many } }))).toBeNull();
  });
});

describe('the routes of the search events', () => {
  it('lists the same event codes in the platform routes and in the consumer', () => {
    expect([...SEARCH_SYNC_EVENT_TYPES].sort()).toEqual([...SEARCH_SYNC_EVENTS].sort());
  });

  it('sends each of them to lc-search-sync, and keeps the notification and analytics routes', () => {
    for (const type of SEARCH_SYNC_EVENTS) {
      expect(queuesFor(type)).toContain(QUEUES.searchSync);
      expect(queuesFor(type).at(-1)).toBe(QUEUES.analytics);
    }
    expect(queuesFor('accreditation.changed')).toEqual([
      QUEUES.notifications,
      QUEUES.searchSync,
      QUEUES.analytics,
    ]);
    expect(queuesFor('rating.updated')).toEqual([QUEUES.searchSync, QUEUES.analytics]);
    expect(queuesFor('booking.accepted')).toEqual([QUEUES.notifications, QUEUES.analytics]);
  });
});

describe('handleSearchSyncEvent without a database', () => {
  const deps = {
    // Never reached: these cases end before the database is used.
    prisma: {
      $transaction: () => Promise.reject(new Error('the database must not be used')),
    },
    index: new InMemorySearchIndex(),
    clock: new FixedClock('2026-11-25T10:00:00Z'),
  };
  const message = (body: string) => ({ id: 'm', body, receiptHandle: 'h' });

  it('leaves what is not a search event', async () => {
    expect(await handleSearchSyncEvent(deps, message('{}'))).toBe('leave');
    expect(
      await handleSearchSyncEvent(deps, message(envelope({ type: 'payment.succeeded' }))),
    ).toBe('leave');
  });

  it('throws for a search event that names no site (it is redelivered, then dead-lettered)', async () => {
    await expect(handleSearchSyncEvent(deps, message(envelope({})))).rejects.toBeInstanceOf(
      SearchSyncError,
    );
    const queue = new InMemoryQueueConsumer();
    queue.send(QUEUES.searchSync, envelope({ type: 'rating.updated' }));
    queue.send(QUEUES.searchSync, envelope({ type: 'booking.accepted' }));
    const result = await consumeSearchSyncQueue(queue, deps);
    expect(result).toEqual({ received: 2, acknowledged: 0, failed: 1, left: 1 });
  });
});
