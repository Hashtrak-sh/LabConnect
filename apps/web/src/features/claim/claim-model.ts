import type { components } from '@labconnect/api-contract';
import type { Problem } from '@/features/common/problem';

/** The abuse limits of CLAIM_LIMITS (packages/core/src/labs/claim-limits.ts), for the texts. */
export const CLAIM_LIMITS = { openClaims: 3, uploadsPerClaim: 5, codeValidHours: 24 } as const;

export type LabClaim = components['schemas']['LabClaim'];
export type ClaimStatus = LabClaim['status'];

// ---- What a read of the API means for a screen -----------------------------------------------

/**
 * Why `listMyLabClaims` or `getLabClaim` gave no claim. `unavailable` is every answer that is not
 * about the claim itself (a 5xx, a 429, no answer at all): the screen then says the service is not
 * answering and never "no claims" or "not found".
 */
export type ReadFailure = 'signed-out' | 'staff' | 'not-found' | 'bad-page' | 'unavailable';

/**
 * The status of a refused read as a failure. 404 is one answer for another user's claim and for an
 * id that does not exist. A 422 is a cursor that cannot be read (the list) or an id that is not a
 * UUID (one claim, which is the same "not found" to the person). 403 is platform staff (RR-5).
 */
export function readFailure(status: number | undefined, read: 'list' | 'one'): ReadFailure {
  switch (status) {
    case 401:
      return 'signed-out';
    case 403:
      return 'staff';
    case 404:
      return 'not-found';
    case 422:
      return read === 'list' ? 'bad-page' : 'not-found';
    default:
      return 'unavailable';
  }
}

/** Most of a reason that is shown; the API's own limit is 2000, so this never cuts a real one. */
export const MAX_REASON_CHARS = 4000;

/**
 * The reason Ops gave for a rejection, for the claimant. Only a `REJECTED` claim has one: the
 * notes of an approval are the reviewer's own, and the API sends `null` for them, but this screen
 * does not depend on that. Always text (the page never renders it as HTML). `null` when there is
 * no reason to show.
 */
export function reasonForClaimant(
  claim: Pick<LabClaim, 'status' | 'decisionNotes'>,
): string | null {
  if (claim.status !== 'REJECTED' || typeof claim.decisionNotes !== 'string') return null;
  const notes = claim.decisionNotes.trim();
  if (notes === '') return null;
  return notes.length > MAX_REASON_CHARS ? `${notes.slice(0, MAX_REASON_CHARS)}…` : notes;
}

/** Why a claim page was reloaded after a form: the claim changed, or it moved to another state. */
export type ReloadNotice = 'changed' | 'moved';

/** `?n=` of a claim page (nothing personal in it). */
export function readReloadNotice(raw: string | string[] | undefined): ReloadNotice | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'changed' || value === 'moved' ? value : null;
}

/** Whether the claimant reads may be called at all: platform staff hold no claim (RR-5). */
export function mayReadClaims(user: { memberships: readonly { orgType: string }[] }): boolean {
  return !user.memberships.some((membership) => membership.orgType === 'PLATFORM');
}

/**
 * What a form that met a claim that is not as the page showed it does: reload the page from the
 * API (`changed`: the version moved, `moved`: the state is not the one the form was for), or
 * nothing when the answer is about the form itself.
 */
export function reloadFor(
  outcome: VerifyOutcome | SubmitOutcome | UploadOutcome | StartOutcome,
): ReloadNotice | null {
  switch (outcome) {
    case 'changed':
      return 'changed';
    case 'in-review':
    case 'own-review':
    case 'expired':
    case 'not-open':
    case 'claimed':
    case 'not-found':
      return 'moved';
    default:
      return null;
  }
}

// ---- The certificate number and the code ----------------------------------------------------

/** A certificate number as typed: trimmed, 1 to 50 characters (the contract's `CertificateNo`). */
export function readCertificate(raw: unknown): { ok: true; value: string } | { ok: false } {
  if (typeof raw !== 'string') return { ok: false };
  const value = raw.trim();
  return value.length >= 1 && value.length <= 50 ? { ok: true, value } : { ok: false };
}

/** A claim code: six digits, spaces allowed. */
export function readClaimCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.replaceAll(/\s/g, '');
  return /^\d{6}$/.test(code) ? code : null;
}

// ---- What an API answer means for the screen ------------------------------------------------

export type StartOutcome =
  | 'signed-out'
  | 'staff'
  | 'not-found'
  | 'claimed'
  | 'other-open'
  | 'own-review'
  | 'cap'
  | 'rate-limited'
  | 'failed';

/**
 * `startLabClaim`. The 422 is the same for an unknown, expired, suspended, hidden or ambiguous
 * certificate (OQ-205), so the screen says only "not found". A 429 with a `Retry-After` is the
 * code limit (5 per 15 minutes per address); one without is the cap of open claims.
 */
export function startOutcome(problem: Problem): StartOutcome {
  switch (problem.status) {
    case 401:
      return 'signed-out';
    case 403:
      return 'staff';
    case 422:
      return 'not-found';
    case 409:
      if (problem.currentState === 'CLAIMED') return 'claimed';
      if (problem.currentState === 'CLAIM_PENDING') return 'other-open';
      if (problem.currentState === 'PENDING_REVIEW') return 'own-review';
      return 'failed';
    case 429:
      return problem.retryAfterSeconds === undefined ? 'cap' : 'rate-limited';
    default:
      return 'failed';
  }
}

export type VerifyOutcome =
  | 'signed-out'
  | 'not-found'
  | 'code-invalid'
  | 'code-expired'
  | 'locked'
  | 'rate-limited'
  | 'changed'
  | 'in-review'
  | 'expired'
  | 'not-open'
  | 'failed';

/** `verifyLabClaimOtp` (404, 409, 412, then the code: ERROR_HANDLING and AUTHENTICATION §5). */
export function verifyOutcome(problem: Problem): VerifyOutcome {
  switch (problem.status) {
    case 401:
      return 'signed-out';
    case 404:
      return 'not-found';
    case 409:
      if (problem.currentState === 'PENDING_REVIEW') return 'in-review';
      if (problem.currentState === 'EXPIRED') return 'expired';
      return problem.currentState === undefined ? 'failed' : 'not-open';
    case 412:
      return 'changed';
    case 422:
      return problem.code === 'OTP_EXPIRED' ? 'code-expired' : 'code-invalid';
    case 429:
      return problem.code === 'OTP_LOCKED' ? 'locked' : 'rate-limited';
    default:
      return 'failed';
  }
}

export type UploadOutcome =
  | 'signed-out'
  | 'not-found'
  | 'file-rejected'
  | 'upload-cap'
  | 'rate-limited'
  | 'in-review'
  | 'expired'
  | 'not-open'
  | 'failed';

/** `createLabClaimLetterheadUploadUrl`: a 429 without `Retry-After` is the cap of 5 uploads. */
export function uploadOutcome(problem: Problem): UploadOutcome {
  switch (problem.status) {
    case 401:
      return 'signed-out';
    case 404:
      return 'not-found';
    case 409:
      if (problem.currentState === 'PENDING_REVIEW') return 'in-review';
      if (problem.currentState === 'EXPIRED') return 'expired';
      return problem.currentState === undefined ? 'failed' : 'not-open';
    case 422:
      return 'file-rejected';
    case 429:
      return problem.retryAfterSeconds === undefined ? 'upload-cap' : 'rate-limited';
    default:
      return 'failed';
  }
}

export type SubmitOutcome =
  | 'signed-out'
  | 'not-found'
  | 'scanning'
  | 'changed'
  | 'in-review'
  | 'expired'
  | 'not-open'
  | 'failed';

/** `submitLabClaimLetterhead`: 422 `FILE_NOT_CLEAN` means the scan has not finished (or failed). */
export function submitOutcome(problem: Problem): SubmitOutcome {
  switch (problem.status) {
    case 401:
      return 'signed-out';
    case 404:
      return 'not-found';
    case 409:
      if (problem.currentState === 'PENDING_REVIEW') return 'in-review';
      if (problem.currentState === 'EXPIRED') return 'expired';
      return problem.currentState === undefined ? 'failed' : 'not-open';
    case 412:
      return 'changed';
    case 422:
      return problem.code === 'FILE_NOT_CLEAN' ? 'scanning' : 'failed';
    default:
      return 'failed';
  }
}

// ---- The letterhead file ---------------------------------------------------------------------

/** The limits of the `KYC_DOCUMENT` purpose (packages/core/src/files/purposes.ts), 10 MB. */
export const LETTERHEAD_MAX_BYTES = 10 * 1024 * 1024;
export const LETTERHEAD_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type LetterheadType = (typeof LETTERHEAD_TYPES)[number];

export type LetterheadCheck =
  | { ok: true; contentType: LetterheadType; sizeBytes: number }
  | { ok: false; reason: 'type' | 'size' | 'empty' };

/**
 * The declared type and size of a letterhead, checked on the server before an upload URL is asked
 * for (the API checks again; the browser checked first). The file itself never reaches this
 * server, so what is inside it is checked by the browser's header test below and, for real, by the
 * malware scan and validation behind the pre-signed URL.
 */
export function checkLetterhead(input: {
  contentType: unknown;
  sizeBytes: unknown;
}): LetterheadCheck {
  const type = LETTERHEAD_TYPES.find((candidate) => candidate === input.contentType);
  if (type === undefined) return { ok: false, reason: 'type' };
  const size = input.sizeBytes;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1)
    return { ok: false, reason: 'empty' };
  if (size > LETTERHEAD_MAX_BYTES) return { ok: false, reason: 'size' };
  return { ok: true, contentType: type, sizeBytes: size };
}

/**
 * The type a file's first bytes say it is: `%PDF-`, a JPEG start or a PNG signature. A courtesy
 * check in the browser, so an HTML page renamed `.pdf` is turned away before it is sent.
 */
export function sniffLetterhead(bytes: Uint8Array): LetterheadType | null {
  const startsWith = (...values: number[]) =>
    values.every((value, index) => bytes[index] === value);
  if (startsWith(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf';
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  return null;
}
