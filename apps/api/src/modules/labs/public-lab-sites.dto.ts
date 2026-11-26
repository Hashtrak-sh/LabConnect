import type { PublicPageQuery, PublicScopeQuery } from '@labconnect/core';
import { DomainError, type ProblemIssue } from '../../common/domain-error.js';

// Query strings of the public lab site lists (`paths/public-lab-sites.yaml`), checked by hand
// against the contract. An unknown, repeated or empty parameter is 422 VALIDATION_FAILED.

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_TEXT_LENGTH = 200;

function fail(issues: ProblemIssue[]): never {
  throw new DomainError('VALIDATION_FAILED', { detail: 'The query is not valid.', errors: issues });
}

function single(
  query: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  issues: ProblemIssue[],
): Map<string, string> {
  const values = new Map<string, string>();
  for (const [name, raw] of Object.entries(query)) {
    if (!allowed.has(name)) {
      issues.push({ path: name, code: 'UNKNOWN_FIELD', message: 'This parameter is not allowed.' });
    } else if (typeof raw !== 'string') {
      issues.push({ path: name, code: 'INVALID_VALUE', message: 'Give this parameter once.' });
    } else if (raw.length === 0) {
      issues.push({ path: name, code: 'INVALID_VALUE', message: 'This parameter is empty.' });
    } else values.set(name, raw);
  }
  return values;
}

function limitOf(raw: string | undefined, issues: ProblemIssue[]): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const parsed = /^\d{1,4}$/.test(raw) ? Number(raw) : Number.NaN;
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_LIMIT) return parsed;
  issues.push({
    path: 'limit',
    code: 'INVALID_VALUE',
    message: `The limit is a whole number from 1 to ${String(MAX_LIMIT)}.`,
  });
  return DEFAULT_LIMIT;
}

/**
 * The search text as the lab search cleans it (`cleanText` in packages/core search): NFKC, white
 * space collapsed, control characters refused, 1 to 200 characters (`SearchText`).
 */
function textOf(raw: string | undefined, issues: ProblemIssue[]): string | null {
  if (raw === undefined) return null;
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(raw.replaceAll(/[\t\n\r]/g, ' '))) {
    issues.push({ path: 'q', code: 'INVALID_VALUE', message: 'Remove control characters.' });
    return null;
  }
  const text = raw.normalize('NFKC').replaceAll(/\s+/g, ' ').trim();
  if (text.length === 0 || text.length > MAX_TEXT_LENGTH) {
    issues.push({
      path: 'q',
      code: 'INVALID_VALUE',
      message: `Give 1 to ${String(MAX_TEXT_LENGTH)} characters.`,
    });
    return null;
  }
  return text;
}

const SCOPE_PARAMETERS = new Set(['q', 'cursor', 'limit']);

/** `listPublicScopeLines`: `q`, `cursor` and `limit`. The cursor's content is checked by the directory. */
export function parseScopeQuery(query: Record<string, unknown>): PublicScopeQuery {
  const issues: ProblemIssue[] = [];
  const values = single(query, SCOPE_PARAMETERS, issues);
  const result: PublicScopeQuery = {
    text: textOf(values.get('q'), issues),
    cursor: values.get('cursor') ?? null,
    limit: limitOf(values.get('limit'), issues),
  };
  if (issues.length > 0) fail(issues);
  return result;
}

const PAGE_PARAMETERS = new Set(['cursor', 'limit']);

/** `cursor` and `limit` only (`getPublicPriceList`). The cursor's content is checked by the directory. */
export function parsePageQuery(query: Record<string, unknown>): PublicPageQuery {
  const issues: ProblemIssue[] = [];
  const values = single(query, PAGE_PARAMETERS, issues);
  const result: PublicPageQuery = {
    cursor: values.get('cursor') ?? null,
    limit: limitOf(values.get('limit'), issues),
  };
  if (issues.length > 0) fail(issues);
  return result;
}
