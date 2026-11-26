import type { LeadInput, LeadSearchCriteria } from '@labconnect/core';
import { DomainError, type ProblemIssue } from '../../common/domain-error.js';

// The body of `createLead` (`LeadCreate`, `components/schemas/public-search.yaml`), checked by hand
// against the contract: objects have `additionalProperties: false`.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RADII = new Set([5, 10, 25, 50, 100]);
const CATEGORIES = new Set(['TESTING', 'CALIBRATION']);
const BODY_FIELDS = new Set(['kind', 'labSiteId', 'query', 'contactEmail']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function criteria(raw: unknown, issues: ProblemIssue[]): LeadSearchCriteria | null {
  if (!isObject(raw)) {
    issues.push({ path: 'query', code: 'INVALID_TYPE', message: 'query is an object.' });
    return null;
  }
  const result: LeadSearchCriteria = {};
  const bad = (field: string, message: string): void => {
    issues.push({ path: `query.${field}`, code: 'INVALID_VALUE', message });
  };
  for (const [field, value] of Object.entries(raw)) {
    switch (field) {
      case 'q': {
        // Cleaned exactly as the search cleans its text (`cleanText`): control characters are
        // refused, then NFKC, white space collapsed, and the length checked last.
        const text =
          typeof value === 'string' &&
          // eslint-disable-next-line no-control-regex -- refusing control characters is the point
          !/[\u0000-\u001f\u007f]/.test(value.replaceAll(/[\t\n\r]/g, ' '))
            ? value.normalize('NFKC').replaceAll(/\s+/g, ' ').trim()
            : '';
        if (text.length >= 1 && text.length <= 200) result.q = text;
        else bad(field, 'Give 1 to 200 characters, without control characters.');
        break;
      }
      case 'pincode':
        if (typeof value === 'string' && /^\d{6}$/.test(value)) result.pincode = value;
        else bad(field, 'A pincode has 6 digits.');
        break;
      case 'radiusKm':
        if (typeof value === 'number' && RADII.has(value)) result.radiusKm = value;
        else bad(field, 'The radius is 5, 10, 25, 50 or 100.');
        break;
      case 'tatMax':
        if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
          result.tatMax = value;
        } else bad(field, 'Give a whole number of days, at least 1.');
        break;
      case 'priceMax':
        if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
          result.priceMax = value;
        } else bad(field, 'Give a whole number of paise.');
        break;
      case 'category':
        if (typeof value === 'string' && CATEGORIES.has(value)) result.category = value;
        else bad(field, 'The category is TESTING or CALIBRATION.');
        break;
      case 'discipline':
      case 'parameter':
      case 'method':
        if (typeof value === 'string' && value.length >= 1 && value.length <= 100) {
          result[field] = value;
        } else bad(field, 'Give a node code.');
        break;
      default:
        // `lat` and `lng` land here too: the device location is never stored.
        issues.push({
          path: `query.${field}`,
          code: 'UNKNOWN_FIELD',
          message: 'This field is not allowed.',
        });
    }
  }
  return result;
}

/**
 * `LeadCreate`: `REQUEST_LAB` needs `labSiteId`; `NO_RESULT` needs `query` and has no
 * `labSiteId`. A field the schema does not define is 422 `VALIDATION_FAILED`.
 */
export function parseLeadCreate(body: unknown): LeadInput {
  const issues: ProblemIssue[] = [];
  const fail = (): never => {
    throw new DomainError('VALIDATION_FAILED', {
      detail: 'The request body is not valid.',
      errors: issues,
    });
  };
  if (!isObject(body)) {
    issues.push({ path: '', code: 'INVALID_TYPE', message: 'The body must be a JSON object.' });
    return fail();
  }
  for (const field of Object.keys(body)) {
    if (!BODY_FIELDS.has(field)) {
      issues.push({ path: field, code: 'UNKNOWN_FIELD', message: 'This field is not allowed.' });
    }
  }

  let contactEmail: string | null = null;
  if (body.contactEmail !== undefined) {
    const email = body.contactEmail;
    if (typeof email === 'string' && email.length <= 254 && EMAIL.test(email.trim())) {
      contactEmail = email.trim();
    } else {
      issues.push({
        path: 'contactEmail',
        code: 'INVALID_EMAIL',
        message: 'Give an email address.',
      });
    }
  }
  const query = body.query === undefined ? null : criteria(body.query, issues);

  if (body.kind === 'REQUEST_LAB') {
    const labSiteId = body.labSiteId;
    if (typeof labSiteId !== 'string' || !UUID.test(labSiteId)) {
      issues.push({ path: 'labSiteId', code: 'REQUIRED', message: 'Give the lab site id.' });
      return fail();
    }
    if (issues.length > 0) fail();
    return { kind: 'REQUEST_LAB', labSiteId, query, contactEmail };
  }
  if (body.kind === 'NO_RESULT') {
    if (body.labSiteId !== undefined) {
      issues.push({
        path: 'labSiteId',
        code: 'UNKNOWN_FIELD',
        message: 'Not allowed for NO_RESULT.',
      });
    }
    if (body.query === undefined) {
      issues.push({
        path: 'query',
        code: 'REQUIRED',
        message: 'Give the search that found nothing.',
      });
    }
    if (issues.length > 0 || query === null) return fail();
    return { kind: 'NO_RESULT', query, contactEmail };
  }
  issues.push({
    path: 'kind',
    code: 'INVALID_VALUE',
    message: 'The kind is REQUEST_LAB or NO_RESULT.',
  });
  return fail();
}
