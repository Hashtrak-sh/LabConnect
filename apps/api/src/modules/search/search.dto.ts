import { SEARCH_DEFAULT_PAGE_SIZE, SEARCH_MAX_PAGE_SIZE } from '@labconnect/core';
import { DomainError, type ProblemIssue } from '../../common/domain-error.js';

// The query string of `searchLabs` (`paths/public-search.yaml`), checked by hand against the
// contract. This layer only turns strings into typed values and refuses what the contract does
// not allow; the value rules (ranges, radius list, location combinations) are applied once more
// by `normaliseSearchQuery` in packages/core, which owns them.

/** The parameters of `searchLabs` in the contract. Anything else is refused (no `sort`, OQ-151). */
const ALLOWED = new Set([
  'q',
  'lat',
  'lng',
  'pincode',
  'radiusKm',
  'discipline',
  'parameter',
  'method',
  'tatMax',
  'priceMax',
  'category',
  'cursor',
  'limit',
]);

export interface SearchLabsQuery {
  q?: string;
  lat?: number;
  lng?: number;
  /** Resolved to a point by the controller (`PincodeLocator`), never passed to the search. */
  pincode?: string;
  radiusKm?: number;
  discipline?: string;
  parameter?: string;
  method?: string;
  tatMax?: number;
  priceMax?: bigint;
  category?: string;
  cursor?: string;
  /** Always set: the request's value or the default page size. */
  limit: number;
}

function fail(issues: ProblemIssue[]): never {
  throw new DomainError('VALIDATION_FAILED', { detail: 'The query is not valid.', errors: issues });
}

const DECIMAL = /^-?\d{1,3}(\.\d{1,12})?$/;
const WHOLE = /^\d{1,9}$/;
const PAISE = /^\d{1,15}$/;
const PINCODE = /^\d{6}$/;

/**
 * `searchLabs` query parameters as typed values. A repeated parameter, an unknown one, an empty
 * one or one that is not a number where a number is expected is `422 VALIDATION_FAILED`, with
 * one issue per parameter. Giving `pincode` together with `lat` or `lng` is refused here, because
 * the core search never sees the pincode.
 */
export function parseSearchLabsQuery(query: Record<string, unknown>): SearchLabsQuery {
  const issues: ProblemIssue[] = [];
  const values = new Map<string, string>();

  for (const [name, raw] of Object.entries(query)) {
    if (!ALLOWED.has(name)) {
      issues.push({ path: name, code: 'UNKNOWN_FIELD', message: 'This parameter is not allowed.' });
    } else if (typeof raw !== 'string') {
      issues.push({ path: name, code: 'INVALID_VALUE', message: 'Give this parameter once.' });
    } else if (raw.length === 0) {
      issues.push({ path: name, code: 'INVALID_VALUE', message: 'This parameter is empty.' });
    } else {
      values.set(name, raw);
    }
  }

  const result: SearchLabsQuery = { limit: SEARCH_DEFAULT_PAGE_SIZE };

  const number = (name: 'lat' | 'lng'): void => {
    const raw = values.get(name);
    if (raw === undefined) return;
    if (DECIMAL.test(raw)) result[name] = Number(raw);
    else issues.push({ path: name, code: 'INVALID_VALUE', message: 'Give a decimal number.' });
  };
  number('lat');
  number('lng');

  const whole = (name: 'radiusKm' | 'tatMax' | 'limit'): number | undefined => {
    const raw = values.get(name);
    if (raw === undefined) return undefined;
    if (WHOLE.test(raw)) return Number(raw);
    issues.push({ path: name, code: 'INVALID_VALUE', message: 'Give a whole number.' });
    return undefined;
  };
  const radiusKm = whole('radiusKm');
  if (radiusKm !== undefined) result.radiusKm = radiusKm;
  const tatMax = whole('tatMax');
  if (tatMax !== undefined) result.tatMax = tatMax;
  const limit = whole('limit');
  if (limit !== undefined) {
    if (limit < 1 || limit > SEARCH_MAX_PAGE_SIZE) {
      issues.push({
        path: 'limit',
        code: 'INVALID_VALUE',
        message: `The limit is a whole number from 1 to ${String(SEARCH_MAX_PAGE_SIZE)}.`,
      });
    } else result.limit = limit;
  }

  const priceMax = values.get('priceMax');
  if (priceMax !== undefined) {
    if (PAISE.test(priceMax)) result.priceMax = BigInt(priceMax);
    else {
      issues.push({
        path: 'priceMax',
        code: 'INVALID_VALUE',
        message: 'Give a whole number of paise.',
      });
    }
  }

  const pincode = values.get('pincode');
  if (pincode !== undefined) {
    if (!PINCODE.test(pincode)) {
      issues.push({ path: 'pincode', code: 'INVALID_VALUE', message: 'A pincode has 6 digits.' });
    } else if (values.has('lat') || values.has('lng')) {
      issues.push({
        path: 'pincode',
        code: 'INVALID_VALUE',
        message: 'Give either a pincode or lat and lng, not both.',
      });
    } else result.pincode = pincode;
  }

  for (const name of ['q', 'discipline', 'parameter', 'method', 'category', 'cursor'] as const) {
    const raw = values.get(name);
    if (raw !== undefined) result[name] = raw;
  }

  if (issues.length > 0) fail(issues);
  return result;
}
