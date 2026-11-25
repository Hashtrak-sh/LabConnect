import type { Clock } from '../platform/clock.js';
import { cursorBackend } from './cursor.js';
import { SearchCursorError, SearchQueryError, SearchUnavailableError } from './errors.js';
import type { SearchIndex } from './index-port.js';
import type { SearchBackend, SearchPage, SearchRequest } from './model.js';
import { expandTerms, normaliseSearchQuery } from './query.js';
import type { SynonymSource } from './synonyms.js';

export interface SearchServiceOptions {
  /** A search to OpenSearch that takes longer is a failure. Default 1500 ms. */
  timeoutMs?: number;
  /** Consecutive failures that open the circuit. Default 2. */
  failureThreshold?: number;
  /** How long an open circuit skips OpenSearch before one trial request. Default 30 000 ms. */
  openForMs?: number;
}

export interface SearchServiceDeps {
  /** OpenSearch, when configured. `null`: Postgres answers everything. */
  primary: SearchIndex | null;
  /** The fallback and the MVP default (SEARCH.md section 3). */
  fallback: SearchIndex;
  clock: Clock;
  synonyms: SynonymSource;
  /** Receives backend names and error classes only: never the query text or a cursor. */
  logger?: { warn(message: string): void };
  options?: SearchServiceOptions;
}

export interface SearchResult extends SearchPage {
  /** Which backend answered (logs and metrics; not part of the API response). */
  backend: SearchBackend;
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export class SearchTimeoutError extends Error {
  override name = 'SearchTimeoutError';
}

const isRequestError = (error: unknown): boolean =>
  error instanceof SearchQueryError || error instanceof SearchCursorError;

/**
 * Public search (SEARCH.md section 3, FR-DIS-01..05). Validates and normalises the request,
 * expands synonyms (the same way for every backend), and answers from OpenSearch when it is
 * configured and healthy, otherwise from Postgres.
 *
 * Fallback: an error or a timeout from OpenSearch is answered by Postgres on the same request.
 * A small circuit breaker keeps a dead cluster from being hit on every request: after
 * `failureThreshold` failures in a row the circuit opens and OpenSearch is skipped for
 * `openForMs`; then one request tries it again (half-open), and a success closes the circuit.
 * The memory is in this process only and costs nothing but a counter and a timestamp.
 *
 * Cursors belong to the backend that issued them. A client holding an OpenSearch cursor when the
 * circuit opens gets `VALIDATION_FAILED` ("start again"), never a repeated or skipped page.
 * Nothing here logs the query text.
 */
export class SearchService {
  private failures = 0;
  private openUntil: number | null = null;
  private trialInFlight = false;

  constructor(private readonly deps: SearchServiceDeps) {}

  /** The state of the circuit, for health endpoints and tests. */
  circuit(): CircuitState {
    if (this.openUntil === null) return 'closed';
    return this.deps.clock.now().getTime() < this.openUntil || this.trialInFlight
      ? 'open'
      : 'half-open';
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    const { clock, primary, fallback } = this.deps;
    const query = normaliseSearchQuery(request, clock.now());
    if (query.text !== null) {
      query.terms = expandTerms(query.text, await this.deps.synonyms.load());
    }

    if (query.cursor !== null) {
      const issuer = cursorBackend(query.cursor);
      if (issuer === 'postgres') return this.from(fallback, query);
      if (issuer === 'opensearch' && primary !== null && this.mayTryPrimary()) {
        try {
          return await this.timed(primary, query);
        } catch (error) {
          if (isRequestError(error)) {
            this.trialInFlight = false;
            throw error;
          }
          this.recordFailure(error);
          throw new SearchUnavailableError(error);
        }
      }
      throw new SearchCursorError();
    }

    if (primary !== null && this.mayTryPrimary()) {
      try {
        return await this.timed(primary, query);
      } catch (error) {
        if (isRequestError(error)) {
          this.trialInFlight = false;
          throw error;
        }
        this.recordFailure(error);
      }
    }
    return this.from(fallback, query);
  }

  private async from(
    index: SearchIndex,
    query: Parameters<SearchIndex['search']>[0],
  ): Promise<SearchResult> {
    try {
      return { ...(await index.search(query)), backend: index.backend };
    } catch (error) {
      if (isRequestError(error)) throw error;
      throw new SearchUnavailableError(error);
    }
  }

  private async timed(
    index: SearchIndex,
    query: Parameters<SearchIndex['search']>[0],
  ): Promise<SearchResult> {
    const timeoutMs = this.deps.options?.timeoutMs ?? 1500;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new SearchTimeoutError('The search index did not answer in time.'));
      }, timeoutMs);
    });
    try {
      const page = await Promise.race([index.search(query), timeout]);
      this.recordSuccess();
      return { ...page, backend: index.backend };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Closed: yes. Open: no. Half-open: exactly one request at a time. */
  private mayTryPrimary(): boolean {
    if (this.openUntil === null) return true;
    if (this.deps.clock.now().getTime() < this.openUntil) return false;
    if (this.trialInFlight) return false;
    this.trialInFlight = true;
    return true;
  }

  private recordSuccess(): void {
    this.failures = 0;
    this.openUntil = null;
    this.trialInFlight = false;
  }

  private recordFailure(error: unknown): void {
    const threshold = this.deps.options?.failureThreshold ?? 2;
    const openForMs = this.deps.options?.openForMs ?? 30_000;
    this.failures += 1;
    const wasTrial = this.trialInFlight;
    this.trialInFlight = false;
    if (wasTrial || this.failures >= threshold) {
      this.openUntil = this.deps.clock.now().getTime() + openForMs;
      this.deps.logger?.warn(
        `search: OpenSearch failed (${error instanceof Error ? error.name : 'error'}); using Postgres for ${String(openForMs)} ms`,
      );
    }
  }
}
