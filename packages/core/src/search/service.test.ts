import { describe, expect, it, vi } from 'vitest';
import { searchDocument } from '../../test/support/search-documents.js';
import { FixedClock } from '../platform/clock.js';
import { encodeCursor } from './cursor.js';
import { SearchCursorError, SearchQueryError, SearchUnavailableError } from './errors.js';
import type { SearchIndex, UpsertResult } from './index-port.js';
import { InMemorySearchIndex } from './memory-index.js';
import type { SearchBackend, SearchPage, SearchQuery } from './model.js';
import { SearchService, SearchTimeoutError } from './service.js';
import { StaticSynonymSource, CachedSynonymSource } from './synonyms.js';

const EMPTY_PAGE: SearchPage = { items: [], total: 0, nextCursor: null };

/** An index whose search is whatever the test says, and which records the queries it got. */
class ScriptedIndex implements SearchIndex {
  queries: SearchQuery[] = [];
  behaviour: () => Promise<SearchPage> = () => Promise.resolve(EMPTY_PAGE);
  constructor(readonly backend: SearchBackend) {}
  search(query: SearchQuery): Promise<SearchPage> {
    this.queries.push(query);
    return this.behaviour();
  }
  ensureIndex = (): Promise<void> => Promise.resolve();
  upsertDocuments = (): Promise<UpsertResult> => Promise.resolve({ written: 0, failed: [] });
  deleteDocuments = (): Promise<void> => Promise.resolve();
  replaceSites = (): Promise<UpsertResult> => Promise.resolve({ written: 0, failed: [] });
  listSiteIds = (): Promise<string[]> => Promise.resolve([]);
  isHealthy = (): Promise<boolean> => Promise.resolve(true);
}

function setup(options: { primary?: boolean; openForMs?: number; timeoutMs?: number } = {}) {
  const clock = new FixedClock('2026-11-25T10:00:00Z');
  const primary = options.primary === false ? null : new ScriptedIndex('opensearch');
  const fallback = new ScriptedIndex('postgres');
  const warn = vi.fn();
  const service = new SearchService({
    primary,
    fallback,
    clock,
    synonyms: new StaticSynonymSource(new Map([['ts', ['tensile strength']]])),
    logger: { warn },
    options: {
      failureThreshold: 2,
      openForMs: options.openForMs ?? 30_000,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    },
  });
  return { clock, primary, fallback, service, warn };
}

const fail = (): Promise<SearchPage> => Promise.reject(new Error('cluster down'));

describe('SearchService', () => {
  it('answers from OpenSearch when it is configured and healthy', async () => {
    const { service, primary, fallback } = setup();
    const result = await service.search({ q: 'tensile' });
    expect(result.backend).toBe('opensearch');
    expect(primary?.queries).toHaveLength(1);
    expect(fallback.queries).toHaveLength(0);
  });

  it('answers from Postgres when OpenSearch is not configured', async () => {
    const { service, fallback } = setup({ primary: false });
    expect((await service.search({})).backend).toBe('postgres');
    expect(fallback.queries).toHaveLength(1);
  });

  it('falls back to Postgres on the same request when OpenSearch fails', async () => {
    const { service, primary, fallback } = setup();
    if (!primary) throw new Error('primary expected');
    primary.behaviour = fail;
    const result = await service.search({ q: 'tensile' });
    expect(result.backend).toBe('postgres');
    expect(fallback.queries).toHaveLength(1);
  });

  it('falls back when OpenSearch is too slow', async () => {
    const { service, primary } = setup({ timeoutMs: 20 });
    if (!primary) throw new Error('primary expected');
    primary.behaviour = () => new Promise<SearchPage>(() => undefined);
    const result = await service.search({});
    expect(result.backend).toBe('postgres');
    expect(new SearchTimeoutError('x').name).toBe('SearchTimeoutError');
  });

  it('opens the circuit after repeated failures so a dead cluster is not hit on every request', async () => {
    const { service, primary, fallback, clock, warn } = setup({ openForMs: 30_000 });
    if (!primary) throw new Error('primary expected');
    primary.behaviour = fail;
    await service.search({});
    expect(service.circuit()).toBe('closed'); // one failure is not yet a pattern
    await service.search({});
    expect(service.circuit()).toBe('open');
    expect(primary.queries).toHaveLength(2);

    await service.search({});
    await service.search({});
    expect(primary.queries).toHaveLength(2); // skipped while open
    expect(fallback.queries).toHaveLength(4);
    expect(warn).toHaveBeenCalledTimes(1);

    // after the pause one request tries again; if it fails the circuit stays open for another pause
    clock.advance(30_001);
    expect(service.circuit()).toBe('half-open');
    await service.search({});
    expect(primary.queries).toHaveLength(3);
    expect(service.circuit()).toBe('open');
    await service.search({});
    expect(primary.queries).toHaveLength(3);

    // and when the trial works, the circuit closes
    clock.advance(30_001);
    primary.behaviour = () => Promise.resolve(EMPTY_PAGE);
    expect((await service.search({})).backend).toBe('opensearch');
    expect(service.circuit()).toBe('closed');
    expect((await service.search({})).backend).toBe('opensearch');
  });

  it('lets only one request test a recovering cluster', async () => {
    const { service, primary, clock } = setup();
    if (!primary) throw new Error('primary expected');
    primary.behaviour = fail;
    await service.search({});
    await service.search({});
    clock.advance(30_001);
    let release: (page: SearchPage) => void = () => undefined;
    primary.behaviour = () =>
      new Promise<SearchPage>((resolve) => {
        release = resolve;
      });
    const trial = service.search({});
    const other = await service.search({});
    expect(other.backend).toBe('postgres');
    // let the trial request reach the index before answering it
    await vi.waitFor(() => {
      expect(primary.queries.length).toBeGreaterThan(2);
    });
    release(EMPTY_PAGE);
    expect((await trial).backend).toBe('opensearch');
  });

  it('does not count a bad request as a failure of OpenSearch, and does not fall back for it', async () => {
    const { service, primary, fallback } = setup();
    if (!primary) throw new Error('primary expected');
    await expect(service.search({ lat: 1 })).rejects.toBeInstanceOf(SearchQueryError);
    primary.behaviour = () => Promise.reject(new SearchCursorError());
    await expect(service.search({})).rejects.toBeInstanceOf(SearchCursorError);
    await expect(service.search({})).rejects.toBeInstanceOf(SearchCursorError);
    expect(service.circuit()).toBe('closed');
    expect(fallback.queries).toHaveLength(0);
  });

  it('routes a cursor to the backend that issued it', async () => {
    const { service, primary, fallback } = setup();
    const pg = encodeCursor('postgres', { k: 0, id: 'a' });
    expect((await service.search({ cursor: pg })).backend).toBe('postgres');
    const os = encodeCursor('opensearch', { k: 0, id: 'a', s: [0, 'a', 'b'] });
    expect((await service.search({ cursor: os })).backend).toBe('opensearch');
    expect(primary?.queries).toHaveLength(1);
    expect(fallback.queries).toHaveLength(1);
    await expect(service.search({ cursor: 'nonsense' })).rejects.toBeInstanceOf(SearchCursorError);
    await expect(
      service.search({ cursor: encodeCursor('memory', { k: 0, id: 'a' }) }),
    ).rejects.toBeInstanceOf(SearchCursorError);
  });

  it('refuses an OpenSearch cursor when OpenSearch cannot be asked, instead of repeating a page', async () => {
    const { service, primary } = setup();
    if (!primary) throw new Error('primary expected');
    const os = encodeCursor('opensearch', { k: 0, id: 'a', s: [0, 'a', 'b'] });
    primary.behaviour = fail;
    await expect(service.search({ cursor: os })).rejects.toBeInstanceOf(SearchUnavailableError);
    await expect(service.search({ cursor: os })).rejects.toBeInstanceOf(SearchUnavailableError);
    expect(service.circuit()).toBe('open');
    await expect(service.search({ cursor: os })).rejects.toBeInstanceOf(SearchCursorError);
    const unconfigured = setup({ primary: false }).service;
    await expect(unconfigured.search({ cursor: os })).rejects.toBeInstanceOf(SearchCursorError);
  });

  it('fails with a safe error when Postgres fails too', async () => {
    const { service, primary, fallback } = setup();
    if (!primary) throw new Error('primary expected');
    primary.behaviour = fail;
    fallback.behaviour = () => Promise.reject(new Error('relation "lab_site" does not exist'));
    const error = await service.search({}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SearchUnavailableError);
    expect((error as SearchUnavailableError).detail).toBe('Search is not available right now.');
    expect((error as Error).message).not.toContain('lab_site');
  });

  it('expands synonyms into the terms every backend receives', async () => {
    const { service, primary } = setup();
    await service.search({ q: 'TS' });
    expect(primary?.queries[0]?.terms).toEqual(['ts', 'tensile strength']);
    expect(primary?.queries[0]?.text).toBe('TS');
    await service.search({});
    expect(primary?.queries[1]?.terms).toEqual([]);
  });

  it('judges the query at the time of the clock, not at the time of the index', async () => {
    const { service, primary, clock } = setup();
    clock.set('2027-01-01T00:00:00Z');
    await service.search({});
    expect(primary?.queries[0]?.asOf.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('never logs the query text or a cursor', async () => {
    const { service, primary, warn } = setup();
    if (!primary) throw new Error('primary expected');
    primary.behaviour = fail;
    await service.search({ q: 'confidential-term' });
    await service.search({ q: 'confidential-term' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('confidential-term');
  });
});

describe('CachedSynonymSource', () => {
  it('reads again after the time to live, keeps the old map when a read fails, and can be invalidated', async () => {
    const clock = new FixedClock('2026-11-25T10:00:00Z');
    let calls = 0;
    let broken = false;
    const source = {
      load: (): Promise<ReadonlyMap<string, readonly string[]>> => {
        calls += 1;
        return broken
          ? Promise.reject(new Error('db down'))
          : Promise.resolve(new Map([['a', [`b${String(calls)}`]]]));
      },
    };
    const cached = new CachedSynonymSource(source, clock, 60_000);
    expect((await cached.load()).get('a')).toEqual(['b1']);
    await cached.load();
    expect(calls).toBe(1);
    clock.advance(60_001);
    expect((await cached.load()).get('a')).toEqual(['b2']);
    broken = true;
    clock.advance(60_001);
    expect((await cached.load()).get('a')).toEqual(['b2']); // stale, but search still works
    cached.invalidate();
    broken = false;
    expect((await cached.load()).get('a')).toEqual(['b4']);
  });
});

describe('an index with no documents', () => {
  it('answers an empty page', async () => {
    const index: SearchIndex = new InMemorySearchIndex();
    await index.upsertDocuments([searchDocument()]);
    const service = new SearchService({
      primary: null,
      fallback: index,
      clock: new FixedClock('2026-11-25T10:00:00Z'),
      synonyms: new StaticSynonymSource(),
    });
    const page = await service.search({ q: 'tensile' });
    expect(page.backend).toBe('memory');
    expect(page.total).toBe(1);
  });
});
