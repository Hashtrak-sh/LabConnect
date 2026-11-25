import type { PrismaClient } from '@labconnect/database';
import type { Clock } from '../platform/clock.js';
import type { EventEnvelope } from '../platform/events.js';
import {
  type ConsumeResult,
  type MessageDisposition,
  type QueueConsumer,
  type QueueMessage,
  type ReceiveOptions,
  consumeBatch,
} from '../platform/queue-consumer.js';
import { QUEUES } from '../platform/routes.js';
import type { SearchIndex } from './index-port.js';
import { buildLabSearchDocuments, reindexAll } from './projector.js';
import { withPublicReadContext } from './public-context.js';

/**
 * The events that change what search shows (SEARCH.md section 2, plus the two notification
 * events that already exist and also change a site's visibility). Routed to `lc-search-sync` in
 * `platform/routes.ts` (`SEARCH_SYNC_EVENT_TYPES` there must list the same codes; a test checks
 * it). The modules that emit the events named here do not all exist yet (OQ-64, OQ-158).
 */
export const SEARCH_SYNC_EVENTS = [
  'masterdata.published',
  'pricelist.published',
  'lab_site.bookability_changed',
  'slot.capacity_changed',
  'rating.updated',
  'accreditation.changed',
  'lab.became_bookable',
] as const;

/** An event of these types without any site id means "everything may have changed". */
const REINDEX_ALL_WHEN_NO_SITE: ReadonlySet<string> = new Set(['masterdata.published']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SITES_PER_EVENT = 500;

export interface SearchSyncEvent {
  eventId: string;
  type: string;
  /** Distinct site ids named by the event. May be empty. */
  labSiteIds: string[];
}

/**
 * Reads the site ids out of an event and nothing else. The ids are the only part of the payload
 * the sync uses: what a site looks like now is read from the database, never taken from the
 * event (an event may arrive late, twice or out of order).
 *
 * A site id is the aggregate id when the aggregate is a `lab_site`, or `data.labSiteId`, or
 * every entry of `data.labSiteIds`. Returns `null` for a message that is not a search event.
 */
export function parseSearchSyncMessage(body: string): SearchSyncEvent | null {
  let envelope: Partial<EventEnvelope>;
  try {
    envelope = JSON.parse(body) as Partial<EventEnvelope>;
  } catch {
    return null;
  }
  if (
    typeof envelope.id !== 'string' ||
    typeof envelope.type !== 'string' ||
    !(SEARCH_SYNC_EVENTS as readonly string[]).includes(envelope.type)
  ) {
    return null;
  }
  const ids = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === 'string' && UUID.test(value)) ids.add(value.toLowerCase());
  };
  if (envelope.aggregate?.type === 'lab_site') add(envelope.aggregate.id);
  const data = envelope.data;
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    add(data.labSiteId);
    if (Array.isArray(data.labSiteIds)) data.labSiteIds.forEach(add);
  }
  if (ids.size > MAX_SITES_PER_EVENT) return null;
  return { eventId: envelope.id, type: envelope.type, labSiteIds: [...ids] };
}

export interface SearchSyncDeps {
  prisma: Pick<PrismaClient, '$transaction'>;
  index: SearchIndex;
  clock: Clock;
}

export class SearchSyncError extends Error {
  override name = 'SearchSyncError';
}

/**
 * One message of the `lc-search-sync` queue: re-projects the affected sites from the source of
 * truth and makes the index hold exactly that (`replaceSites`): documents upserted, and a site
 * that is no longer visible removed.
 *
 * - Idempotent: running it twice, or after a duplicate delivery, gives the same index.
 * - Order-insensitive: it never reads the event's content beyond ids, so an older event handled
 *   after a newer one still writes the current state; and the index refuses an older projection
 *   over a newer one (external version).
 * - An event of a search type with no usable site id: `masterdata.published` reindexes
 *   everything (a taxonomy or synonym change can touch any line); any other type throws, so the
 *   message is redelivered and ends in the dead-letter queue where someone sees it.
 * - A message of another type is left on the queue, as the files consumer does.
 * - A partial failure of the index write throws, so the whole message is retried.
 *
 * Nothing about the message is logged here.
 */
export async function handleSearchSyncEvent(
  deps: SearchSyncDeps,
  message: QueueMessage,
): Promise<MessageDisposition> {
  const event = parseSearchSyncMessage(message.body);
  if (event === null) return 'leave';

  if (event.labSiteIds.length === 0) {
    if (!REINDEX_ALL_WHEN_NO_SITE.has(event.type)) {
      throw new SearchSyncError(`A ${event.type} event names no site.`);
    }
    const result = await reindexAll(deps, {});
    if (result.failed.length > 0)
      throw new SearchSyncError('The reindex left documents unwritten.');
    return 'acknowledge';
  }

  const at = deps.clock.now();
  const projection = await withPublicReadContext(deps.prisma, (tx) =>
    buildLabSearchDocuments(tx, { labSiteIds: event.labSiteIds }, at),
  );
  const written = await deps.index.replaceSites(projection.sites);
  if (written.failed.length > 0) {
    throw new SearchSyncError('The index refused some documents.');
  }
  return 'acknowledge';
}

/** One pass over the `lc-search-sync` queue. */
export function consumeSearchSyncQueue(
  consumer: QueueConsumer,
  deps: SearchSyncDeps,
  options?: ReceiveOptions,
): Promise<ConsumeResult> {
  return consumeBatch(
    consumer,
    QUEUES.searchSync,
    (message) => handleSearchSyncEvent(deps, message),
    options,
  );
}
