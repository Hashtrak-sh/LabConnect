'use server';

import { randomUUID } from 'node:crypto';
import { formatTime } from '@labconnect/ui';
import { redirect } from 'next/navigation';
import { actionGate } from '@/features/access/access';
import { isPlatformStaff } from '@/features/access/roles';
import { cleanEtag, formKey, isUuid, readProblem } from '@/features/common/problem';
import { api } from '@/lib/api';
import { loadMyClaim } from './claim-data';
import {
  checkLetterhead,
  readCertificate,
  readClaimCode,
  type ReloadNotice,
  reloadFor,
  type StartOutcome,
  startOutcome,
  submitOutcome,
  type UploadOutcome,
  uploadOutcome,
  verifyOutcome,
} from './claim-model';
import { dropLegacyClaimsCookie } from './legacy-cookie';

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

/**
 * Leaves the form for the claim's own page, which reads the claim from the API again. `notice`
 * says why (`changed`: the version moved since the page was loaded; `moved`: the claim is in
 * another state than the form was for). The page shows the state as it is now. Nothing personal
 * is in the address.
 */
function showClaim(id: string, notice: ReloadNotice | null): never {
  redirect(notice === null ? `/lab/claim/${id}` : `/lab/claim/${id}?n=${notice}`);
}

// ---- Start: the certificate number -----------------------------------------------------------

/** The "find your lab" form (board H4 step 1). */
export interface StartState {
  notice?: StartOutcome | 'invalid';
  /** For a code limit: when to try again, "10:58 AM IST". */
  retryAt?: string;
  /** What was typed, kept when something went wrong. */
  certificateNo: string;
  key: string;
}

/**
 * `startLabClaim`: finds the lab by certificate number and sends a code to the address NABL has on
 * record (the API shows it masked; this screen shows it exactly as returned). On success the page
 * is left for the claim's own page, so a reload of it never posts the form again. Nothing is
 * remembered in the browser: the claim list comes from the API.
 */
export async function startClaimAction(_previous: StartState, form: FormData): Promise<StartState> {
  const typed = field(form, 'certificateNo');
  const next = (state: Omit<StartState, 'key'>): StartState => ({ ...state, key: randomUUID() });
  const gate = await actionGate();
  if (!gate.ok) return next({ notice: 'signed-out', certificateNo: typed });
  await dropLegacyClaimsCookie();
  if (isPlatformStaff(gate.user)) return next({ notice: 'staff', certificateNo: typed });
  const certificate = readCertificate(typed);
  if (!certificate.ok) return next({ notice: 'invalid', certificateNo: typed });

  const { data, response, error } = await api(gate.token).POST('/lab/claims', {
    params: { header: { 'Idempotency-Key': keyOf(form) } },
    body: { certificateNo: certificate.value },
  });
  if (data !== undefined) showClaim(data.id, null);
  const problem = readProblem(response, error);
  const outcome = startOutcome(problem);
  const at = outcome === 'rate-limited' ? retryAt(problem.retryAfterSeconds) : undefined;
  return next({
    notice: outcome,
    certificateNo: certificate.value,
    ...(at === undefined ? {} : { retryAt: at }),
  });
}

// ---- One claim: the code, a new code, the letterhead -----------------------------------------

/** The forms on a claim's page (board H4 steps 2 and 3). */
export interface ClaimState {
  notice?:
    | 'signed-out'
    | 'code-sent'
    | 'code-invalid'
    | 'code-expired'
    | 'locked'
    | 'rate-limited'
    | 'cap'
    | 'cert-invalid'
    | 'cert-not-found'
    | 'not-found'
    | 'scanning'
    | 'failed';
  retryAt?: string;
  /**
   * The version of the claim as the API gave it with the last answer, so the next form of the
   * page goes back with the version that is true now (a wrong code does not change the claim, a
   * new code does).
   */
  etag?: string;
  key: string;
}

type Next = (notice: ClaimState['notice'], retry?: string, etag?: string | null) => ClaimState;

/**
 * The version of the claim as the API has it now, for the form to carry on with; `undefined`
 * when it cannot be read (the form then keeps the one it had and a 412 would say so).
 */
async function freshEtag(token: string, id: string): Promise<string | undefined> {
  const read = await loadMyClaim(token, id);
  return read.kind === 'ok' && read.etag !== null ? read.etag : undefined;
}

async function verify(
  token: string,
  claimId: string,
  form: FormData,
  next: Next,
): Promise<ClaimState> {
  const code = readClaimCode(field(form, 'code'));
  if (code === null) return next('code-invalid');
  // The version of the claim as the page read it (a hidden field); only a strong ETag goes on.
  const etag = cleanEtag(field(form, 'etag'));
  if (etag === null) return showClaim(claimId, 'changed');
  const { data, response, error } = await api(token).POST('/lab/claims/{id}/verify-otp', {
    params: {
      path: { id: claimId },
      header: { 'Idempotency-Key': keyOf(form), 'If-Match': etag },
    },
    body: { code },
  });
  if (data !== undefined) return showClaim(claimId, null);
  const problem = readProblem(response, error);
  const outcome = verifyOutcome(problem);
  const reload = reloadFor(outcome);
  if (reload !== null) return showClaim(claimId, reload);
  if (outcome === 'locked' || outcome === 'rate-limited')
    return next(outcome, retryAt(problem.retryAfterSeconds));
  if (outcome === 'code-invalid' || outcome === 'code-expired')
    return next(outcome, undefined, await freshEtag(token, claimId));
  return next(outcome === 'signed-out' ? 'signed-out' : 'failed');
}

/**
 * A new code. The claim does not say which certificate it was started with (OQ-259), so the
 * person types it again and the claim is started again by it: for their own open claim that sends
 * a new code and returns the same claim; for a certificate of another lab it starts that claim
 * and the page goes there. Nothing is read from the browser.
 */
async function resend(
  token: string,
  claimId: string,
  form: FormData,
  next: Next,
): Promise<ClaimState> {
  const certificate = readCertificate(field(form, 'certificateNo'));
  if (!certificate.ok) return next('cert-invalid');
  const { data, response, error } = await api(token).POST('/lab/claims', {
    params: { header: { 'Idempotency-Key': keyOf(form) } },
    body: { certificateNo: certificate.value },
  });
  if (data !== undefined) {
    // 201: another claim (the old one had expired, or another lab); it has its own page.
    if (data.id !== claimId) return showClaim(data.id, null);
    return next('code-sent', undefined, cleanEtag(response.headers.get('etag')));
  }
  const problem = readProblem(response, error);
  const outcome = startOutcome(problem);
  const reload = reloadFor(outcome);
  if (reload !== null) return showClaim(claimId, reload);
  if (outcome === 'not-found') return next('cert-not-found');
  if (outcome === 'rate-limited') return next('rate-limited', retryAt(problem.retryAfterSeconds));
  if (outcome === 'cap') return next('cap');
  if (outcome === 'signed-out') return next('signed-out');
  return next('failed');
}

async function submitLetter(
  token: string,
  claimId: string,
  form: FormData,
  next: Next,
): Promise<ClaimState> {
  const fileId = field(form, 'fileId');
  const etag = cleanEtag(field(form, 'etag'));
  if (!isUuid(fileId)) return next('failed');
  if (etag === null) return showClaim(claimId, 'changed');
  const { data, response, error } = await api(token).POST('/lab/claims/{id}/manual', {
    params: {
      path: { id: claimId },
      header: { 'Idempotency-Key': keyOf(form), 'If-Match': etag },
    },
    body: { fileId },
  });
  if (data !== undefined) return showClaim(claimId, null);
  const outcome = submitOutcome(readProblem(response, error));
  const reload = reloadFor(outcome);
  if (reload !== null) return showClaim(claimId, reload);
  return next(
    outcome === 'scanning' ? 'scanning' : outcome === 'signed-out' ? 'signed-out' : 'failed',
  );
}

/**
 * The forms of a claim's page, one server action; `intent` is `verify`, `resend` or `submit`.
 * The claim id comes from the form and is only ever passed on as a path to the API, which answers
 * 404 for a claim that is not the caller's (the same answer as for one that does not exist). A
 * `412` or `409` is never patched up here: the page is shown again from a fresh read.
 */
export async function claimAction(_previous: ClaimState, form: FormData): Promise<ClaimState> {
  const next: Next = (notice, retry, etag) => ({
    ...(notice === undefined ? {} : { notice }),
    ...(retry === undefined ? {} : { retryAt: retry }),
    ...(etag === undefined || etag === null ? {} : { etag }),
    key: randomUUID(),
  });
  const gate = await actionGate();
  if (!gate.ok) return next('signed-out');
  await dropLegacyClaimsCookie();
  const claimId = field(form, 'claimId');
  if (!isUuid(claimId)) return next('not-found');
  switch (field(form, 'intent')) {
    case 'verify':
      return verify(gate.token, claimId, form, next);
    case 'resend':
      return resend(gate.token, claimId, form, next);
    case 'submit':
      return submitLetter(gate.token, claimId, form, next);
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
 * A claim that is not the caller's is a 404 from the API, shown as "not open any more".
 */
export async function requestLetterheadUploadAction(request: UploadRequest): Promise<UploadTicket> {
  const gate = await actionGate();
  if (!gate.ok) return { ok: false, reason: 'signed-out' };
  if (!isUuid(request.claimId)) return { ok: false, reason: 'not-found' };
  const checked = checkLetterhead({
    contentType: request.contentType,
    sizeBytes: request.sizeBytes,
  });
  if (!checked.ok) return { ok: false, reason: checked.reason };
  const { data, response, error } = await api(gate.token).POST(
    '/lab/claims/{id}/manual/upload-url',
    {
      params: { path: { id: request.claimId }, header: { 'Idempotency-Key': randomUUID() } },
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
  return { ok: false, reason: uploadOutcome(readProblem(response, error)) };
}
