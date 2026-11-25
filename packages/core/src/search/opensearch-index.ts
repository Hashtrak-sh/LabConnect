import { decodeCursor, encodeCursor } from './cursor.js';
import type { SearchIndex, UpsertResult } from './index-port.js';
import {
  type LabSearchDocument,
  MAX_MATCHED_LINES,
  type SearchPage,
  type SearchQuery,
  type SiteAccreditation,
  type SiteDocuments,
  type SiteSearchResult,
} from './model.js';
import { type OpenSearchConfig, indexName } from './opensearch-config.js';
import {
  LINE_TEXT_QUERY,
  MAX_RESULT_WINDOW,
  buildSearchBody,
  hasLineFilters,
} from './opensearch-dsl.js';
import {
  INDEX_MAPPINGS,
  INDEX_SETTINGS,
  type IndexedSource,
  fromSource,
  toSource,
} from './opensearch-mapping.js';
import {
  accreditationKey,
  documentToAccreditation,
  documentToMatchedLine,
  documentToSite,
  haversineMetres,
} from './result-mapping.js';

/**
 * The part of `@opensearch-project/opensearch`'s `Client` that the adapter calls. Declared with
 * method syntax so the real client is assignable to it, and so a unit test can stub it.
 */
export interface OpenSearchClientLike {
  search(params: { index: string; body: unknown }): Promise<{ body: unknown }>;
  bulk(params: { index: string; body: unknown[]; refresh?: boolean }): Promise<{ body: unknown }>;
  deleteByQuery(params: {
    index: string;
    body: unknown;
    conflicts?: string;
    refresh?: boolean;
  }): Promise<{ body: unknown }>;
  indices: {
    existsAlias(params: { name: string }): Promise<{ body: unknown }>;
    create(params: { index: string; body: unknown }): Promise<{ body: unknown }>;
  };
  cluster: {
    health(params?: { timeout?: string }): Promise<{ body: unknown }>;
  };
}

export type OpenSearchClientProvider = () => Promise<OpenSearchClientLike>;

/** Builds the real client on first use, so importing this module never loads the driver. */
export function createOpenSearchClientProvider(config: OpenSearchConfig): OpenSearchClientProvider {
  let client: Promise<OpenSearchClientLike> | undefined;
  return () => {
    client ??= import('@opensearch-project/opensearch').then(
      ({ Client }) =>
        new Client({
          node: config.node,
          requestTimeout: config.requestTimeoutMs,
          maxRetries: 0,
          ...(config.auth.mode === 'basic'
            ? { auth: { username: config.auth.username, password: config.auth.password } }
            : {}),
        }) as unknown as OpenSearchClientLike,
    );
    return client;
  };
}

interface InnerHit {
  _source?: IndexedSource;
  matched_queries?: string[] | Record<string, number>;
}
interface InnerHits {
  hits: { total?: { value: number }; hits: InnerHit[] };
}
interface SearchHit {
  _source: IndexedSource;
  inner_hits?: Record<string, InnerHits | undefined>;
}
interface SearchResponse {
  hits: { hits: SearchHit[] };
  aggregations?: { sites?: { value?: number } };
}
interface BulkResponse {
  errors?: boolean;
  items?: Record<string, { _id?: string; status?: number; error?: unknown } | undefined>[];
}

const matchedQueryNames = (hit: InnerHit): string[] =>
  Array.isArray(hit.matched_queries) ? hit.matched_queries : Object.keys(hit.matched_queries ?? {});

/**
 * The search index in OpenSearch (SEARCH.md section 1 and 2): `<alias>_v<version>` behind an
 * alias, one document per scope line. Documents are written with the projection time as an
 * external version (`external_gte`), so an older projection that arrives late cannot overwrite
 * a newer one (the sync is order-insensitive). Search is only this adapter's job; deciding what
 * is visible is the projector's.
 *
 * Reads and writes go through the alias. Failures are thrown (the service falls back to
 * Postgres on a failed search); `isHealthy` never throws.
 */
export class OpenSearchSearchIndex implements SearchIndex {
  readonly backend = 'opensearch' as const;
  private readonly index: string;

  constructor(
    private readonly getClient: OpenSearchClientProvider,
    private readonly config: Pick<OpenSearchConfig, 'alias' | 'version'>,
  ) {
    this.index = indexName(config);
  }

  async ensureIndex(): Promise<void> {
    const client = await this.getClient();
    const alias = await client.indices.existsAlias({ name: this.config.alias });
    if (alias.body === true) return;
    try {
      await client.indices.create({
        index: this.index,
        body: {
          settings: INDEX_SETTINGS,
          mappings: INDEX_MAPPINGS,
          aliases: { [this.config.alias]: { is_write_index: true } },
        },
      });
    } catch (error) {
      // Another process created it first: that is the state we wanted.
      if (!JSON.stringify(error).includes('resource_already_exists_exception')) throw error;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const client = await this.getClient();
      const { body } = await client.cluster.health({ timeout: '1s' });
      return (body as { status?: string }).status !== 'red';
    } catch {
      return false;
    }
  }

  async search(query: SearchQuery): Promise<SearchPage> {
    const client = await this.getClient();
    const { body } = await client.search({
      index: this.config.alias,
      body: buildSearchBody(query),
    });
    return this.toPage(query, body as SearchResponse);
  }

  async upsertDocuments(documents: LabSearchDocument[]): Promise<UpsertResult> {
    if (documents.length === 0) return { written: 0, failed: [] };
    const client = await this.getClient();
    const body: unknown[] = [];
    for (const document of documents) {
      body.push({
        index: {
          _id: document.scopeLineId,
          version: Date.parse(document.projectedAt),
          version_type: 'external_gte',
        },
      });
      body.push(toSource(document));
    }
    const response = await client.bulk({ index: this.config.alias, body });
    return this.bulkResult(documents.length, response.body as BulkResponse);
  }

  async deleteDocuments(scopeLineIds: string[]): Promise<void> {
    if (scopeLineIds.length === 0) return;
    const client = await this.getClient();
    const response = await client.bulk({
      index: this.config.alias,
      body: scopeLineIds.map((id) => ({ delete: { _id: id } })),
    });
    // A delete of a missing document is a 404 item: that is not a failure here.
    const failed = this.bulkResult(scopeLineIds.length, response.body as BulkResponse, [404]);
    if (failed.failed.length > 0) throw new Error('OpenSearch did not delete some documents.');
  }

  async replaceSites(sites: SiteDocuments[]): Promise<UpsertResult> {
    const documents = sites.flatMap((site) => site.documents);
    const result = await this.upsertDocuments(documents);
    const client = await this.getClient();
    for (const site of sites) {
      const keep = site.documents.map((document) => document.scopeLineId);
      await client.deleteByQuery({
        index: this.config.alias,
        conflicts: 'proceed',
        body: {
          query: {
            bool: {
              filter: [{ term: { lab_site_id: site.labSiteId } }],
              ...(keep.length > 0 ? { must_not: [{ ids: { values: keep } }] } : {}),
            },
          },
        },
      });
    }
    return result;
  }

  async listSiteIds(after: string | null, limit: number): Promise<string[]> {
    const client = await this.getClient();
    const { body } = await client.search({
      index: this.config.alias,
      body: {
        size: 0,
        aggs: {
          sites: {
            composite: {
              size: limit,
              sources: [{ id: { terms: { field: 'lab_site_id' } } }],
              ...(after === null ? {} : { after: { id: after } }),
            },
          },
        },
      },
    });
    const buckets = (body as { aggregations?: { sites?: { buckets?: { key: { id: string } }[] } } })
      .aggregations?.sites?.buckets;
    return (buckets ?? []).map((bucket) => bucket.key.id);
  }

  private bulkResult(
    count: number,
    response: BulkResponse,
    tolerated: number[] = [],
  ): UpsertResult {
    if (response.errors !== true) return { written: count, failed: [] };
    const failed: string[] = [];
    for (const item of response.items ?? []) {
      const entry = Object.values(item)[0];
      if (entry?.error === undefined) continue;
      // 409: the stored document is newer than this projection: nothing to retry.
      if (
        entry.status === 409 ||
        (entry.status !== undefined && tolerated.includes(entry.status))
      ) {
        continue;
      }
      if (entry._id !== undefined) failed.push(entry._id);
    }
    return { written: count - failed.length, failed };
  }

  private toPage(query: SearchQuery, response: SearchResponse): SearchPage {
    const hits = response.hits.hits;
    const hasMore = hits.length > query.limit;
    const pageHits = hasMore ? hits.slice(0, query.limit) : hits;
    const items = pageHits.map((hit) => this.toResult(query, hit));
    const last = pageHits.at(-1);
    const offset =
      (query.cursor === null ? 0 : decodeCursor('opensearch', query.cursor).k) + query.limit;
    const nextCursor =
      hasMore && last !== undefined && offset + query.limit + 1 <= MAX_RESULT_WINDOW
        ? encodeCursor('opensearch', { k: offset, id: last._source.lab_site_id })
        : null;
    return {
      items,
      // A cardinality aggregation: exact below the precision threshold, an estimate above it.
      total: Math.round(response.aggregations?.sites?.value ?? items.length),
      nextCursor,
    };
  }

  private toResult(query: SearchQuery, hit: SearchHit): SiteSearchResult {
    const representative = fromSource(hit._source);
    const lines = hit.inner_hits?.lines;
    const lineHits = lines?.hits.hits ?? [];
    const lineTotal = lines?.hits.total?.value ?? lineHits.length;
    const textOn = query.terms.length > 0;

    // Which of the returned lines are "matched" lines: with text, those the line text matched
    // (a site found by name only has none, per the contract); with filters only, every line.
    let matched: LabSearchDocument[];
    let matchedLineCount: number;
    if (textOn) {
      const flagged = lineHits.filter((line) => matchedQueryNames(line).includes(LINE_TEXT_QUERY));
      matched = flagged.flatMap((line) =>
        line._source === undefined ? [] : [fromSource(line._source)],
      );
      // Lines are returned best first, so when all returned lines matched, the others (up to the
      // total) are counted as matched; otherwise only the flagged ones are known to be.
      matchedLineCount =
        flagged.length === 0 ? 0 : flagged.length === lineHits.length ? lineTotal : flagged.length;
    } else if (hasLineFilters(query)) {
      matched = lineHits.flatMap((line) =>
        line._source === undefined ? [] : [fromSource(line._source)],
      );
      matchedLineCount = lineTotal;
    } else {
      matched = [];
      matchedLineCount = 0;
    }
    matched = matched.slice(0, MAX_MATCHED_LINES);

    // Price from: the matched lines when they are all returned, else the cheapest line of the site.
    const poolPrices =
      matched.length > 0 && matched.length === matchedLineCount
        ? matched.map((doc) => doc.pricePaise).filter((price): price is bigint => price !== null)
        : null;
    const cheapest = firstSource(hit.inner_hits?.cheapest);
    const fastest = firstSource(hit.inner_hits?.fastest);
    const priceFromPaise =
      poolPrices !== null
        ? poolPrices.length === 0
          ? null
          : poolPrices.reduce((a, b) => (b < a ? b : a))
        : cheapest?.price_paise == null
          ? null
          : BigInt(cheapest.price_paise);
    const poolTats =
      poolPrices !== null
        ? matched.map((doc) => doc.tatDays).filter((t): t is number => t !== null)
        : null;
    const minTatDays =
      poolTats !== null
        ? poolTats.length === 0
          ? null
          : Math.min(...poolTats)
        : (fastest?.tat_days ?? null);

    const accreditations = new Map<string, SiteAccreditation>();
    for (const inner of hit.inner_hits?.accreditations?.hits.hits ?? []) {
      if (inner._source === undefined) continue;
      const doc = fromSource(inner._source);
      accreditations.set(accreditationKey(doc.accreditation), documentToAccreditation(doc));
    }
    for (const doc of matched) {
      const key = accreditationKey(doc.accreditation);
      if (!accreditations.has(key)) accreditations.set(key, documentToAccreditation(doc));
    }
    if (accreditations.size === 0) {
      accreditations.set(
        accreditationKey(representative.accreditation),
        documentToAccreditation(representative),
      );
    }

    const distanceM =
      query.location === null || representative.location === null
        ? null
        : haversineMetres(query.location, representative.location);
    return {
      site: documentToSite(representative, [...accreditations.values()]),
      distanceKm: distanceM === null ? null : Math.round(distanceM) / 1000,
      priceFromPaise,
      minTatDays,
      nextSlotAt: representative.nextSlotAt,
      matchedLines: matched.map(documentToMatchedLine),
      matchedLineCount,
    };
  }
}

function firstSource(
  inner: InnerHits | undefined,
): { price_paise?: number | null; tat_days?: number | null } | undefined {
  return inner?.hits.hits[0]?._source;
}
