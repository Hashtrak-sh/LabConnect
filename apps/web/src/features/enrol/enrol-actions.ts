'use server';

import { randomUUID } from 'node:crypto';
import { formatTime } from '@labconnect/ui';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { formKey, readProblem } from '@/features/common/problem';
import { api } from '@/lib/api';
import { MFA_COOKIE } from '@/lib/session';
import { type QrCode, qrPath, readCode, readEnrolment } from './otpauth';

/**
 * Where the enrolment is (board G2), and what to tell the user. This object is the only place the
 * secret, the QR code and the recovery codes live: it is held by the page for as long as the page
 * is shown, never stored in a cookie, a session, a URL, a log or the server's memory.
 */
export interface EnrolState {
  step: 'why' | 'scan' | 'codes';
  notice?:
    | 'failed'
    | 'already-enrolled'
    | 'no-pending'
    | 'code-invalid'
    | 'locked'
    | 'rate-limited'
    | 'save-first';
  /** For locked and rate-limited: when to try again, "10:58 AM IST". */
  retryAt?: string;
  /** Scan step: the setup key in groups of four, and the QR code. */
  groupedSecret?: string;
  qr?: QrCode;
  /** Codes step: the ten recovery codes, shown once. */
  recoveryCodes?: string[];
  /** The idempotency key of the next submit, made here so a double submit is one operation. */
  key: string;
}

function retryAt(seconds: number | undefined): string | undefined {
  return seconds === undefined
    ? undefined
    : formatTime(new Date(Date.now() + seconds * 1000).toISOString());
}

/** Ends the partial session and sends the user to sign in. Never returns. */
async function backToSignIn(): Promise<never> {
  (await cookies()).delete(MFA_COOKIE);
  redirect('/sign-in');
}

function withKey(state: Omit<EnrolState, 'key'>): EnrolState {
  return { ...state, key: randomUUID() };
}

function submittedKey(form: FormData): string {
  return formKey(form.get('key'));
}

/**
 * Step "Scan": asks the API for a new pending factor. This runs only when the user presses the
 * button, never when the page is opened or reloaded: `startMfaEnrolment` revokes the earlier
 * pending factor and makes a new secret, so a call on reload would silently invalidate the key
 * the user had just scanned.
 */
async function start(key: string): Promise<EnrolState> {
  const partial = (await cookies()).get(MFA_COOKIE)?.value;
  if (partial === undefined) return backToSignIn();
  const { data, response, error } = await api(partial).POST('/auth/mfa/enrol', {
    params: { header: { 'Idempotency-Key': key } },
  });
  if (data !== undefined) {
    const enrolment = readEnrolment(data.secret, data.otpauthUri);
    if (enrolment === null) return withKey({ step: 'why', notice: 'failed' });
    return withKey({
      step: 'scan',
      groupedSecret: enrolment.groupedSecret,
      qr: qrPath(enrolment.uri),
    });
  }
  const problem = readProblem(response, error);
  if (problem.status === 401) return backToSignIn();
  if (problem.status === 409 && problem.code === 'INVALID_STATE_TRANSITION')
    return withKey({ step: 'why', notice: 'already-enrolled' });
  if (problem.status === 429) {
    const at = retryAt(problem.retryAfterSeconds);
    return withKey({
      step: 'why',
      notice: 'rate-limited',
      ...(at === undefined ? {} : { retryAt: at }),
    });
  }
  return withKey({ step: 'why', notice: 'failed' });
}

/**
 * Step "Confirm": the first code from the app activates the factor and returns the recovery codes
 * (shown once). A wrong code keeps the scan step as it was: the user still needs the same key.
 */
async function confirm(previous: EnrolState, form: FormData, key: string): Promise<EnrolState> {
  const partial = (await cookies()).get(MFA_COOKIE)?.value;
  if (partial === undefined) return backToSignIn();
  const keep = {
    step: 'scan' as const,
    ...(previous.groupedSecret === undefined ? {} : { groupedSecret: previous.groupedSecret }),
    ...(previous.qr === undefined ? {} : { qr: previous.qr }),
  };
  const code = readCode(form.get('code'));
  if (code === null) return withKey({ ...keep, notice: 'code-invalid' });
  const { data, response, error } = await api(partial).POST('/auth/mfa/enrol/confirm', {
    params: { header: { 'Idempotency-Key': key } },
    body: { code },
  });
  if (data !== undefined) return withKey({ step: 'codes', recoveryCodes: [...data.recoveryCodes] });
  const problem = readProblem(response, error);
  if (problem.status === 401) return backToSignIn();
  // A reload of the page that showed the recovery codes posts the same code again: the factor is
  // active and there is no pending one, so the codes are not shown a second time.
  if (problem.status === 404) return withKey({ step: 'why', notice: 'no-pending' });
  if (problem.status === 429 && problem.code === 'OTP_LOCKED') {
    const at = retryAt(problem.retryAfterSeconds);
    return withKey({ ...keep, notice: 'locked', ...(at === undefined ? {} : { retryAt: at }) });
  }
  if (problem.status === 429) {
    const at = retryAt(problem.retryAfterSeconds);
    return withKey({
      ...keep,
      notice: 'rate-limited',
      ...(at === undefined ? {} : { retryAt: at }),
    });
  }
  if (problem.status === 422 || problem.status === 400)
    return withKey({ ...keep, notice: 'code-invalid' });
  return withKey({ ...keep, notice: 'failed' });
}

/**
 * Step "Recovery codes": the user confirms they saved the codes, then leaves for sign-in. The
 * API gives no session after enrolment, so the partial session is dropped and the person signs
 * in again and passes the authenticator step.
 */
async function finish(previous: EnrolState, form: FormData): Promise<EnrolState> {
  if (form.get('saved') !== 'on')
    return withKey({ ...previous, step: 'codes', notice: 'save-first' });
  return backToSignIn();
}

/** The enrolment steps of board G2, one server action; `intent` says which button was pressed. */
export async function enrolAction(previous: EnrolState, form: FormData): Promise<EnrolState> {
  const intent = form.get('intent');
  const key = submittedKey(form);
  switch (intent) {
    case 'start':
      return start(key);
    case 'confirm':
      return confirm(previous, form, key);
    case 'finish':
      return finish(previous, form);
    default:
      return previous;
  }
}
