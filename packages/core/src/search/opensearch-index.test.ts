import { describe, expect, it, vi } from 'vitest';
import { searchDocument } from '../../test/support/search-documents.js';
import { encodeCursor } from './cursor.js';
import { SearchCursorError } from './errors.js';
import type { SearchRequest } from './model.js';
import { buildSearchBody } from './opensearch-dsl.js';
import { type OpenSearchClientLike, OpenSearchSearchIndex } from './opensearch-index.js';
import { INDEX_MAPPINGS, INDEX_SETTINGS, fromSource, toSource } from './opensearch-mapping.js';
import { normaliseSearchQuery } from './query.js';

const AT = new Date('2026-11-25T10:00:00Z');
const query = (request: SearchRequest = {}) => normaliseSearchQuery(request, AT);

function stubClient(responses: { search?: unknown; bulk?: unknown; existsAlias?: boolean } = {}) {
  const calls: { method: string; params: unknown }[] = [];
  const respond =
    (method: string, body: unknown) =>
    (params?: unknown): Promise<{ body: unknown }> => {
      calls.push({ method, params });
      return Promise.resolve({ body });
    };
  const spies = {
    search: vi.fn(respond('search', responses.search ?? { hits: { hits: [] } })),
    bulk: vi.fn(respond('bulk', responses.bulk ?? { errors: false, items: [] })),
    deleteByQuery: vi.fn(respond('deleteByQuery', {})),
    existsAlias: vi.fn(respond('existsAlias', responses.existsAlias ?? false)),
    create: vi.fn(respond('create', {})),
    health: vi.fn(respond('health', { status: 'green' })),
  };
  const client: OpenSearchClientLike = {
    search: (params) => spies.search(params),
    bulk: (params) => spies.bulk(params),
    deleteByQuery: (params) => spies.deleteByQuery(params),
    indices: {
      existsAlias: (params) => spies.existsAlias(params),
      create: (params) => spies.create(params),
    },
    cluster: { health: (params) => spies.health(params) },
  };
  const index = new OpenSearchSearchIndex(() => Promise.resolve(client), {
    alias: 'lab_scope',
    version: 1,
  });
  return { spies, index, calls };
}

/** Reads a nested value of a JSON-like structure by a dotted path (array positions are numbers). */
function dig(value: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (current, key) => (current as Record<string, unknown> | undefined)?.[key],
      value,
    );
}

describe('buildSearchBody', () => {
  it('filters on accreditation dates, asks for one more site than the page, and collapses on the site', () => {
    const body = buildSearchBody(query({ limit: 10 }));
    expect(dig(body, 'size')).toBe(11);
    expect(dig(body, 'collapse.field')).toBe('lab_site_id');
    expect(dig(body, 'query.bool.filter')).toEqual([
      { range: { 'accreditation.valid_from': { lte: '2026-11-25' } } },
      { range: { 'accreditation.valid_to': { gte: '2026-11-25' } } },
    ]);
    expect(dig(body, 'query.bool.must')).toBeUndefined();
    const hits = dig(body, 'collapse.inner_hits') as { name: string; size: number }[];
    expect(hits.map((hit) => hit.name)).toEqual(['lines', 'cheapest', 'fastest', 'accreditations']);
    expect(hits[0]?.size).toBe(10);
    expect(dig(body, 'sort')).toEqual([
      { _score: 'desc' },
      { lab_site_id: 'asc' },
      { scope_line_id: 'asc' },
    ]);
    expect(dig(body, 'aggs.sites.cardinality.field')).toBe('lab_site_id');
  });

  it('searches the text and its synonym expansions with fuzziness, as named line and site clauses', () => {
    const q = query({ q: 'TS' });
    q.terms = ['ts', 'tensile strength'];
    const body = buildSearchBody(q);
    const clauses = dig(body, 'query.bool.must.0.bool.should') as unknown[];
    expect(clauses.map((clause) => dig(clause, 'bool._name'))).toEqual(['line_text', 'site_name']);
    expect(dig(body, 'query.bool.must.0.bool.minimum_should_match')).toBe(1);
    const lineClause = dig(clauses[0], 'bool.should') as unknown[];
    expect(lineClause).toHaveLength(2);
    expect(dig(lineClause[1], 'multi_match')).toMatchObject({
      query: 'tensile strength',
      fuzziness: 'AUTO',
      operator: 'and',
    });
    expect(dig(lineClause[0], 'multi_match.fields')).toEqual(
      expect.arrayContaining(['parameter.name^3', 'product.aliases^2', 'method.standard_code^2']),
    );
    expect(dig(clauses[1], 'bool.should.0.multi_match.fields')).toEqual([
      'site_name^2',
      'site_code',
    ]);
  });

  it('turns each filter into a filter clause', () => {
    const body = buildSearchBody(
      query({
        discipline: 'MECH',
        parameter: 'TENSILE',
        method: 'IS_1608',
        tatMax: 7,
        priceMax: 250_000,
        category: 'TESTING',
        lat: 28.6,
        lng: 77.2,
        radiusKm: 25,
      }),
    );
    expect((dig(body, 'query.bool.filter') as unknown[]).slice(2)).toEqual([
      { term: { 'discipline.code': 'MECH' } },
      { term: { 'parameter.code': 'TENSILE' } },
      { term: { 'method.code': 'IS_1608' } },
      { range: { tat_days: { lte: 7 } } },
      { range: { price_paise: { lte: 250_000 } } },
      { term: { lab_category: 'TESTING' } },
      { geo_distance: { distance: '25km', location: { lat: 28.6, lon: 77.2 } } },
    ]);
  });

  it('sorts by distance, price or turnaround, with the site and line id as tie-breakers', () => {
    const distance = buildSearchBody(query({ lat: 28.6, lng: 77.2 }));
    expect(dig(distance, 'sort.0._geo_distance')).toMatchObject({
      location: { lat: 28.6, lon: 77.2 },
      order: 'asc',
      unit: 'm',
    });
    expect((dig(distance, 'sort') as unknown[]).slice(1)).toEqual([
      { lab_site_id: 'asc' },
      { scope_line_id: 'asc' },
    ]);
    expect(dig(buildSearchBody(query({ sort: 'price' })), 'sort.0')).toEqual({
      price_paise: { order: 'asc', missing: '_last' },
    });
    expect(dig(buildSearchBody(query({ sort: 'tat' })), 'sort.0')).toEqual({
      tat_days: { order: 'asc', missing: '_last' },
    });
  });

  it('continues from the sort values of the cursor, and a huge missing-value sort stays a valid long', () => {
    const cursor = encodeCursor('opensearch', {
      k: 2,
      id: 's',
      s: [2.5, 's', 'l', 9.223372036854776e18],
    });
    expect(dig(buildSearchBody(query({ cursor })), 'search_after')).toEqual([
      2.5,
      's',
      'l',
      '9223372036854775807',
    ]);
    expect(() =>
      buildSearchBody(query({ cursor: encodeCursor('opensearch', { k: 1, id: 'x' }) })),
    ).toThrow(SearchCursorError);
    expect(() =>
      buildSearchBody(query({ cursor: encodeCursor('postgres', { k: 1, id: 'x' }) })),
    ).toThrow(SearchCursorError);
  });

  it('carries nothing about a user', () => {
    const body = JSON.stringify(buildSearchBody(query({ q: 'tensile' })));
    expect(body).not.toMatch(/user|email|phone/i);
  });
});

describe('index definition', () => {
  it('has analysers for lower-casing and folding, an edge n-gram analyser, and strict mappings', () => {
    expect(INDEX_SETTINGS.analysis.analyzer.lc_text.filter).toEqual(['lowercase', 'asciifolding']);
    expect(INDEX_SETTINGS.analysis.filter.lc_edge_ngram.type).toBe('edge_ngram');
    expect(INDEX_MAPPINGS.dynamic).toBe('strict');
    expect(INDEX_MAPPINGS.properties.location.type).toBe('geo_point');
    expect(INDEX_MAPPINGS.properties.price_paise.type).toBe('long');
    expect(INDEX_MAPPINGS.properties.lab_site_id.type).toBe('keyword');
    expect(INDEX_MAPPINGS.properties.parameter.properties.name.fields.edge.analyzer).toBe(
      'lc_edge',
    );
  });

  it('round-trips a document through its indexed form, money as a number', () => {
    const doc = searchDocument({ pricePaise: 123_456n, location: { lat: 1.5, lng: 2.5 } });
    const source = toSource(doc);
    expect(source.price_paise).toBe(123_456);
    expect(source.location).toEqual({ lat: 1.5, lon: 2.5 });
    expect(fromSource(source)).toEqual(doc);
    expect(() => toSource(searchDocument({ pricePaise: 2n ** 60n }))).toThrow(RangeError);
  });
});

describe('OpenSearchSearchIndex', () => {
  it('creates the versioned index with its alias once, and not when the alias exists', async () => {
    const created = stubClient({ existsAlias: false });
    await created.index.ensureIndex();
    const call = created.calls.find((entry) => entry.method === 'create')?.params;
    expect(dig(call, 'index')).toBe('lab_scope_v1');
    expect(dig(call, 'body.aliases')).toEqual({ lab_scope: { is_write_index: true } });
    expect(dig(call, 'body.mappings.dynamic')).toBe('strict');

    const existing = stubClient({ existsAlias: true });
    await existing.index.ensureIndex();
    expect(existing.spies.create).not.toHaveBeenCalled();
  });

  it('accepts losing the race to create the index', async () => {
    const { spies, index } = stubClient();
    spies.create.mockRejectedValueOnce({
      body: { error: { type: 'resource_already_exists_exception' } },
    });
    await expect(index.ensureIndex()).resolves.toBeUndefined();
    spies.create.mockRejectedValueOnce(new Error('connection refused'));
    await expect(index.ensureIndex()).rejects.toThrow('connection refused');
  });

  it('upserts in one bulk request with the projection time as external version', async () => {
    const { index, calls } = stubClient();
    const doc = searchDocument({ projectedAt: '2026-11-25T10:00:00.000Z' });
    const result = await index.upsertDocuments([doc]);
    expect(result).toEqual({ written: 1, failed: [] });
    const bulk = calls.find((entry) => entry.method === 'bulk')?.params;
    expect(dig(bulk, 'index')).toBe('lab_scope');
    expect(dig(bulk, 'body.0')).toEqual({
      index: {
        _id: doc.scopeLineId,
        version: Date.parse('2026-11-25T10:00:00.000Z'),
        version_type: 'external_gte',
      },
    });
    expect(dig(bulk, 'body.1.scope_line_id')).toBe(doc.scopeLineId);
  });

  it('reports the documents of a partial bulk failure, and treats a version conflict as nothing to retry', async () => {
    const [a, b, c] = [searchDocument(), searchDocument(), searchDocument()];
    const { index } = stubClient({
      bulk: {
        errors: true,
        items: [
          { index: { _id: a.scopeLineId, status: 200 } },
          {
            index: {
              _id: b.scopeLineId,
              status: 409,
              error: { type: 'version_conflict_engine_exception' },
            },
          },
          {
            index: {
              _id: c.scopeLineId,
              status: 429,
              error: { type: 'es_rejected_execution_exception' },
            },
          },
        ],
      },
    });
    const result = await index.upsertDocuments([a, b, c]);
    expect(result.failed).toEqual([c.scopeLineId]);
    expect(result.written).toBe(2);
  });

  it('replaces a site: upserts its documents and deletes every other document of the site', async () => {
    const { index, calls } = stubClient();
    const doc = searchDocument();
    await index.replaceSites([
      { labSiteId: doc.labSiteId, documents: [doc] },
      { labSiteId: 'gone', documents: [] },
    ]);
    const deletes = calls.filter((entry) => entry.method === 'deleteByQuery').map((c) => c.params);
    expect(deletes).toHaveLength(2);
    expect(dig(deletes[0], 'body.query.bool')).toEqual({
      filter: [{ term: { lab_site_id: doc.labSiteId } }],
      must_not: [{ ids: { values: [doc.scopeLineId] } }],
    });
    expect(dig(deletes[1], 'body.query.bool')).toEqual({
      filter: [{ term: { lab_site_id: 'gone' } }],
    });
    expect(dig(deletes[0], 'conflicts')).toBe('proceed');
  });

  it('deletes by id and treats a missing document as deleted', async () => {
    const ok = stubClient({
      bulk: {
        errors: true,
        items: [{ delete: { _id: 'x', status: 404, error: { type: 'not_found' } } }],
      },
    });
    await expect(ok.index.deleteDocuments(['x'])).resolves.toBeUndefined();
    const failing = stubClient({
      bulk: {
        errors: true,
        items: [{ delete: { _id: 'x', status: 500, error: { type: 'boom' } } }],
      },
    });
    await expect(failing.index.deleteDocuments(['x'])).rejects.toThrow();
    await ok.index.deleteDocuments([]);
    expect(ok.spies.bulk).toHaveBeenCalledTimes(1);
  });

  it('lists the indexed site ids page by page', async () => {
    const { index, calls } = stubClient({
      search: {
        aggregations: { sites: { buckets: [{ key: { id: 'a' } }, { key: { id: 'b' } }] } },
      },
    });
    expect(await index.listSiteIds('0', 2)).toEqual(['a', 'b']);
    expect(dig(calls[0]?.params, 'body.aggs.sites.composite')).toMatchObject({
      size: 2,
      after: { id: '0' },
    });
  });

  it('reports health without throwing', async () => {
    expect(await stubClient().index.isHealthy()).toBe(true);
    const down = stubClient();
    down.spies.health.mockRejectedValueOnce(new Error('down'));
    expect(await down.index.isHealthy()).toBe(false);
    const red = stubClient();
    red.spies.health.mockResolvedValueOnce({ body: { status: 'red' } });
    expect(await red.index.isHealthy()).toBe(false);
  });

  describe('search results', () => {
    const line = (doc = searchDocument(), matched: string[] = ['line_text']) => ({
      _source: toSource(doc),
      matched_queries: matched,
    });

    it('builds a site result from the collapsed hit and its inner hits', async () => {
      const tensile = searchDocument({ scopeLineId: 'l-1', pricePaise: 125_000n, tatDays: 6 });
      const yieldLine = searchDocument({
        scopeLineId: 'l-2',
        pricePaise: 100_000n,
        tatDays: 4,
        parameter: { code: 'YIELD', name: 'Yield strength', aliases: [] },
      });
      const nameOnly = searchDocument({ scopeLineId: 'l-3' });
      const { index } = stubClient({
        search: {
          hits: {
            hits: [
              {
                _source: toSource(tensile),
                sort: [4.2, tensile.labSiteId, 'l-1'],
                inner_hits: {
                  lines: {
                    hits: {
                      total: { value: 3 },
                      hits: [line(tensile), line(yieldLine), line(nameOnly, ['site_name'])],
                    },
                  },
                  cheapest: {
                    hits: { hits: [{ _source: { price_paise: 100_000, tat_days: 4 } }] },
                  },
                  fastest: { hits: { hits: [{ _source: { tat_days: 4 } }] } },
                  accreditations: { hits: { hits: [line(tensile)] } },
                },
              },
            ],
          },
          aggregations: { sites: { value: 1 } },
        },
      });
      const page = await index.search({
        ...query({ q: 'strength', lat: 28.6, lng: 77.2 }),
        terms: ['strength'],
      });
      expect(page.total).toBe(1);
      expect(page.nextCursor).toBeNull();
      const [item] = page.items;
      expect(item?.matchedLines.map((l) => l.scopeLineId)).toEqual(['l-1', 'l-2']);
      expect(item?.matchedLineCount).toBe(2);
      // the price is taken from the matched lines only
      expect(item?.priceFromPaise).toBe(100_000n);
      expect(item?.minTatDays).toBe(4);
      expect(item?.site.accreditations).toHaveLength(1);
      expect(item?.distanceKm).toBeGreaterThan(0);
      expect(item?.nextSlotAt).toBe(tensile.nextSlotAt);
    });

    it('says no line matched for a site found by its name only', async () => {
      const doc = searchDocument();
      const { index } = stubClient({
        search: {
          hits: {
            hits: [
              {
                _source: toSource(doc),
                sort: [1, doc.labSiteId, doc.scopeLineId],
                inner_hits: {
                  lines: { hits: { total: { value: 1 }, hits: [line(doc, ['site_name'])] } },
                  cheapest: {
                    hits: { hits: [{ _source: { price_paise: 100_000, tat_days: 5 } }] },
                  },
                  fastest: { hits: { hits: [{ _source: { tat_days: 5 } }] } },
                },
              },
            ],
          },
          aggregations: { sites: { value: 1 } },
        },
      });
      const page = await index.search({ ...query({ q: 'alpha' }), terms: ['alpha'] });
      expect(page.items[0]?.matchedLines).toEqual([]);
      expect(page.items[0]?.matchedLineCount).toBe(0);
      expect(page.items[0]?.priceFromPaise).toBe(100_000n);
    });

    it('gives every line of a filter-only search as matched, and none without criteria', async () => {
      const doc = searchDocument();
      const response = {
        hits: {
          hits: [
            {
              _source: toSource(doc),
              sort: [0, doc.labSiteId, doc.scopeLineId],
              inner_hits: {
                lines: { hits: { total: { value: 1 }, hits: [{ _source: toSource(doc) }] } },
              },
            },
          ],
        },
      };
      const filtered = await stubClient({ search: response }).index.search(
        query({ parameter: 'TENSILE' }),
      );
      expect(filtered.items[0]?.matchedLineCount).toBe(1);
      expect(filtered.items[0]?.matchedLines).toHaveLength(1);
      const plain = await stubClient({ search: response }).index.search(query());
      expect(plain.items[0]?.matchedLines).toEqual([]);
      expect(plain.items[0]?.matchedLineCount).toBe(0);
    });

    it('issues a cursor from the last site of the page when another site follows', async () => {
      const [first, second] = [
        searchDocument({ labSiteId: 'site-a' }),
        searchDocument({ labSiteId: 'site-b' }),
      ];
      const hit = (doc: typeof first, sort: (string | number)[]) => ({
        _source: toSource(doc),
        sort,
        inner_hits: { lines: { hits: { total: { value: 0 }, hits: [] } } },
      });
      const { index } = stubClient({
        search: {
          hits: { hits: [hit(first, [3, 'site-a', 'l-1']), hit(second, [2, 'site-b', 'l-2'])] },
        },
      });
      const page = await index.search(query({ limit: 1 }));
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toMatch(/^os1\./);
      const decoded = JSON.parse(
        Buffer.from((page.nextCursor ?? '').slice(4), 'base64url').toString('utf8'),
      ) as { s: unknown[] };
      expect(decoded.s).toEqual([3, 'site-a', 'l-1']);
    });

    it('lets a transport error reach the caller (the service answers from Postgres)', async () => {
      const { spies, index } = stubClient();
      spies.search.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(index.search(query())).rejects.toThrow('ECONNREFUSED');
    });
  });
});
