import { decodeCursor } from './cursor.js';
import { SearchCursorError } from './errors.js';
import { MAX_MATCHED_LINES, type SearchQuery } from './model.js';
import { istDateString } from './visible-lines.js';
import {
  GRADE_FUZZY,
  GRADE_NAME_PREFIX,
  GRADE_NAME_WORD,
  GRADE_OTHER,
  MIN_FUZZY_LENGTH,
  MIN_PREFIX_LENGTH,
  queryWordLists,
} from './word-match.js';

/** Names of the named queries; `matched_queries` of an inner hit says which one a line matched. */
export const LINE_TEXT_QUERY = 'line_text';
export const SITE_NAME_QUERY = 'site_name';

/** The parameter's own name: the best place for a query word to be found. */
const NAME_FIELDS = ['parameter.name'];
/** Every other text that makes a line findable (aliases, product, group, discipline, method, standard). */
const OTHER_FIELDS = [
  'parameter.aliases',
  'product.name',
  'product.aliases',
  'method.standard_code',
  'method.name',
  'group.name',
  'discipline.name',
  'method_text',
];
const SITE_FIELDS = ['site_name', 'site_code'];

/** `index.max_result_window` of OpenSearch: `from + size` may not exceed it. */
export const MAX_RESULT_WINDOW = 10_000;

type Json = Record<string, unknown>;

/** Weights of the grades of `word-match.ts`; the score of a term is the sum over its words. */
const WEIGHT = {
  nameWord: GRADE_NAME_WORD,
  namePrefix: GRADE_NAME_PREFIX,
  other: GRADE_OTHER,
  fuzzy: GRADE_FUZZY,
} as const;

const weighted = (filter: Json, boost: number): Json => ({ constant_score: { filter, boost } });

/** A whole word: the field's analyser cuts the word the way it cut the text, and every token must match. */
const wholeWord = (word: string, fields: string[]): Json => ({
  multi_match: { query: word, fields, type: 'best_fields', operator: 'and' },
});

/** The beginning of a word (the text is lower-cased by the analyser, so is the word). */
const wordPrefix = (word: string, fields: string[]): Json => ({
  bool: {
    should: fields.map((field) => ({ prefix: { [field]: { value: word } } })),
    minimum_should_match: 1,
  },
});

/** A typing mistake: one edit for words of four to seven letters, two from eight (as the memory index). */
const typo = (word: string, fields: string[]): Json => ({
  multi_match: {
    query: word,
    fields,
    type: 'best_fields',
    operator: 'and',
    fuzziness: `AUTO:${String(MIN_FUZZY_LENGTH)},8`,
    prefix_length: 1,
  },
});

/**
 * One query word against a set of fields (`word-match.ts`): the best of a whole word in the name
 * fields, the beginning of a word in the name fields (words of four letters or more), a whole word
 * or the beginning of one in the other fields, and a typing mistake (four letters or more).
 */
function wordClause(word: string, nameFields: string[], otherFields: string[]): Json {
  const long = word.length >= MIN_PREFIX_LENGTH;
  const queries: Json[] = [weighted(wholeWord(word, nameFields), WEIGHT.nameWord)];
  if (long) queries.push(weighted(wordPrefix(word, nameFields), WEIGHT.namePrefix));
  if (otherFields.length > 0) {
    queries.push(weighted(wholeWord(word, otherFields), WEIGHT.other));
    if (long) queries.push(weighted(wordPrefix(word, otherFields), WEIGHT.other));
  }
  if (word.length >= MIN_FUZZY_LENGTH) {
    queries.push(weighted(typo(word, [...nameFields, ...otherFields]), WEIGHT.fuzzy));
  }
  return { dis_max: { queries } };
}

/**
 * A term matches when every one of its words matches. Terms (the text and its synonym
 * expansions) are alternatives: the best one counts. A term with no word (only punctuation)
 * is left out, and a query with none matches nothing.
 */
const named = (
  name: string,
  terms: string[],
  nameFields: string[],
  otherFields: string[],
): Json => {
  const alternatives = queryWordLists(terms).map((words) => ({
    bool: { must: words.map((word) => wordClause(word, nameFields, otherFields)) },
  }));
  return { dis_max: { _name: name, queries: alternatives.length > 0 ? alternatives : [NO_MATCH] } };
};

const NO_MATCH: Json = { match_none: {} };


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
  // Sites that tie on price, turnaround or distance come best text match first, then by id.
  const tie: Json[] = query.terms.length > 0 ? [{ _score: 'desc' }] : [];
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
        ...tie,
        ...tail,
      ];
    }
    case 'price':
      return [{ price_paise: { order: 'asc', missing: '_last' } }, ...tie, ...tail];
    case 'tat':
      return [{ tat_days: { order: 'asc', missing: '_last' } }, ...tie, ...tail];
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
 * - Text (`word-match.ts` has the rules): a line matches when every word of a term (the text or
 *   one of its synonym expansions) is a whole word, the beginning of a word (words of four letters
 *   or more) or a typing mistake (four letters or more) in the parameter name or in the other text
 *   of the line (named `line_text`); a site by its name or code (`site_name`). Each word scores the
 *   weight of its best kind of match (`WEIGHT`), so the score ranks like the grades of the
 *   other backends; it is an approximation of the Postgres score, not the same number.
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
                named(LINE_TEXT_QUERY, query.terms, NAME_FIELDS, OTHER_FIELDS),
                named(SITE_NAME_QUERY, query.terms, SITE_FIELDS, []),
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
