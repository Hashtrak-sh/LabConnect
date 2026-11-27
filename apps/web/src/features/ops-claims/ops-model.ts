import type { components } from '@labconnect/api-contract';
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

/** The claim as Ops see it: `getAdminLabClaim`, and each row of `listAdminLabClaims`. */
export type AdminClaim = components['schemas']['AdminLabClaim'];

export interface ClaimPage {
  data: AdminClaim[];
  nextCursor: string | null;
}

export type ClaimReadFailure = 'signed-out' | 'forbidden' | 'not-found' | 'unavailable';

/**
 * Why `getAdminLabClaim` gave no claim. 404 (and a malformed id, 422) is "not found"; 403 is a
 * role that may not review; anything else (a 5xx, a 429, no answer) is "unavailable", which the
 * screen must not word as "not found".
 */
export function claimReadFailure(status: number | undefined): ClaimReadFailure {
  switch (status) {
    case 401:
      return 'signed-out';
    case 403:
      return 'forbidden';
    case 404:
    case 422:
      return 'not-found';
    default:
      return 'unavailable';
  }
}

export type OrgType = AdminClaim['claimant']['organisationTypes'][number];

/**
 * The reasons an approval would be refused that the claim already shows (RR-2: one lab role per
 * user, so a claimant who belongs to a lab; RR-5: platform staff hold no lab role). The API stays
 * the authority and the approve action still handles its refusal.
 */
export function approvalBlockers(types: readonly OrgType[]): ('LAB' | 'PLATFORM')[] {
  const blockers: ('LAB' | 'PLATFORM')[] = [];
  if (types.includes('LAB')) blockers.push('LAB');
  if (types.includes('PLATFORM')) blockers.push('PLATFORM');
  return blockers;
}

/** The certificate numbers of a site as one line, or `null` when there are none. */
export function certificateNumbers(numbers: readonly string[]): string | null {
  return numbers.length === 0 ? null : numbers.join(', ');
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
