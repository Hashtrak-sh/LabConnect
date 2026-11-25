import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  InMemoryQueueConsumer,
  InMemorySearchIndex,
  QUEUES,
  SearchSyncError,
  consumeSearchSyncQueue,
  handleSearchSyncEvent,
  reindexAll,
  type LabSearchDocument,
  type QueueMessage,
  type SearchIndex,
  type SearchSyncDeps,
  type UpsertResult,
} from '../../src/index.js';
import { useSearchWorld } from './search-support.js';

// P3-10: the sync consumer and the reindex job on the real schema, connected as the worker role.

function envelope(
  type: string,
  options: { site?: string; data?: Record<string, unknown>; at?: string } = {},
): string {
  return JSON.stringify({
    id: randomUUID(),
    type,
    version: 1,
    occurredAt: options.at ?? '2026-11-25T10:00:00Z',
    aggregate: options.site
      ? { type: 'lab_site', id: options.site }
      : { type: 'price_list', id: randomUUID() },
    actor: 'SYSTEM',
    data: options.data ?? {},
  });
}
const message = (body: string): QueueMessage => ({ id: 'm', body, receiptHandle: 'h' });

describe('search sync (database)', () => {
  const t = useSearchWorld();
  const deps = (index: SearchIndex): SearchSyncDeps => ({
    prisma: t.platform.worker(),
    index,
    clock: t.clock,
  });
  const siteDocs = (index: InMemorySearchIndex, siteId: string): LabSearchDocument[] =>
    index.all().filter((doc) => doc.labSiteId === siteId);
  const owner = (sql: string, ...values: unknown[]) => t.platform.db().query(sql, values);

  it('indexes the documents of a site from the database, and is idempotent for a duplicate event', async () => {
    const index = new InMemorySearchIndex();
    const site = t.world().a1;
    const body = envelope('lab.became_bookable', { site: site.id });

    expect(await handleSearchSyncEvent(deps(index), message(body))).toBe('acknowledge');
    const first = siteDocs(index, site.id);
    expect(first).toHaveLength(3);
    expect(first.every((doc) => doc.isBookable && doc.pricePaise !== null)).toBe(true);
    expect(index.size).toBe(3);

    // the same event again, and a second event for the same site: nothing changes
    await handleSearchSyncEvent(deps(index), message(body));
    await handleSearchSyncEvent(
      deps(index),
      message(envelope('pricelist.published', { site: site.id })),
    );
    expect(index.size).toBe(3);
    expect(
      siteDocs(index, site.id)
        .map((doc) => doc.scopeLineId)
        .sort(),
    ).toEqual(first.map((doc) => doc.scopeLineId).sort());
  });

  it('removes a site that stopped being visible, and brings it back when it is visible again', async () => {
    const index = new InMemorySearchIndex();
    const { a1, a2 } = t.world();
    await handleSearchSyncEvent(
      deps(index),
      message(envelope('lab.became_bookable', { site: a1.id })),
    );
    await handleSearchSyncEvent(
      deps(index),
      message(envelope('lab.became_bookable', { site: a2.id })),
    );
    expect(index.size).toBe(6);

    await owner(
      `UPDATE lab_site SET listing_status = 'HIDDEN', is_bookable = false WHERE id = $1`,
      a1.id,
    );
    try {
      await handleSearchSyncEvent(
        deps(index),
        message(envelope('lab_site.bookability_changed', { site: a1.id })),
      );
      expect(siteDocs(index, a1.id)).toEqual([]);
      expect(siteDocs(index, a2.id)).toHaveLength(3); // other sites are not touched
    } finally {
      await owner(
        `UPDATE lab_site SET listing_status = 'BOOKABLE', is_bookable = true WHERE id = $1`,
        a1.id,
      );
    }
    await handleSearchSyncEvent(
      deps(index),
      message(envelope('lab_site.bookability_changed', { site: a1.id })),
    );
    expect(siteDocs(index, a1.id)).toHaveLength(3);
  });

  it('removes the documents of a line that was deactivated, keeping the site', async () => {
    const index = new InMemorySearchIndex();
    const { a1 } = t.world();
    await handleSearchSyncEvent(
      deps(index),
      message(envelope('masterdata.published', { site: a1.id })),
    );
    const line = a1.scopeLines[2];
    if (!line) throw new Error('A1 has three lines');
    await owner(`UPDATE scope_line SET status = 'INACTIVE' WHERE id = $1`, line.id);
    try {
      await handleSearchSyncEvent(
        deps(index),
        message(envelope('masterdata.published', { site: a1.id })),
      );
      expect(siteDocs(index, a1.id).map((doc) => doc.scopeLineId)).not.toContain(line.id);
      expect(siteDocs(index, a1.id)).toHaveLength(2);
    } finally {
      await owner(`UPDATE scope_line SET status = 'ACTIVE' WHERE id = $1`, line.id);
    }
  });

  it('never trusts the payload: a stale or false event writes the current state', async () => {
    const index = new InMemorySearchIndex();
    const { a1, hidden } = t.world();
    // an old event says "not bookable", but the site is bookable now: it must be indexed
    await handleSearchSyncEvent(
      deps(index),
      message(
        envelope('lab_site.bookability_changed', {
          site: a1.id,
          data: { isBookable: false, removed: true, at: '2020-01-01T00:00:00Z' },
          at: '2020-01-01T00:00:00Z',
        }),
      ),
    );
    expect(siteDocs(index, a1.id)).toHaveLength(3);
    // an event that claims a site became bookable, for a site whose accreditation expired: absent
    await handleSearchSyncEvent(
      deps(index),
      message(
        envelope('lab.became_bookable', {
          site: hidden.expired.id,
          data: { isBookable: true, documents: [{ scopeLineId: 'x' }] },
        }),
      ),
    );
    expect(siteDocs(index, hidden.expired.id)).toEqual([]);
    expect(index.all().some((doc) => doc.scopeLineId === 'x')).toBe(false);
  });

  it('handles events out of order: whatever order they come in, the index ends up current', async () => {
    const index = new InMemorySearchIndex();
    const { a1 } = t.world();
    const older = envelope('rating.updated', { site: a1.id, at: '2026-11-25T09:00:00Z' });
    const newer = envelope('rating.updated', { site: a1.id, at: '2026-11-25T09:30:00Z' });
    await owner(`UPDATE lab_site SET rating_avg = 4.5, rating_count = 3 WHERE id = $1`, a1.id);
    try {
      await handleSearchSyncEvent(deps(index), message(newer));
      await handleSearchSyncEvent(deps(index), message(older));
      for (const doc of siteDocs(index, a1.id)) {
        expect(doc.ratingAvg).toBe(4.5);
        expect(doc.ratingCount).toBe(3);
      }
    } finally {
      await owner(`UPDATE lab_site SET rating_avg = NULL, rating_count = 0 WHERE id = $1`, a1.id);
    }
  });

  it('keeps the newer projection when an older one is written late (external version)', async () => {
    const index = new InMemorySearchIndex();
    const { a1 } = t.world();
    await handleSearchSyncEvent(deps(index), message(envelope('rating.updated', { site: a1.id })));
    const [current] = siteDocs(index, a1.id);
    if (!current) throw new Error('A1 is indexed');
    const stale: LabSearchDocument = {
      ...current,
      ratingCount: 99,
      projectedAt: new Date(Date.parse(current.projectedAt) - 60_000).toISOString(),
    };
    await index.upsertDocuments([stale]);
    expect(
      siteDocs(index, a1.id).find((doc) => doc.scopeLineId === current.scopeLineId)?.ratingCount,
    ).toBe(0);
  });

  it('handles several sites in one event, and a site that does not exist', async () => {
    const index = new InMemorySearchIndex();
    const { a1, b } = t.world();
    await handleSearchSyncEvent(
      deps(index),
      message(
        envelope('pricelist.published', {
          data: { labSiteIds: [a1.id, b.id, randomUUID(), 'not-a-uuid'] },
        }),
      ),
    );
    expect(siteDocs(index, a1.id)).toHaveLength(3);
    expect(siteDocs(index, b.id)).toHaveLength(1); // B's second line is inactive
  });

  it('refuses an event that names no site, except masterdata.published, which reindexes everything', async () => {
    const index = new InMemorySearchIndex();
    await expect(
      handleSearchSyncEvent(deps(index), message(envelope('pricelist.published'))),
    ).rejects.toBeInstanceOf(SearchSyncError);
    expect(index.size).toBe(0);

    expect(
      await handleSearchSyncEvent(deps(index), message(envelope('masterdata.published'))),
    ).toBe('acknowledge');
    const projected = await t.projected();
    expect(
      index
        .all()
        .map((doc) => doc.scopeLineId)
        .sort(),
    ).toEqual(
      projected
        .all()
        .map((doc) => doc.scopeLineId)
        .sort(),
    );
  });

  it('leaves a message that is not a search event, and one that is not an event at all', async () => {
    const index = new InMemorySearchIndex();
    expect(await handleSearchSyncEvent(deps(index), message(envelope('booking.accepted')))).toBe(
      'leave',
    );
    expect(await handleSearchSyncEvent(deps(index), message('not json'))).toBe('leave');
    expect(await handleSearchSyncEvent(deps(index), message('{"id":1}'))).toBe('leave');
    expect(index.size).toBe(0);
  });

  it('retries the whole message when the index refuses part of it', async () => {
    class FlakyIndex extends InMemorySearchIndex {
      refuse = true;
      override replaceSites(
        ...args: Parameters<InMemorySearchIndex['replaceSites']>
      ): Promise<UpsertResult> {
        if (this.refuse) return Promise.resolve({ written: 0, failed: ['some-document'] });
        return super.replaceSites(...args);
      }
    }
    const index = new FlakyIndex();
    const queue = new InMemoryQueueConsumer();
    queue.send(QUEUES.searchSync, envelope('rating.updated', { site: t.world().a1.id }));
    const first = await consumeSearchSyncQueue(queue, deps(index));
    expect(first).toMatchObject({ received: 1, failed: 1, acknowledged: 0 });
    expect(queue.pending(QUEUES.searchSync)).toBe(1);

    index.refuse = false;
    queue.redeliver(QUEUES.searchSync);
    const second = await consumeSearchSyncQueue(queue, deps(index));
    expect(second).toMatchObject({ received: 1, failed: 0, acknowledged: 1 });
    expect(queue.pending(QUEUES.searchSync)).toBe(0);
    expect(index.size).toBe(3);
  });

  it('reindexes in batches, resumes from its cursor, and removes sites that are no longer visible', async () => {
    const index = new InMemorySearchIndex();
    const reference = await t.projected();
    const visibleDocs = reference.size;

    const partial = await reindexAll(deps(index), { batchSize: 2, maxBatches: 2 });
    expect(partial.cursor).toMatch(/^build:/);
    expect(partial.sitesProcessed).toBe(4);
    expect(index.size).toBeLessThan(visibleDocs);

    const done = await reindexAll(deps(index), { batchSize: 2, cursor: partial.cursor });
    expect(done.cursor).toBeNull();
    expect(partial.sitesProcessed + done.sitesProcessed).toBe(t.world().visibleSiteIds.length);
    expect(index.size).toBe(visibleDocs);

    // a second run changes nothing
    const again = await reindexAll(deps(index), { batchSize: 3 });
    expect(again.cursor).toBeNull();
    expect(again.sitesRemoved).toBe(0);
    expect(index.size).toBe(visibleDocs);

    // a site that is indexed but no longer visible is pruned, also across a resumed run
    const { b } = t.world();
    await owner(
      `UPDATE lab_site SET listing_status = 'HIDDEN', is_bookable = false WHERE id = $1`,
      b.id,
    );
    try {
      const first = await reindexAll(deps(index), { batchSize: 100, maxBatches: 2 });
      expect(first.cursor).toMatch(/^prune:/);
      const rest = await reindexAll(deps(index), { batchSize: 100, cursor: first.cursor });
      expect(first.sitesRemoved + rest.sitesRemoved).toBe(1);
      expect(rest.cursor).toBeNull();
      expect(siteDocs(index, b.id)).toEqual([]);
      expect(index.size).toBe(visibleDocs - 1);
    } finally {
      await owner(
        `UPDATE lab_site SET listing_status = 'BOOKABLE', is_bookable = true WHERE id = $1`,
        b.id,
      );
    }
  });

  it('refuses a reindex cursor it did not issue', async () => {
    await expect(
      reindexAll(deps(new InMemorySearchIndex()), { cursor: 'nonsense' }),
    ).rejects.toThrow(RangeError);
  });
});
