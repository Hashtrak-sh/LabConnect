import { cleanEtag, isUuid, type Problem } from '@/features/common/problem';

/** The abuse limits of CLAIM_LIMITS (packages/core/src/labs/claim-limits.ts), for the texts. */
export const CLAIM_LIMITS = { openClaims: 3, uploadsPerClaim: 5, codeValidHours: 24 } as const;

export type ClaimStatus = 'PENDING_OTP' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
const STATUSES: readonly ClaimStatus[] = [
  'PENDING_OTP',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
];

/**
 * A claim as the API last told this browser (the start, verify and submit answers). The API has
 * no operation that reads a claim (OQ-49, OQ-209), so the web keeps this small record in a cookie
 * bound to the signed-in user. It holds no secret: ids, states, the masked address the API itself
 * returned, and the public certificate number the user typed.
 */
export interface ClaimRecord {
  id: string;
  /** The `ETag` of the claim as last seen, `"<lockVersion>"`, sent back as `If-Match`. */
  etag: string;
  status: ClaimStatus;
  method: 'EMAIL_OTP' | 'MANUAL';
  /** Exactly as the API returned it (already masked), or `null`: no address on record. */
  otpSentTo: string | null;
  siteName: string;
  certificateNo: string;
  createdAt: string;
  reviewedAt: string | null;
  decisionNotes: string | null;
}

/** The most claims kept in the cookie: a person holds at most three open ones (CLAIM_LIMITS). */
export const MAX_RECORDS = 5;

export interface ClaimJar {
  userId: string;
  claims: ClaimRecord[];
}

function str(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

/** A string, `null`, or `undefined` for anything else (so `null` can be a valid value). */
function nullableStr(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && value.length <= max ? value : undefined;
}

function readRecord(value: unknown): ClaimRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const etag = cleanEtag(v.etag);
  const siteName = str(v.siteName, 300);
  const certificateNo = str(v.certificateNo, 50);
  const createdAt = str(v.createdAt, 40);
  const status = STATUSES.find((candidate) => candidate === v.status);
  const method = v.method === 'EMAIL_OTP' || v.method === 'MANUAL' ? v.method : null;
  const otpSentTo = nullableStr(v.otpSentTo, 100);
  const reviewedAt = nullableStr(v.reviewedAt, 40);
  const decisionNotes = nullableStr(v.decisionNotes, 2000);
  if (
    !isUuid(v.id) ||
    etag === null ||
    siteName === null ||
    certificateNo === null ||
    createdAt === null ||
    status === undefined ||
    method === null ||
    otpSentTo === undefined ||
    reviewedAt === undefined ||
    decisionNotes === undefined
  )
    return null;
  return {
    id: v.id,
    etag,
    status,
    method,
    otpSentTo,
    siteName,
    certificateNo,
    createdAt,
    reviewedAt,
    decisionNotes,
  };
}

/**
 * The claims this browser remembers for `userId`. A cookie written for another user (a shared
 * browser), or one that cannot be read, gives none: a claim is never shown to anyone but the
 * person it was made for.
 */
export function readJar(raw: string | undefined, userId: string): ClaimJar {
  const empty: ClaimJar = { userId, claims: [] };
  if (raw === undefined) return empty;
  try {
    const parsed = JSON.parse(raw) as { u?: unknown; c?: unknown };
    if (parsed.u !== userId || !Array.isArray(parsed.c)) return empty;
    const claims = (parsed.c as unknown[])
      .map(readRecord)
      .filter((record): record is ClaimRecord => record !== null)
      .slice(0, MAX_RECORDS);
    return { userId, claims };
  } catch {
    return empty;
  }
}

export function writeJar(jar: ClaimJar): string {
  return JSON.stringify({ u: jar.userId, c: jar.claims });
}

/** Puts a record first (newest first), replacing the one with the same id, and keeps the cap. */
export function upsertClaim(jar: ClaimJar, record: ClaimRecord): ClaimJar {
  const others = jar.claims.filter((claim) => claim.id !== record.id);
  return { userId: jar.userId, claims: [record, ...others].slice(0, MAX_RECORDS) };
}

export function removeClaim(jar: ClaimJar, id: string): ClaimJar {
  return { userId: jar.userId, claims: jar.claims.filter((claim) => claim.id !== id) };
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
