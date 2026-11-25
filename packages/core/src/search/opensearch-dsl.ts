import { decodeCursor } from './cursor.js';
import { SearchCursorError } from './errors.js';
import { MAX_MATCHED_LINES, type SearchQuery } from './model.js';
import { istDateString } from './visible-lines.js';

/** Names of the named queries; `matched_queries` of an inner hit says which one a line matched. */
export const LINE_TEXT_QUERY = 'line_text';
export const SITE_NAME_QUERY = 'site_name';

const LINE_TEXT_FIELDS = [
  'parameter.name^3',
  'parameter.aliases^3',
  'product.name^2',
  'product.aliases^2',
  'method.standard_code^2',
  'method.name',
  'group.name',
  'discipline.name',
  'method_text',
];
const SITE_FIELDS = ['site_name^2', 'site_code'];

/** `index.max_result_window` of OpenSearch: `from + size` may not exceed it. */
export const MAX_RESULT_WINDOW = 10_000;

type Json = Record<string, unknown>;

const multiMatch = (term: string, fields: string[]): Json => ({
  multi_match: {
    query: term,
    fields,
    type: 'best_fields',
    operator: 'and',
    fuzziness: 'AUTO',
    prefix_length: 1,
  },
});

const named = (name: string, terms: string[], fields: string[]): Json => ({
  bool: {
    _name: name,
    should: terms.map((term) => multiMatch(term, fields)),
    minimum_should_match: 1,
  },
});

/** Hard filters on a line (discipline, parameter, method, turnaround, price, category). */
export function hasLineFilters(query: SearchQuery): boolean {
  return (
    query.disciplineCode !== null ||
    query.parameterCode !== null ||
    query.methodCode !== null ||
    query.tatMax !== null ||
    query.priceMaxPaise !== null ||
    query.category !== null
  );
}

function sortClause(query: SearchQuery): Json[] {
  const tail: Json[] = [{ lab_site_id: 'asc' }, { scope_line_id: 'asc' }];
  switch (query.sort) {
    case 'relevance':
      return [{ _score: 'desc' }, ...tail];
    case 'distance': {
      if (query.location === null) return [{ _score: 'desc' }, ...tail];
      return [
        {
          _geo_distance: {
            location: { lat: query.location.lat, lon: query.location.lng },
            order: 'asc',
            unit: 'm',
            distance_type: 'arc',
            mode: 'min',
          },
        },
        ...tail,
      ];
    }
    case 'price':
      return [{ price_paise: { order: 'asc', missing: '_last' } }, ...tail];
    case 'tat':
      return [{ tat_days: { order: 'asc', missing: '_last' } }, ...tail];
  }
}

/**
 * The query DSL of a search (SEARCH.md section 1): documents are scope lines, the request
 * collapses on `lab_site_id`, so each hit is a site, and `inner_hits` bring back the lines that
 * matched ("why this lab matched", FR-DIS-05), the cheapest and the fastest line, and one line
 * per accreditation.
 *
 * - Visibility at query time: the accreditation dates (BR-002); everything else was decided by
 *   the projector, and the index only holds visible lines.
 * - Hard filters are `filter` clauses on the line; distance is a `geo_distance` filter.
 * - Text: a line matches by its parameter, product, group, discipline, method or standard text
 *   (named `line_text`), a site by its name or code (`site_name`), each with `fuzziness: AUTO`
 *   over every term (the text and its synonym expansions).
 * - One extra group is requested (`size = limit + 1`) to know whether another page follows.
 * - Paging is by offset (`from`): OpenSearch refuses `search_after` together with `collapse` unless
 *   the sort is the collapse field itself, which would lose the ranking. The offset is bounded by
 *   `MAX_RESULT_WINDOW` (10 000 sites), far above the year-1 scale (OQ-157).
 */
export function buildSearchBody(query: SearchQuery): Json {
  const today = istDateString(query.asOf);
  const filter: Json[] = [
    { range: { 'accreditation.valid_from': { lte: today } } },
    { range: { 'accreditation.valid_to': { gte: today } } },
  ];
  if (query.disciplineCode !== null)
    filter.push({ term: { 'discipline.code': query.disciplineCode } });
  if (query.parameterCode !== null)
    filter.push({ term: { 'parameter.code': query.parameterCode } });
  if (query.methodCode !== null) filter.push({ term: { 'method.code': query.methodCode } });
  if (query.tatMax !== null) filter.push({ range: { tat_days: { lte: query.tatMax } } });
  if (query.priceMaxPaise !== null) {
    filter.push({ range: { price_paise: { lte: Number(query.priceMaxPaise) } } });
  }
  if (query.category !== null) filter.push({ term: { lab_category: query.category } });
  if (query.radiusKm !== null && query.location !== null) {
    filter.push({
      geo_distance: {
        distance: `${String(query.radiusKm)}km`,
        location: { lat: query.location.lat, lon: query.location.lng },
      },
    });
  }

  const must: Json[] =
    query.terms.length === 0
      ? []
      : [
          {
            bool: {
              should: [
                named(LINE_TEXT_QUERY, query.terms, LINE_TEXT_FIELDS),
                named(SITE_NAME_QUERY, query.terms, SITE_FIELDS),
              ],
              minimum_should_match: 1,
            },
          },
        ];

  const sort = sortClause(query);
  const body: Json = {
    size: query.limit + 1,
    track_total_hits: false,
    query: { bool: { filter, ...(must.length > 0 ? { must } : {}) } },
    collapse: {
      field: 'lab_site_id',
      inner_hits: [
        {
          name: 'lines',
          size: MAX_MATCHED_LINES,
          sort: [{ _score: 'desc' }, { scope_line_id: 'asc' }],
        },
        {
          name: 'cheapest',
          size: 1,
          sort: [{ price_paise: { order: 'asc', missing: '_last' } }],
          _source: ['price_paise', 'tat_days'],
        },
        {
          name: 'fastest',
          size: 1,
          sort: [{ tat_days: { order: 'asc', missing: '_last' } }],
          _source: ['tat_days'],
        },
        {
          name: 'accreditations',
          size: 5,
          collapse: { field: 'accreditation.certificate_no' },
        },
      ],
    },
    sort,
    aggs: { sites: { cardinality: { field: 'lab_site_id', precision_threshold: 3000 } } },
  };
  if (query.cursor !== null) {
    const offset = decodeCursor('opensearch', query.cursor).k;
    if (!Number.isInteger(offset) || offset < 0 || offset + query.limit + 1 > MAX_RESULT_WINDOW) {
      throw new SearchCursorError();
    }
    body.from = offset;
  }
  return body;
}
