import type { BookingListInput, BookingParty, LabInboxInput } from '@labconnect/core';
import type { BookingStatus } from '@labconnect/database';
import { BOOKING_STATUSES } from '@labconnect/shared';
import { DomainError, type ProblemIssue } from '../../common/domain-error.js';

// Queries of the booking reads (`listBookings`, `paths/bookings.yaml`; `getLabInbox`,
// `paths/lab-inbox.yaml`), checked by hand against
// the contract. No parameter names an organisation: it comes from the active membership.

const LIST_FIELDS = new Set(['scope', 'status', 'cursor', 'limit']);
const INBOX_FIELDS = new Set(['status', 'siteId', 'cursor', 'limit']);
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
  const issues = unknownFields(query, LIST_FIELDS);
  const result: BookingListInput = {};
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
  Object.assign(result, parsePaging(query, issues));
  if (issues.length > 0) fail(issues);
  return result;
}

/**
 * `status`, `siteId` (a UUID), `cursor` and `limit` of `getLabInbox`; `status`, `cursor` and
 * `limit` read as for `listBookings`. Anything else is `422`.
 */
export function parseLabInboxQuery(query: Record<string, unknown>): LabInboxInput {
  const issues = unknownFields(query, INBOX_FIELDS);
  const result: LabInboxInput = {};
  const siteId = single(query.siteId);
  if (siteId !== undefined) {
    if (UUID.test(siteId)) result.siteId = siteId.toLowerCase();
    else issues.push({ path: 'siteId', code: 'INVALID_VALUE', message: 'Give a UUID.' });
  }
  Object.assign(result, parsePaging(query, issues));
  if (issues.length > 0) fail(issues);
  return result;
}

function unknownFields(query: Record<string, unknown>, allowed: Set<string>): ProblemIssue[] {
  return Object.keys(query)
    .filter((field) => !allowed.has(field))
    .map((field) => ({
      path: field,
      code: 'UNKNOWN_FIELD',
      message: 'This parameter is not allowed.',
    }));
}

/** `status` (comma-separated, each a `BookingStatus`, no repeats), `cursor`, `limit` (1 to 100). */
function parsePaging(
  query: Record<string, unknown>,
  issues: ProblemIssue[],
): { statuses?: BookingStatus[]; cursor?: string; limit?: number } {
  const result: { statuses?: BookingStatus[]; cursor?: string; limit?: number } = {};
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function text(
  raw: Record<string, unknown>,
  field: string,
  max: number,
  issues: ProblemIssue[],
): string | undefined {
  const value = raw[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push({ path: field, code: 'REQUIRED', message: 'This field is required.' });
    return undefined;
  }
  if (value.length > max) {
    issues.push({
      path: field,
      code: 'TOO_LONG',
      message: `At most ${String(max)} characters.`,
    });
    return undefined;
  }
  return value.trim();
}

/** `BookingRejectRequest`: a REJECTION_REASON code and an explanation, both required. */
export function parseBookingReject(body: unknown): { reasonCode: string; notes: string } {
  if (!isRecord(body)) fail([{ path: '', code: 'INVALID_TYPE', message: 'Send a JSON object.' }]);
  const issues: ProblemIssue[] = [];
  for (const field of Object.keys(body)) {
    if (field !== 'reasonCode' && field !== 'notes') {
      issues.push({ path: field, code: 'UNKNOWN_FIELD', message: 'This field is not allowed.' });
    }
  }
  const reasonCode = text(body, 'reasonCode', 100, issues);
  const notes = text(body, 'notes', 2000, issues);
  if (issues.length > 0 || reasonCode === undefined || notes === undefined) fail(issues);
  return { reasonCode, notes };
}

/**
 * `BookingCounterCreate` (BR-017, CD-08): another slot and/or more sample per line, and a message.
 * A field whose name starts with `price` or `method` is `COUNTER_FIELD_NOT_ALLOWED`; any other
 * unknown field is `VALIDATION_FAILED`.
 */
export function parseBookingCounter(body: unknown): {
  proposedSlotId?: string;
  perLineQuantity?: { lineId: string; sampleQty: number; unitCode: string }[];
  message: string;
} {
  if (!isRecord(body)) fail([{ path: '', code: 'INVALID_TYPE', message: 'Send a JSON object.' }]);
  const forbidden = Object.keys(body).filter((field) => /^(price|method)/i.test(field));
  if (forbidden.length > 0) {
    throw new DomainError('COUNTER_FIELD_NOT_ALLOWED', {
      detail: 'A counter-offer cannot change the price or the method (CD-08).',
      errors: forbidden.map((field) => ({
        path: field,
        code: 'NOT_ALLOWED',
        message: 'Only the slot and the sample quantity can be countered.',
      })),
    });
  }
  const issues: ProblemIssue[] = [];
  for (const field of Object.keys(body)) {
    if (!['proposedSlotId', 'perLineQuantity', 'message'].includes(field)) {
      issues.push({ path: field, code: 'UNKNOWN_FIELD', message: 'This field is not allowed.' });
    }
  }
  const message = text(body, 'message', 2000, issues);
  const result: ReturnType<typeof parseBookingCounter> = { message: message ?? '' };
  if (body.proposedSlotId !== undefined) {
    if (typeof body.proposedSlotId === 'string' && UUID.test(body.proposedSlotId)) {
      result.proposedSlotId = body.proposedSlotId.toLowerCase();
    } else {
      issues.push({ path: 'proposedSlotId', code: 'INVALID_VALUE', message: 'Give a UUID.' });
    }
  }
  if (body.perLineQuantity !== undefined) {
    const items = body.perLineQuantity;
    if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
      issues.push({
        path: 'perLineQuantity',
        code: 'INVALID_VALUE',
        message: 'One to 100 lines.',
      });
    } else {
      const quantities: { lineId: string; sampleQty: number; unitCode: string }[] = [];
      items.forEach((item: unknown, index) => {
        const path = `perLineQuantity[${String(index)}]`;
        if (!isRecord(item)) {
          issues.push({ path, code: 'INVALID_TYPE', message: 'An object.' });
          return;
        }
        for (const field of Object.keys(item)) {
          if (!['lineId', 'sampleQty', 'unitCode'].includes(field)) {
            issues.push({
              path: `${path}.${field}`,
              code: 'UNKNOWN_FIELD',
              message: 'This field is not allowed.',
            });
          }
        }
        const { lineId, sampleQty, unitCode } = item;
        const okLine = typeof lineId === 'string' && UUID.test(lineId);
        // More than 0, and what `booking_line.required_sample_qty` (DECIMAL(12,3)) can hold.
        const okQty =
          typeof sampleQty === 'number' &&
          Number.isFinite(sampleQty) &&
          sampleQty > 0 &&
          sampleQty < 1_000_000_000 &&
          atMostThreeDecimals(sampleQty);
        const okUnit =
          typeof unitCode === 'string' && unitCode.length >= 1 && unitCode.length <= 100;
        if (!okLine)
          issues.push({ path: `${path}.lineId`, code: 'INVALID_VALUE', message: 'Give a UUID.' });
        if (!okQty)
          issues.push({
            path: `${path}.sampleQty`,
            code: 'INVALID_VALUE',
            message: 'More than 0, with at most three decimals.',
          });
        if (!okUnit)
          issues.push({ path: `${path}.unitCode`, code: 'INVALID_VALUE', message: 'A unit code.' });
        if (okLine && okQty && okUnit) quantities.push({ lineId, sampleQty, unitCode });
      });
      result.perLineQuantity = quantities;
    }
  }
  if (result.proposedSlotId === undefined && body.perLineQuantity === undefined) {
    issues.push({
      path: 'proposedSlotId',
      code: 'REQUIRED',
      message: 'Propose another slot, more sample, or both.',
    });
  }
  if (issues.length > 0) fail(issues);
  return result;
}

/** A quantity the line can store as it is (`required_sample_qty` is DECIMAL(12,3)). */
function atMostThreeDecimals(value: number): boolean {
  const thousandths = value * 1000;
  return Math.abs(thousandths - Math.round(thousandths)) < 1e-6;
}

/** `BookingCancelRequest`: a CANCELLATION_REASON code, and optional notes. */
export function parseBookingCancel(body: unknown): { reasonCode: string; notes?: string } {
  if (!isRecord(body)) fail([{ path: '', code: 'INVALID_TYPE', message: 'Send a JSON object.' }]);
  const issues: ProblemIssue[] = [];
  for (const field of Object.keys(body)) {
    if (field !== 'reasonCode' && field !== 'notes') {
      issues.push({ path: field, code: 'UNKNOWN_FIELD', message: 'This field is not allowed.' });
    }
  }
  const reasonCode = text(body, 'reasonCode', 100, issues);
  let notes: string | undefined;
  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string' || body.notes.length > 2000) {
      issues.push({ path: 'notes', code: 'INVALID_VALUE', message: 'At most 2000 characters.' });
    } else if (body.notes.trim().length > 0) notes = body.notes.trim();
  }
  if (issues.length > 0 || reasonCode === undefined) fail(issues);
  return { reasonCode, ...(notes !== undefined && { notes }) };
}
