import type { BookingListInput, BookingParty } from '@labconnect/core';
import type { BookingStatus } from '@labconnect/database';
import { BOOKING_STATUSES } from '@labconnect/shared';
import { DomainError, type ProblemIssue } from '../../common/domain-error.js';

// Queries of the booking reads (`listBookings`, `paths/bookings.yaml`), checked by hand against
// the contract. No parameter names an organisation: it comes from the active membership.

const LIST_FIELDS = new Set(['scope', 'status', 'cursor', 'limit']);
const PARTIES = new Set<string>(['customer', 'lab']);
const STATUSES = new Set<string>(BOOKING_STATUSES);

function fail(issues: ProblemIssue[]): never {
  throw new DomainError('VALIDATION_FAILED', {
    detail: 'Some parameters are not valid.',
    errors: issues,
  });
}

/** A query parameter given once; repeated (an array) or not text is `''`, which no rule accepts. */
function single(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : '';
}

/**
 * `scope`, `status` (comma-separated, each a `BookingStatus`, no repeats), `cursor` and `limit`
 * (1 to 100) of `listBookings`. Anything else is `422`.
 */
export function parseBookingListQuery(query: Record<string, unknown>): BookingListInput {
  const issues: ProblemIssue[] = [];
  const result: BookingListInput = {};
  for (const field of Object.keys(query)) {
    if (!LIST_FIELDS.has(field)) {
      issues.push({
        path: field,
        code: 'UNKNOWN_FIELD',
        message: 'This parameter is not allowed.',
      });
    }
  }
  const scope = single(query.scope);
  if (scope !== undefined) {
    if (PARTIES.has(scope)) result.scope = scope as BookingParty;
    else
      issues.push({
        path: 'scope',
        code: 'INVALID_VALUE',
        message: 'The scope is customer or lab.',
      });
  }
  const status = single(query.status);
  if (status !== undefined) {
    const values = status.split(',');
    const unique = new Set(values);
    if (status === '' || values.some((value) => !STATUSES.has(value))) {
      issues.push({ path: 'status', code: 'INVALID_VALUE', message: 'An unknown booking status.' });
    } else if (unique.size !== values.length) {
      issues.push({ path: 'status', code: 'INVALID_VALUE', message: 'A status is repeated.' });
    } else result.statuses = values as BookingStatus[];
  }
  const cursor = single(query.cursor);
  if (cursor !== undefined) {
    if (cursor === '') {
      issues.push({ path: 'cursor', code: 'INVALID_VALUE', message: 'The cursor is empty.' });
    } else result.cursor = cursor;
  }
  const limit = single(query.limit);
  if (limit !== undefined) {
    const parsed = /^\d{1,4}$/.test(limit) ? Number(limit) : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      issues.push({
        path: 'limit',
        code: 'INVALID_VALUE',
        message: 'The limit is a whole number from 1 to 100.',
      });
    } else result.limit = parsed;
  }
  if (issues.length > 0) fail(issues);
  return result;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The booking id of the path: not a UUID is `422`, as for the other ids of the API. */
export function requireBookingId(id: string): string {
  if (UUID.test(id)) return id.toLowerCase();
  throw new DomainError('VALIDATION_FAILED', {
    detail: 'The booking id is not valid.',
    errors: [{ path: 'id', code: 'INVALID_VALUE', message: 'Give a UUID.' }],
  });
}
