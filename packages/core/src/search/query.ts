import { SearchQueryError } from './errors.js';
import {
  SEARCH_DEFAULT_PAGE_SIZE,
  SEARCH_MAX_PAGE_SIZE,
  MAX_TERMS,
  MAX_TEXT_LENGTH,
  type PublicLabCategory,
  SEARCH_RADII_KM,
  type SearchQuery,
  type SearchRadiusKm,
  type SearchRequest,
  type SearchSort,
} from './model.js';

const SORTS: readonly SearchSort[] = ['relevance', 'distance', 'price', 'tat'];
const CATEGORIES: readonly PublicLabCategory[] = ['TESTING', 'CALIBRATION'];
const MAX_CODE_LENGTH = 100;

function code(name: string, value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CODE_LENGTH) {
    throw new SearchQueryError(`${name} must be 1 to ${String(MAX_CODE_LENGTH)} characters.`);
  }
  return trimmed;
}

/** Trims, normalises (NFKC) and collapses white space. Control characters are refused. */
export function cleanText(raw: string): string {
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(raw.replaceAll(/[\t\n\r]/g, ' '))) {
    throw new SearchQueryError('q must not contain control characters.');
  }
  return raw.normalize('NFKC').replaceAll(/\s+/g, ' ').trim();
}

/**
 * Validates a search request the way the contract does (`searchLabs`, 422 `VALIDATION_FAILED`)
 * and turns it into a `SearchQuery`. Pure: `asOf` comes from the caller's clock. The location
 * is `lat` and `lng`; resolving a pincode to its centroid is the caller's job (the geocoder,
 * OQ-153), so a request has no pincode here.
 */
export function normaliseSearchQuery(request: SearchRequest, asOf: Date): SearchQuery {
  let text: string | null = null;
  if (request.q !== undefined) {
    text = cleanText(request.q);
    if (text.length === 0) throw new SearchQueryError('q must not be empty.');
    if (text.length > MAX_TEXT_LENGTH) {
      throw new SearchQueryError(`q must be at most ${String(MAX_TEXT_LENGTH)} characters.`);
    }
  }

  const { lat, lng } = request;
  if ((lat === undefined) !== (lng === undefined)) {
    throw new SearchQueryError('lat and lng must be given together.');
  }
  let location: SearchQuery['location'] = null;
  if (lat !== undefined && lng !== undefined) {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new SearchQueryError('lat must be between -90 and 90.');
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new SearchQueryError('lng must be between -180 and 180.');
    }
    location = { lat, lng };
  }

  let radiusKm: SearchRadiusKm | null = null;
  if (request.radiusKm !== undefined) {
    if (!(SEARCH_RADII_KM as readonly number[]).includes(request.radiusKm)) {
      throw new SearchQueryError(`radiusKm must be one of ${SEARCH_RADII_KM.join(', ')}.`);
    }
    if (location === null) throw new SearchQueryError('radiusKm needs a location.');
    radiusKm = request.radiusKm as SearchRadiusKm;
  }

  let tatMax: number | null = null;
  if (request.tatMax !== undefined) {
    if (!Number.isInteger(request.tatMax) || request.tatMax < 1) {
      throw new SearchQueryError('tatMax must be a whole number of days, at least 1.');
    }
    tatMax = request.tatMax;
  }

  let priceMaxPaise: bigint | null = null;
  if (request.priceMax !== undefined) {
    if (typeof request.priceMax === 'number' && !Number.isSafeInteger(request.priceMax)) {
      throw new SearchQueryError('priceMax must be a whole number of paise.');
    }
    const value = BigInt(request.priceMax);
    if (value < 0n) throw new SearchQueryError('priceMax must not be negative.');
    priceMaxPaise = value;
  }

  let category: PublicLabCategory | null = null;
  if (request.category !== undefined) {
    if (!(CATEGORIES as readonly string[]).includes(request.category)) {
      throw new SearchQueryError('category must be TESTING or CALIBRATION.');
    }
    category = request.category as PublicLabCategory;
  }

  const sort = request.sort ?? (location === null ? 'relevance' : 'distance');
  if (!SORTS.includes(sort)) throw new SearchQueryError('sort is not one of the known orders.');
  if (sort === 'distance' && location === null) {
    throw new SearchQueryError('Sorting by distance needs a location.');
  }

  const limit = request.limit ?? SEARCH_DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_MAX_PAGE_SIZE) {
    throw new SearchQueryError(`limit must be between 1 and ${String(SEARCH_MAX_PAGE_SIZE)}.`);
  }

  if (request.cursor !== undefined && request.cursor.length === 0) {
    throw new SearchQueryError('cursor must not be empty.');
  }

  return {
    text,
    terms: text === null ? [] : [text.toLowerCase()],
    location,
    radiusKm,
    disciplineCode: code('discipline', request.discipline),
    parameterCode: code('parameter', request.parameter),
    methodCode: code('method', request.method),
    tatMax,
    priceMaxPaise,
    category,
    sort,
    limit,
    cursor: request.cursor ?? null,
    asOf,
  };
}

/** Admin-managed synonyms (`search_synonym`): lower-cased term to what it expands to. */
export type SynonymMap = ReadonlyMap<string, readonly string[]>;

const MAX_SPAN = 4;

/**
 * The text itself plus its synonym expansions (SEARCH.md section 1, AC-DIS-02: `TS` finds
 * "tensile strength"). Every run of one to four words that equals a synonym term is replaced by
 * each expansion in turn, one replacement at a time. The original text always comes first; at
 * most `MAX_TERMS` terms are returned.
 */
export function expandTerms(text: string, synonyms: SynonymMap): string[] {
  const base = text.toLowerCase();
  const terms = [base];
  if (synonyms.size === 0) return terms;
  const words = base.split(' ');
  for (let span = Math.min(MAX_SPAN, words.length); span >= 1; span--) {
    for (let start = 0; start + span <= words.length; start++) {
      const phrase = words.slice(start, start + span).join(' ');
      for (const expansion of synonyms.get(phrase) ?? []) {
        const replaced = [
          ...words.slice(0, start),
          expansion.toLowerCase(),
          ...words.slice(start + span),
        ]
          .join(' ')
          .trim();
        if (replaced.length > 0 && !terms.includes(replaced)) terms.push(replaced);
        if (terms.length >= MAX_TERMS) return terms;
      }
    }
  }
  return terms;
}
