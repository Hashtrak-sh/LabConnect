import type { PrismaClient } from '@labconnect/database';
import type { Clock } from '../platform/clock.js';
import { withPublicReadContext } from '../platform/public-context.js';
import type { SynonymMap } from './query.js';

export interface SynonymSource {
  load(): Promise<SynonymMap>;
}

/**
 * Active admin-managed synonyms (`search_synonym`, `masterdata` module), read as an anonymous
 * visitor like the rest of search (see `visible-lines.ts` for why search reads the table itself,
 * OQ-152). Terms are lower-cased; expansions keep their text.
 */
export class PostgresSynonymSource implements SynonymSource {
  constructor(private readonly prisma: Pick<PrismaClient, '$transaction'>) {}

  async load(): Promise<SynonymMap> {
    const rows = await withPublicReadContext(
      this.prisma,
      (tx) =>
        tx.$queryRaw<{ term: string; expands_to: string[] }[]>`
          SELECT term::text AS term, expands_to FROM search_synonym WHERE status = 'ACTIVE'`,
    );
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const term = row.term.trim().toLowerCase();
      if (term.length > 0) map.set(term, row.expands_to);
    }
    return map;
  }
}

/** A fixed map, for tests and for a deployment without synonyms. */
export class StaticSynonymSource implements SynonymSource {
  constructor(private readonly map: SynonymMap = new Map()) {}
  load(): Promise<SynonymMap> {
    return Promise.resolve(this.map);
  }
}

/**
 * Keeps the synonyms for `ttlMs` (the freshness target for a synonym change is the same minute
 * as everything else: SEARCH.md section 2). A failed load keeps the last map, or none: search
 * does not fail because the synonym table could not be read.
 */
export class CachedSynonymSource implements SynonymSource {
  private map: SynonymMap = new Map();
  private loadedAt: number | null = null;

  constructor(
    private readonly source: SynonymSource,
    private readonly clock: Clock,
    private readonly ttlMs = 60_000,
  ) {}

  async load(): Promise<SynonymMap> {
    const now = this.clock.now().getTime();
    if (this.loadedAt !== null && now - this.loadedAt < this.ttlMs) return this.map;
    try {
      this.map = await this.source.load();
      this.loadedAt = now;
    } catch {
      // Keep what we have; try again after a short pause rather than on every request.
      this.loadedAt = now - this.ttlMs + Math.min(5_000, this.ttlMs);
    }
    return this.map;
  }

  /** Forget the cached map, so the next search reads the table (a `masterdata.published` event). */
  invalidate(): void {
    this.loadedAt = null;
  }
}
