import type { PrismaClient } from '@labconnect/database';
import type { Clock } from '../platform/clock.js';
import type { SearchIndex } from './index-port.js';
import type { SearchRequest } from './model.js';
import { readOpenSearchConfig } from './opensearch-config.js';
import { OpenSearchSearchIndex, createOpenSearchClientProvider } from './opensearch-index.js';
import { PostgresSearchIndex } from './postgres-index.js';
import {
  type CircuitState,
  type SearchResult,
  SearchService,
  type SearchServiceOptions,
} from './service.js';
import { type Suggestion, SuggestService } from './suggest.js';
import { CachedSynonymSource, PostgresSynonymSource } from './synonyms.js';

type Env = Record<string, string | undefined>;

/**
 * The OpenSearch index when `OPENSEARCH_URL` is set, otherwise `null`. Building it opens no
 * connection: the driver is loaded and the client created at the first request.
 */
export function createPrimaryIndex(env: Env = process.env): OpenSearchSearchIndex | null {
  const config = readOpenSearchConfig(env);
  return config === null
    ? null
    : new OpenSearchSearchIndex(createOpenSearchClientProvider(config), config);
}

export interface SearchRuntimeDeps {
  prisma: Pick<PrismaClient, '$transaction'>;
  clock: Clock;
  env?: Env;
  logger?: { warn(message: string): void };
  options?: SearchServiceOptions;
}

/**
 * The public face the API providers hold: `SearchService` built on first use, so an API
 * without a database or an OpenSearch cluster still boots (tests, first deployment), and a bad
 * `OPENSEARCH_*` setting is reported by the first search, not by a crashed start.
 */
export class LazySearchService {
  private service: SearchService | undefined;
  private suggestions: SuggestService | undefined;
  private synonymSource: CachedSynonymSource | undefined;

  constructor(private readonly deps: SearchRuntimeDeps) {}

  async search(request: SearchRequest): Promise<SearchResult> {
    // `get` may throw (a bad OPENSEARCH_* setting): that must be a rejection, like any search error.
    return await this.get().search(request);
  }

  /** Typeahead (`suggestSearch`), with the same synonym cache as the search. */
  async suggest(text: string): Promise<Suggestion[]> {
    this.suggestions ??= new SuggestService({
      prisma: this.deps.prisma,
      clock: this.deps.clock,
      synonyms: this.synonyms(),
    });
    return await this.suggestions.suggest(text);
  }

  circuit(): CircuitState {
    return this.service?.circuit() ?? 'closed';
  }

  private synonyms(): CachedSynonymSource {
    this.synonymSource ??= new CachedSynonymSource(
      new PostgresSynonymSource(this.deps.prisma),
      this.deps.clock,
    );
    return this.synonymSource;
  }

  private get(): SearchService {
    this.service ??= new SearchService({
      primary: createPrimaryIndex(this.deps.env),
      fallback: new PostgresSearchIndex(this.deps.prisma),
      clock: this.deps.clock,
      synonyms: this.synonyms(),
      ...(this.deps.logger === undefined ? {} : { logger: this.deps.logger }),
      ...(this.deps.options === undefined ? {} : { options: this.deps.options }),
    });
    return this.service;
  }
}

/** What the worker's sync writes to: OpenSearch, or `null` when it is not configured. */
export function createSyncIndex(env: Env = process.env): SearchIndex | null {
  return createPrimaryIndex(env);
}
