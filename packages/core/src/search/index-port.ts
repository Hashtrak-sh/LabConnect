import type {
  LabSearchDocument,
  SearchBackend,
  SearchPage,
  SearchQuery,
  SiteDocuments,
} from './model.js';

export interface UpsertResult {
  /** Documents written. */
  written: number;
  /** Document ids the index refused (a bulk request can fail in part). They are retried by the next sync. */
  failed: string[];
}

/**
 * The search index port (SYSTEM_ARCHITECTURE section 6, adapter `SearchIndex`). Two adapters
 * answer queries with the same visibility rules: `PostgresSearchIndex` (reads the relational
 * tables itself, the fallback) and `OpenSearchSearchIndex` (reads a derived index that the sync
 * keeps current). `InMemorySearchIndex` is the fake for tests.
 *
 * Only the query is needed by every adapter. The writing methods are the sync's: the Postgres
 * adapter has no index of its own to write to, so they do nothing there.
 */
export interface SearchIndex {
  readonly backend: SearchBackend;

  /** Creates the versioned index and the alias if they are missing. Idempotent. */
  ensureIndex(): Promise<void>;

  /** Sites ordered by the query's sort, one page. `nextCursor` is `null` on the last page. */
  search(query: SearchQuery): Promise<SearchPage>;

  /** Inserts or replaces documents by `scopeLineId`. A document older than the stored one is ignored. */
  upsertDocuments(documents: LabSearchDocument[]): Promise<UpsertResult>;

  /** Removes documents by `scopeLineId`. Unknown ids are not an error. */
  deleteDocuments(scopeLineIds: string[]): Promise<void>;

  /**
   * Makes the index hold exactly `documents` for each given site: upserts them and removes every
   * other document of those sites. A site with no documents is removed from the index (it
   * stopped being visible). Returns the ids that failed to be written.
   */
  replaceSites(sites: SiteDocuments[]): Promise<UpsertResult>;

  /**
   * Site ids that have documents in the index, in id order, after `after`: how a reindex finds
   * sites that have stopped being visible. The Postgres adapter has no index and returns none.
   */
  listSiteIds(after: string | null, limit: number): Promise<string[]>;

  /** `true` when the backend answers. Used by the service's health check; never throws. */
  isHealthy(): Promise<boolean>;
}
