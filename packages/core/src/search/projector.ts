import { Prisma, type PrismaClient } from '@labconnect/database';
import type { Clock } from '../platform/clock.js';
import type { SearchIndex } from './index-port.js';
import type { LabSearchDocument, SiteDocuments } from './model.js';
import { withPublicReadContext } from './public-context.js';
import { type VisibleLineRow, rowToDocument, visibleLinesSql } from './visible-lines.js';

export type ProjectionScope =
  /** These sites. A site that is not visible comes back with no documents, so the caller removes it. */
  | { labSiteIds: string[] }
  /** The next `limit` visible sites after `after` (site id order), for batched reindexing. */
  | { all: true; after: string | null; limit: number };

export interface ProjectionResult {
  sites: SiteDocuments[];
  /** For `all`: the last site id of the batch, or `null` when no site was left. */
  lastSiteId: string | null;
}

function groupBySite(rows: VisibleLineRow[], projectedAt: Date): Map<string, LabSearchDocument[]> {
  const bySite = new Map<string, LabSearchDocument[]>();
  for (const row of rows) {
    const list = bySite.get(row.lab_site_id) ?? [];
    list.push(rowToDocument(row, projectedAt));
    bySite.set(row.lab_site_id, list);
  }
  return bySite;
}

/**
 * Builds the index documents from the source of truth (SEARCH.md section 2: "always re-read
 * current state"). Runs on the transaction it is given, which must be an anonymous public one
 * (`withPublicReadContext`): the projector reads only what a visitor may read, so a document
 * cannot carry a draft price or a tenant column the database would not show a visitor.
 *
 * `visibleLinesSql` decides what is visible; the documents of a site are exactly the rows it
 * returns, ordered by scope line id.
 */
export async function buildLabSearchDocuments(
  tx: Prisma.TransactionClient,
  scope: ProjectionScope,
  at: Date,
): Promise<ProjectionResult> {
  const visible = visibleLinesSql(at, { nextSlot: true });
  if ('labSiteIds' in scope) {
    if (scope.labSiteIds.length === 0) return { sites: [], lastSiteId: null };
    const rows = await tx.$queryRaw<VisibleLineRow[]>`
      SELECT v.* FROM (${visible}) v
       WHERE v.lab_site_id = ANY(${scope.labSiteIds}::uuid[])
       ORDER BY v.lab_site_id, v.scope_line_id`;
    const bySite = groupBySite(rows, at);
    return {
      sites: [...new Set(scope.labSiteIds)].map((labSiteId) => ({
        labSiteId,
        documents: bySite.get(labSiteId) ?? [],
      })),
      lastSiteId: null,
    };
  }
  const after = scope.after ?? '00000000-0000-0000-0000-000000000000';
  const rows = await tx.$queryRaw<VisibleLineRow[]>`
    WITH v AS (${visible}),
    batch AS (
      SELECT DISTINCT lab_site_id FROM v WHERE lab_site_id > ${after}::uuid
       ORDER BY lab_site_id LIMIT ${scope.limit}
    )
    SELECT v.* FROM v JOIN batch USING (lab_site_id)
     ORDER BY v.lab_site_id, v.scope_line_id`;
  const bySite = groupBySite(rows, at);
  const sites = [...bySite.entries()].map(([labSiteId, documents]) => ({ labSiteId, documents }));
  return { sites, lastSiteId: sites.at(-1)?.labSiteId ?? null };
}

export interface ReindexDeps {
  prisma: Pick<PrismaClient, '$transaction'>;
  index: SearchIndex;
  clock: Clock;
}

export interface ReindexOptions {
  /** Sites per batch. Default 100. */
  batchSize?: number;
  /** Where the last run stopped (`ReindexResult.cursor`). Omit to start from the beginning. */
  cursor?: string | null;
  /** Stop after this many batches and return a cursor, so a job can bound its run. Default: run to the end. */
  maxBatches?: number;
}

export interface ReindexResult {
  sitesProcessed: number;
  documentsWritten: number;
  /** Sites removed from the index because they are no longer visible. */
  sitesRemoved: number;
  /** Document ids the index refused. */
  failed: string[];
  /** `null` when the reindex finished; otherwise pass it back to continue. */
  cursor: string | null;
}

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Full reindex, for the first load and for repair (SEARCH.md section 2, the "backstop"). Two
 * phases, resumable from the cursor between any two batches:
 *
 * 1. `build`: every visible site, in site id order, is projected and written (`replaceSites`).
 * 2. `prune`: every site id found in the index that is no longer visible is removed.
 *
 * Idempotent: running it twice gives the same index. It reads current state in each batch, so a
 * site that changed between batches is simply written with its newer state.
 */
export async function reindexAll(
  deps: ReindexDeps,
  options: ReindexOptions = {},
): Promise<ReindexResult> {
  const batchSize = options.batchSize ?? 100;
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY;
  const result: ReindexResult = {
    sitesProcessed: 0,
    documentsWritten: 0,
    sitesRemoved: 0,
    failed: [],
    cursor: null,
  };
  let phase: 'build' | 'prune' = 'build';
  let after: string | null = null;
  if (options.cursor) {
    const [name, id] = options.cursor.split(':');
    if ((name === 'build' || name === 'prune') && id !== undefined && id.length > 0) {
      phase = name;
      after = id === ZERO_UUID ? null : id;
    } else {
      throw new RangeError('The reindex cursor is not one this job issued.');
    }
  }

  let batches = 0;
  while (phase === 'build') {
    if (batches >= maxBatches) {
      return { ...result, cursor: `build:${after ?? ZERO_UUID}` };
    }
    const at = deps.clock.now();
    const batch = await withPublicReadContext(deps.prisma, (tx) =>
      buildLabSearchDocuments(tx, { all: true, after, limit: batchSize }, at),
    );
    batches += 1;
    if (batch.lastSiteId === null) {
      phase = 'prune';
      after = null;
      continue;
    }
    const written = await deps.index.replaceSites(batch.sites);
    result.sitesProcessed += batch.sites.length;
    result.documentsWritten +=
      batch.sites.reduce((sum, site) => sum + site.documents.length, 0) - written.failed.length;
    result.failed.push(...written.failed);
    after = batch.lastSiteId;
  }

  for (;;) {
    if (batches >= maxBatches) {
      return { ...result, cursor: `prune:${after ?? ZERO_UUID}` };
    }
    const indexed = await deps.index.listSiteIds(after, batchSize);
    batches += 1;
    if (indexed.length === 0) break;
    const at = deps.clock.now();
    const current = await withPublicReadContext(deps.prisma, (tx) =>
      buildLabSearchDocuments(tx, { labSiteIds: indexed }, at),
    );
    const gone = current.sites.filter((site) => site.documents.length === 0);
    if (gone.length > 0) {
      await deps.index.replaceSites(gone);
      result.sitesRemoved += gone.length;
    }
    after = indexed.at(-1) ?? after;
  }
  return result;
}
