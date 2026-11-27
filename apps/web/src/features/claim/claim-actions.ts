'use server';

import { randomUUID } from 'node:crypto';
import type { components } from '@labconnect/api-contract';
import { formatTime } from '@labconnect/ui';
import { redirect } from 'next/navigation';
import { actionGate } from '@/features/access/access';
import { isPlatformStaff } from '@/features/access/roles';
import { cleanEtag, formKey, isUuid, type Problem, readProblem } from '@/features/common/problem';
import { api } from '@/lib/api';
import { loadJar, saveJar } from './claim-jar';
import {
  type ClaimRecord,
  checkLetterhead,
  readCertificate,
  readClaimCode,
  removeClaim,
  type StartOutcome,
  startOutcome,
  submitOutcome,
  type UploadOutcome,
  uploadOutcome,
  upsertClaim,
  verifyOutcome,
} from './claim-model';

type LabClaim = components['schemas']['LabClaim'];

function retryAt(seconds: number | undefined): string | undefined {
  return seconds === undefined
    ? undefined
    : formatTime(new Date(Date.now() + seconds * 1000).toISOString());
}

function keyOf(form: FormData): string {
  return formKey(form.get('key'));
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function toRecord(claim: LabClaim, etag: string, certificateNo: string): ClaimRecord {
  return {
    id: claim.id,
    etag,
    status: claim.status,
    method: claim.method,
    otpSentTo: claim.otpSentTo,
    siteName: claim.labSite.name,
    certificateNo,
    createdAt: claim.createdAt,
    reviewedAt: claim.reviewedAt,
    decisionNotes: claim.decisionNotes,
  };
}

// ---- Start: the certificate number -----------------------------------------------------------

/** The "find your lab" form (board H4 step 1). */
export interface StartState {
  notice?: StartOutcome | 'invalid';
  /** For a code limit: when to try again, "10:58 AM IST". */
  retryAt?: string;
  /** What was typed, kept when something went wrong. */
  certificateNo: string;
  /** For `own-review`: the claim of this browser that is already in review. */
  ownClaimId?: string;
  key: string;
}

/**
 * `startLabClaim`: finds the lab by certificate number and sends a code to the address NABL has on
 * record (the API shows it masked; this screen shows it exactly as returned). The answer is saved
 * as a record of this browser and the page is left for the claim's own page, so a reload of it
 * never posts the form again.
 */
export async function startClaimAction(_previous: StartState, form: FormData): Promise<StartState> {
  const typed = field(form, 'certificateNo');
  const next = (state: Omit<StartState, 'key'>): StartState => ({ ...state, key: randomUUID() });
  const gate = await actionGate();
  if (!gate.ok) return next({ notice: 'signed-out', certificateNo: typed });
  if (isPlatformStaff(gate.user)) return next({ notice: 'staff', certificateNo: typed });
  const certificate = readCertificate(typed);
  if (!certificate.ok) return next({ notice: 'invalid', certificateNo: typed });

  const { data, response, error } = await api(gate.token).POST('/lab/claims', {
    params: { header: { 'Idempotency-Key': keyOf(form) } },
    body: { certificateNo: certificate.value },
  });
  const etag = cleanEtag(response.headers.get('etag'));
  if (data !== undefined && etag !== null) {
    const jar = await loadJar(gate.user.id);
    await saveJar(upsertClaim(jar, toRecord(data, etag, certificate.value)));
    redirect(`/lab/claim/${data.id}`);
  }
  if (data !== undefined) return next({ notice: 'failed', certificateNo: certificate.value });
  const problem = readProblem(response, error);
  const outcome = startOutcome(problem);
  const at = outcome === 'rate-limited' ? retryAt(problem.retryAfterSeconds) : undefined;
  const own =
    outcome === 'own-review'
      ? (await loadJar(gate.user.id)).claims.find(
          (claim) => claim.certificateNo === certificate.value,
        )
      : undefined;
  return next({
    notice: outcome,
    certificateNo: certificate.value,
    ...(at === undefined ? {} : { retryAt: at }),
    ...(own === undefined ? {} : { ownClaimId: own.id }),
  });
}

// ---- One claim: the code, a new code, reloading, the letterhead -------------------------------

/** The forms on a claim's page (board H4 steps 2 and 3). */
export interface ClaimState {
  notice?:
    | 'signed-out'
    | 'code-sent'
    | 'reloaded'
    | 'code-invalid'
    | 'code-expired'
    | 'locked'
    | 'rate-limited'
    | 'cap'
    | 'changed'
    | 'in-review'
    | 'expired'
    | 'not-open'
    | 'not-found'
    | 'scanning'
    | 'failed';
  retryAt?: string;
  key: string;
}

/** The record of this claim in this browser, for the signed-in user only; else `null`. */
async function ownRecord(userId: string, id: string): Promise<ClaimRecord | null> {
  if (!isUuid(id)) return null;
  return (await loadJar(userId)).claims.find((claim) => claim.id === id) ?? null;
}

/** Writes what a refused call taught us about the claim's state, then shows the claim again. */
async function learn(
  userId: string,
  record: ClaimRecord,
  status: ClaimRecord['status'] | null,
): Promise<void> {
  const jar = await loadJar(userId);
  await saveJar(
    status === null ? removeClaim(jar, record.id) : upsertClaim(jar, { ...record, status }),
  );
}

type Next = (notice: ClaimState['notice'], retry?: string) => ClaimState;

async function verify(
  userId: string,
  token: string,
  record: ClaimRecord,
  form: FormData,
  next: Next,
): Promise<ClaimState> {
  const code = readClaimCode(field(form, 'code'));
  if (code === null) return next('code-invalid');
  // The version of the claim as the page loaded it (a hidden field); only a strong ETag goes on.
  const etag = cleanEtag(field(form, 'etag'));
  if (etag === null) return next('changed');
  const { data, response, error } = await api(token).POST('/lab/claims/{id}/verify-otp', {
    params: {
      path: { id: record.id },
      header: { 'Idempotency-Key': keyOf(form), 'If-Match': etag },
    },
    body: { code },
  });
  const fresh = cleanEtag(response.headers.get('etag'));
  if (data !== undefined && fresh !== null) {
    const jar = await loadJar(userId);
    await saveJar(upsertClaim(jar, toRecord(data, fresh, record.certificateNo)));
    redirect(`/lab/claim/${record.id}`);
  }
  if (data !== undefined) return next('failed');
  const problem = readProblem(response, error);
  const outcome = verifyOutcome(problem);
  if (outcome === 'in-review') await learn(userId, record, 'PENDING_REVIEW');
  if (outcome === 'expired') await learn(userId, record, 'EXPIRED');
  if (outcome === 'not-found') await learn(userId, record, null);
  if (outcome === 'locked' || outcome === 'rate-limited')
    return next(outcome, retryAt(problem.retryAfterSeconds));
  if (outcome === 'signed-out') return next('signed-out');
  return next(outcome === 'not-open' ? 'not-open' : outcome);
}

/**
 * A new code, or "reload the claim": the API can only be asked about a claim by starting it again
 * with its certificate number (it has no read operation), which sends a new code for the caller's
 * own open claim and returns it with its current version. Used for "Send a new code" and after a
 * 412 (the claim changed since the page was loaded).
 */
async function restart(
  userId: string,
  token: string,
  record: ClaimRecord,
  form: FormData,
  next: Next,
  after: 'code-sent' | 'reloaded',
): Promise<ClaimState> {
  const { data, response, error } = await api(token).POST('/lab/claims', {
    params: { header: { 'Idempotency-Key': keyOf(form) } },
    body: { certificateNo: record.certificateNo },
  });
  const etag = cleanEtag(response.headers.get('etag'));
  if (data !== undefined && etag !== null) {
    const jar = await loadJar(userId);
    await saveJar(upsertClaim(jar, toRecord(data, etag, record.certificateNo)));
    // 201: the old claim had expired and this is a new one with its own page.
    if (data.id !== record.id) redirect(`/lab/claim/${data.id}`);
    return next(after);
  }
  if (data !== undefined) return next('failed');
  const problem: Problem = readProblem(response, error);
  const outcome = startOutcome(problem);
  if (outcome === 'own-review') {
    await learn(userId, record, 'PENDING_REVIEW');
    return next('in-review');
  }
  if (outcome === 'claimed') {
    await learn(userId, record, null);
    return next('not-open');
  }
  if (outcome === 'rate-limited') return next('rate-limited', retryAt(problem.retryAfterSeconds));
  if (outcome === 'cap') return next('cap');
  if (outcome === 'signed-out') return next('signed-out');
  return next('failed');
}

async function submitLetter(
  userId: string,
  token: string,
  record: ClaimRecord,
  form: FormData,
  next: Next,
): Promise<ClaimState> {
  const fileId = field(form, 'fileId');
  const etag = cleanEtag(field(form, 'etag'));
  if (!isUuid(fileId)) return next('failed');
  if (etag === null) return next('changed');
  const { data, response, error } = await api(token).POST('/lab/claims/{id}/manual', {
    params: {
      path: { id: record.id },
      header: { 'Idempotency-Key': keyOf(form), 'If-Match': etag },
    },
    body: { fileId },
  });
  const fresh = cleanEtag(response.headers.get('etag'));
  if (data !== undefined && fresh !== null) {
    const jar = await loadJar(userId);
    await saveJar(upsertClaim(jar, toRecord(data, fresh, record.certificateNo)));
    redirect(`/lab/claim/${record.id}`);
  }
  if (data !== undefined) return next('failed');
  const outcome = submitOutcome(readProblem(response, error));
  if (outcome === 'in-review') await learn(userId, record, 'PENDING_REVIEW');
  if (outcome === 'expired') await learn(userId, record, 'EXPIRED');
  if (outcome === 'not-found') await learn(userId, record, null);
  return next(outcome);
}

/**
 * The forms of a claim's page, one server action; `intent` is `verify`, `resend`, `reload` or
 * `submit`. The claim is the one this browser remembers for the signed-in user, looked up by the
 * id in the form; any other id is "not found" here, and the API answers 404 for it as well.
 */
export async function claimAction(_previous: ClaimState, form: FormData): Promise<ClaimState> {
  const next: Next = (notice, retry) => ({
    ...(notice === undefined ? {} : { notice }),
    ...(retry === undefined ? {} : { retryAt: retry }),
    key: randomUUID(),
  });
  const gate = await actionGate();
  if (!gate.ok) return next('signed-out');
  const record = await ownRecord(gate.user.id, field(form, 'claimId'));
  if (record === null) return next('not-found');
  switch (field(form, 'intent')) {
    case 'verify':
      return verify(gate.user.id, gate.token, record, form, next);
    case 'resend':
      return restart(gate.user.id, gate.token, record, form, next, 'code-sent');
    case 'reload':
      return restart(gate.user.id, gate.token, record, form, next, 'reloaded');
    case 'submit':
      return submitLetter(gate.user.id, gate.token, record, form, next);
    default:
      return next(undefined);
  }
}

// ---- The letterhead upload URL (called by the browser, which then sends the file) --------------

export type UploadRequest = { claimId: string; contentType: string; sizeBytes: number };
export type UploadTicket =
  | { ok: true; fileId: string; uploadUrl: string; headers: Record<string, string> }
  | { ok: false; reason: UploadOutcome | 'type' | 'size' | 'empty' };

/**
 * Asks the API for a pre-signed upload URL for a letterhead. The type and size are checked here
 * first (the API checks them again and the URL's signature pins both), so a 50 MB file or an
 * unlisted type never gets a URL from this server. The file itself goes from the browser straight
 * to storage (FILES_AND_REPORTS §1: "files never pass through the app servers"), so this server
 * never sees it and cannot look inside; the scan and validation behind the URL do.
 * The URL is returned to the caller only: never logged, stored or put in a cookie or address.
 */
export async function requestLetterheadUploadAction(request: UploadRequest): Promise<UploadTicket> {
  const gate = await actionGate();
  if (!gate.ok) return { ok: false, reason: 'signed-out' };
  const record = await ownRecord(gate.user.id, request.claimId);
  if (record === null) return { ok: false, reason: 'not-found' };
  const checked = checkLetterhead({
    contentType: request.contentType,
    sizeBytes: request.sizeBytes,
  });
  if (!checked.ok) return { ok: false, reason: checked.reason };
  const { data, response, error } = await api(gate.token).POST(
    '/lab/claims/{id}/manual/upload-url',
    {
      params: { path: { id: record.id }, header: { 'Idempotency-Key': randomUUID() } },
      body: { contentType: checked.contentType, sizeBytes: checked.sizeBytes },
    },
  );
  if (data !== undefined) {
    return {
      ok: true,
      fileId: data.fileId,
      uploadUrl: data.uploadUrl,
      headers: Object.fromEntries(
        Object.entries(data.headers).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
    };
  }
  const outcome = uploadOutcome(readProblem(response, error));
  if (outcome === 'in-review') await learn(gate.user.id, record, 'PENDING_REVIEW');
  if (outcome === 'expired') await learn(gate.user.id, record, 'EXPIRED');
  return { ok: false, reason: outcome };
}
