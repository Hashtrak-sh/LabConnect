import type { Problem } from '@/features/common/problem';

export type ClaimStatus = 'PENDING_OTP' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

/** The filters of the list: one status each, `PENDING_REVIEW` first because it is the work. */
export const STATUS_FILTERS: readonly ClaimStatus[] = [
  'PENDING_REVIEW',
  'PENDING_OTP',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
];

/** `?status=` from the address: one of the five statuses, or `null` for "all". */
export function readStatusFilter(raw: string | string[] | undefined): ClaimStatus | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return STATUS_FILTERS.find((status) => status === value) ?? null;
}

/** The claim as Ops see it (`AdminLabClaim`): ids, method, state, version. No name, no address. */
export interface AdminClaim {
  id: string;
  organisationId: string;
  labSiteId: string;
  requestedByUserId: string;
  method: 'EMAIL_OTP' | 'MANUAL';
  status: ClaimStatus;
  authorisationFileId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  decisionNotes: string | null;
  createdAt: string;
  lockVersion: number;
}

export interface ClaimPage {
  data: AdminClaim[];
  nextCursor: string | null;
}

/**
 * Finds one claim by id. The API has no "read one claim" operation (the detail needs the claim's
 * version for `If-Match`), so this walks the list, oldest first, until the id is found: at most
 * `maxPages` pages of 100. `null` means not found in what was read.
 */
export async function findClaim(
  fetchPage: (cursor: string | null) => Promise<ClaimPage | null>,
  id: string,
  maxPages = 20,
): Promise<AdminClaim | null> {
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(cursor);
    if (result === null) return null;
    const claim = result.data.find((candidate) => candidate.id === id);
    if (claim !== undefined) return claim;
    if (result.nextCursor === null) return null;
    cursor = result.nextCursor;
  }
  return null;
}

export type DecisionOutcome =
  | 'signed-out'
  | 'forbidden'
  | 'not-found'
  | 'already-decided'
  | 'busy'
  | 'changed'
  | 'letterhead-missing'
  | 'file-not-clean'
  | 'notes-required'
  | 'claimant-blocked'
  | 'rate-limited'
  | 'failed';

/**
 * `approveAdminLabClaim` and `rejectAdminLabClaim`. 403 is Ops only; 409 is "not in review any
 * more" (someone decided first, or it expired); 412 is "the claim changed since you loaded it";
 * the 422 reasons are the ones claim-review.ts documents.
 */
export function decisionOutcome(problem: Problem): DecisionOutcome {
  switch (problem.status) {
    case 401:
      return 'signed-out';
    case 403:
      return 'forbidden';
    case 404:
      return 'not-found';
    case 409:
      return problem.code === 'REQUEST_IN_PROGRESS' ? 'busy' : 'already-decided';
    case 412:
      return 'changed';
    case 422:
      if (problem.code === 'FILE_NOT_CLEAN') return 'file-not-clean';
      if (problem.reason === 'LETTERHEAD_MISSING') return 'letterhead-missing';
      if (problem.reason === 'DECISION_NOTES_REQUIRED') return 'notes-required';
      if (problem.reason?.startsWith('CLAIMANT_') === true) return 'claimant-blocked';
      return 'failed';
    case 429:
      return 'rate-limited';
    default:
      return 'failed';
  }
}

export type DownloadOutcome =
  'signed-out' | 'forbidden' | 'no-letterhead' | 'not-clean' | 'rate-limited' | 'failed';

/** `createAdminLabClaimLetterheadDownloadUrl`. */
export function downloadOutcome(problem: Problem): DownloadOutcome {
  switch (problem.status) {
    case 401:
      return 'signed-out';
    case 403:
      return 'forbidden';
    case 404:
      return 'no-letterhead';
    case 422:
      return problem.code === 'FILE_NOT_CLEAN' ? 'not-clean' : 'failed';
    case 429:
      return 'rate-limited';
    default:
      return 'failed';
  }
}

/** The reasons the board offers for a rejection; the API has no field for them (J9). */
export const REJECT_REASONS = ['signature', 'letterhead', 'certificate', 'other'] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export function readRejectReason(raw: unknown): RejectReason | null {
  return REJECT_REASONS.find((reason) => reason === raw) ?? null;
}

const MAX_NOTES = 2000;

/**
 * The text sent as `decisionNotes`: the chosen reason (its text, unless "other") written at the
 * start, then the notes (J9: "Reason list has no contract field: written at the start of
 * decisionNotes"). Notes are required and not blank; the total is at most 2000 characters.
 */
export function rejectionNotes(
  reasonText: string | null,
  rawNotes: unknown,
): { ok: true; value: string } | { ok: false; reason: 'notes-required' | 'too-long' } {
  const notes = typeof rawNotes === 'string' ? rawNotes.trim() : '';
  if (notes === '') return { ok: false, reason: 'notes-required' };
  const value = reasonText === null ? notes : `${reasonText}: ${notes}`;
  return value.length > MAX_NOTES ? { ok: false, reason: 'too-long' } : { ok: true, value };
}

/** A decision's optional notes on approval: trimmed, at most 2000 characters, or `undefined`. */
export function approvalNotes(raw: unknown): string | undefined | null {
  if (typeof raw !== 'string') return undefined;
  const notes = raw.trim();
  if (notes === '') return undefined;
  return notes.length > MAX_NOTES ? null : notes;
}

/**
 * Whether a link the API gave is one to hand to the browser: an `http(s)` address. Anything else
 * (a `javascript:` or `data:` address) is never followed.
 */
export function isFollowableUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
