import type { ClaimRequestStatus } from '@labconnect/database';
import { DomainError, type ProblemIssue } from '../../common/domain-error.js';

// Request parts of the three Ops claim operations, checked by hand against the contract
// (`paths/admin-onboarding.yaml`, `components/schemas/admin-onboarding.yaml`): the bodies are
// `additionalProperties: false`. Nothing here names an organisation, a site or a user: Ops acts on
// a claim id, and everything else comes from the claim row (CLAUDE.md section 5).

function fail(issues: ProblemIssue[], detail: string): never {
  throw new DomainError('VALIDATION_FAILED', { detail, errors: issues });
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(
      [{ path: '', code: 'INVALID_TYPE', message: 'The body must be a JSON object.' }],
      'The request body is not valid.',
    );
  }
  return body as Record<string, unknown>;
}

function noOtherFields(
  object: Record<string, unknown>,
  allowed: readonly string[],
): ProblemIssue[] {
  return Object.keys(object)
    .filter((key) => !allowed.includes(key))
    .map((key) => ({ path: key, code: 'UNKNOWN_FIELD', message: 'This field is not allowed.' }));
}

const MAX_NOTES = 2000;

/** `AdminClaimApproval`: `{ decisionNotes? }`, at most 2000 characters. */
export function parseClaimApproval(body: unknown): { decisionNotes?: string } {
  const object = asObject(body);
  const issues = noOtherFields(object, ['decisionNotes']);
  const notes = object.decisionNotes;
  if (notes !== undefined && (typeof notes !== 'string' || notes.length > MAX_NOTES)) {
    issues.push({
      path: 'decisionNotes',
      code: 'INVALID_VALUE',
      message: `Give the notes as text of at most ${String(MAX_NOTES)} characters, or leave them out.`,
    });
  }
  if (issues.length > 0) fail(issues, 'The request body is not valid.');
  return typeof notes === 'string' ? { decisionNotes: notes } : {};
}

/** `AdminClaimRejection`: `{ decisionNotes }`, 1 to 2000 characters. */
export function parseClaimRejection(body: unknown): { decisionNotes: string } {
  const object = asObject(body);
  const issues = noOtherFields(object, ['decisionNotes']);
  const notes = object.decisionNotes;
  if (typeof notes !== 'string' || notes.length < 1 || notes.length > MAX_NOTES) {
    issues.push({
      path: 'decisionNotes',
      code: 'INVALID_VALUE',
      message: `Say why the claim is rejected, 1 to ${String(MAX_NOTES)} characters.`,
    });
  }
  if (issues.length > 0) fail(issues, 'The request body is not valid.');
  return { decisionNotes: notes as string };
}

const STATUSES: readonly string[] = [
  'PENDING_OTP',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
];

export interface ClaimListQuery {
  status?: ClaimRequestStatus;
  cursor?: string;
  limit?: number;
}

function single(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : '';
}

/**
 * `status`, `cursor` and `limit` (1 to 100) of the query string. A repeated, empty or malformed
 * parameter is `422 VALIDATION_FAILED`. The cursor's content is checked by the core, which owns
 * its format.
 */
export function parseClaimListQuery(query: Record<string, unknown>): ClaimListQuery {
  const issues: ProblemIssue[] = [];
  const result: ClaimListQuery = {};

  const status = single(query.status);
  if (status !== undefined) {
    if (!STATUSES.includes(status)) {
      issues.push({
        path: 'status',
        code: 'INVALID_VALUE',
        message: `Use one of ${STATUSES.join(', ')}.`,
      });
    } else result.status = status as ClaimRequestStatus;
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

  if (issues.length > 0) fail(issues, 'The query is not valid.');
  return result;
}
