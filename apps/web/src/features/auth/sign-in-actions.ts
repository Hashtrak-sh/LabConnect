'use server';

import { randomUUID } from 'node:crypto';
import { cookies, headers as nextHeaders } from 'next/headers';
import { redirect } from 'next/navigation';
import { formatTime } from '@labconnect/ui';
import { apiBaseUrl } from '@/lib/api';
import {
  ACCESS_COOKIE,
  apiRefreshCookieHeader,
  cookieOptions,
  MFA_COOKIE,
  readApiRefreshCookie,
  REFRESH_COOKIE,
  RETURN_COOKIE,
  safeReturnPath,
} from '@/lib/session';

/** Where the sign-in flow is (board G1), and what to tell the user. */
export interface SignInState {
  step: 'email' | 'code' | 'mfa' | 'enrol';
  email: string;
  notice?:
    | 'email-invalid'
    | 'code-sent'
    | 'code-invalid'
    | 'code-expired'
    | 'locked'
    | 'rate-limited'
    | 'mfa-invalid'
    | 'mfa-locked'
    | 'failed';
  /** For locked and rate-limited: when to try again, "10:58 AM IST". */
  retryAt?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE = /^\d{6}$/;

interface Problem {
  code?: string;
}

interface SessionBody {
  mfaRequired: boolean;
  mfaEnrolled?: boolean;
  accessToken: string;
  expiresIn: number;
}

/**
 * The visitor's address for the API's per-address limits on codes (OQ-89). Behind the reverse
 * proxy (deploy/ec2: Caddy, which replaces any `X-Forwarded-For` a browser sends) the last entry
 * is the visitor. The API trusts it only when `API_TRUST_PROXY_HOPS` says this server is a proxy;
 * locally there is no such header and nothing is sent.
 */
async function visitorAddress(): Promise<Record<string, string>> {
  const forwarded = (await nextHeaders()).get('x-forwarded-for');
  const last = forwarded?.split(',').at(-1)?.trim();
  return last === undefined || last === '' ? {} : { 'X-Forwarded-For': last };
}

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
      ...(await visitorAddress()),
      ...headers,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

async function problemCode(response: Response): Promise<string | undefined> {
  try {
    return ((await response.json()) as Problem).code;
  } catch {
    return undefined;
  }
}

function retryAt(response: Response): string | undefined {
  const seconds = Number(response.headers.get('retry-after'));
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return formatTime(new Date(Date.now() + seconds * 1000).toISOString());
}

/** Stores a full session and returns to the page the user came from. Never returns. */
async function startSession(response: Response, body: SessionBody): Promise<never> {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, body.accessToken, cookieOptions(body.expiresIn));
  const refresh = readApiRefreshCookie(response.headers.getSetCookie());
  if (refresh !== null) jar.set(REFRESH_COOKIE, refresh.value, cookieOptions(refresh.maxAge));
  jar.delete(MFA_COOKIE);
  const back = safeReturnPath(jar.get(RETURN_COOKIE)?.value);
  jar.delete(RETURN_COOKIE);
  redirect(back);
}

async function sendCode(email: string): Promise<SignInState> {
  if (!EMAIL.test(email) || email.length > 254)
    return { step: 'email', email, notice: 'email-invalid' };
  const response = await post('/auth/otp/request', { email, purpose: 'LOGIN' });
  if (response.status === 202) return { step: 'code', email, notice: 'code-sent' };
  if (response.status === 429) {
    const at = retryAt(response);
    return {
      step: 'email',
      email,
      notice: 'rate-limited',
      ...(at === undefined ? {} : { retryAt: at }),
    };
  }
  if (response.status === 422) return { step: 'email', email, notice: 'email-invalid' };
  return { step: 'email', email, notice: 'failed' };
}

async function verifyCode(email: string, code: string): Promise<SignInState> {
  if (!CODE.test(code)) return { step: 'code', email, notice: 'code-invalid' };
  const response = await post('/auth/otp/verify', { email, code });
  if (response.status === 200) {
    const body = (await response.json()) as SessionBody;
    if (!body.mfaRequired) return startSession(response, body);
    (await cookies()).set(MFA_COOKIE, body.accessToken, cookieOptions(body.expiresIn));
    return { step: body.mfaEnrolled === false ? 'enrol' : 'mfa', email };
  }
  const problem = await problemCode(response);
  if (problem === 'OTP_EXPIRED') return { step: 'code', email, notice: 'code-expired' };
  if (problem === 'OTP_LOCKED') {
    const at = retryAt(response);
    return { step: 'code', email, notice: 'locked', ...(at === undefined ? {} : { retryAt: at }) };
  }
  if (response.status === 429) {
    const at = retryAt(response);
    return {
      step: 'code',
      email,
      notice: 'rate-limited',
      ...(at === undefined ? {} : { retryAt: at }),
    };
  }
  if (response.status === 422) return { step: 'code', email, notice: 'code-invalid' };
  return { step: 'code', email, notice: 'failed' };
}

async function verifyMfa(email: string, code: string): Promise<SignInState> {
  const partial = (await cookies()).get(MFA_COOKIE)?.value;
  if (partial === undefined) return { step: 'email', email, notice: 'code-expired' };
  if (!CODE.test(code)) return { step: 'mfa', email, notice: 'mfa-invalid' };
  const response = await post('/auth/mfa/verify', { code }, { Authorization: `Bearer ${partial}` });
  if (response.status === 200)
    return startSession(response, (await response.json()) as SessionBody);
  if (response.status === 401) {
    (await cookies()).delete(MFA_COOKIE);
    return { step: 'email', email, notice: 'code-expired' };
  }
  if (response.status === 429) {
    const at = retryAt(response);
    return {
      step: 'mfa',
      email,
      notice: 'mfa-locked',
      ...(at === undefined ? {} : { retryAt: at }),
    };
  }
  if (response.status === 422) return { step: 'mfa', email, notice: 'mfa-invalid' };
  return { step: 'mfa', email, notice: 'failed' };
}

/**
 * The sign-in steps of board G1, one server action. `intent` says which button was pressed:
 * `send` (email step), `resend` (a new code), `verify` (the emailed code), `mfa` (the
 * authenticator code) or `restart` (use another email).
 */
export async function signInAction(previous: SignInState, form: FormData): Promise<SignInState> {
  const field = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };
  const intent = field('intent');
  const email = field('email') || previous.email;
  switch (intent) {
    case 'send':
      // Sign-up starts with the same code steps and carries on at /sign-up (board J1).
      if (field('next') === '/sign-up') {
        (await cookies()).set(RETURN_COOKIE, '/sign-up', cookieOptions(30 * 60));
      }
      return sendCode(email);
    case 'resend':
      return sendCode(email);
    case 'verify':
      return verifyCode(email, field('code').replaceAll(/\s/g, ''));
    case 'mfa':
      return verifyMfa(email, field('code').replaceAll(/\s/g, ''));
    case 'restart':
      (await cookies()).delete(MFA_COOKIE);
      return { step: 'email', email: '' };
    default:
      return previous;
  }
}

/** Sign out (G1 header): revoke the session at the API, then forget both tokens. */
export async function signOutAction(): Promise<never> {
  const jar = await cookies();
  const access = jar.get(ACCESS_COOKIE)?.value;
  const refresh = jar.get(REFRESH_COOKIE)?.value;
  if (access !== undefined) {
    await post(
      '/auth/logout',
      {},
      {
        Authorization: `Bearer ${access}`,
        ...(refresh === undefined ? {} : { Cookie: apiRefreshCookieHeader(refresh) }),
      },
    ).catch(() => undefined);
  }
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  jar.delete(MFA_COOKIE);
  redirect('/');
}
