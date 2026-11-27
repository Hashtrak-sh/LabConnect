/**
 * The web session (AUTHENTICATION_AND_AUTHORISATION §1 and §2, API_CONVENTIONS §4: "web uses an
 * httpOnly cookie, the BFF adds the header"). The browser only ever talks to this Next.js server,
 * so the server keeps the two API tokens in its own cookies:
 *
 * - `lc_access`: the 10-minute access JWT, sent to the API as `Authorization: Bearer`.
 * - `lc_web_refresh`: the API's rotating refresh token (the API sets it as `lc_refresh` on its own
 *   domain; we receive it server-to-server and keep it on ours).
 * - `lc_mfa`: a partial session between the code and the authenticator step (G1 step 3).
 * - `lc_return`: the page to come back to after sign-in (G1: "kept in the session, never in the
 *   address").
 *
 * All are HttpOnly, SameSite=Lax, Secure outside development, so no script can read a token.
 * Nothing here logs a token (CLAUDE.md §5).
 */

export const ACCESS_COOKIE = 'lc_access';
export const REFRESH_COOKIE = 'lc_web_refresh';
export const MFA_COOKIE = 'lc_mfa';
export const RETURN_COOKIE = 'lc_return';

/** The API's refresh cookie name (apps/api identity/refresh-cookie.ts). */
const API_REFRESH_COOKIE = 'lc_refresh';

export interface CookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
}

export function cookieOptions(maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(),
    path: '/',
    maxAge: Math.max(0, Math.floor(maxAgeSeconds)),
  };
}

/** When the access token expires (epoch seconds), read from its payload without verifying it. */
export function accessTokenExpiry(token: string): number | null {
  const payload = token.split('.')[1];
  if (payload === undefined) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof claims.exp === 'number' ? claims.exp : null;
  } catch {
    return null;
  }
}

/** Whether an access token is missing, unreadable or expires within `marginSeconds`. */
export function needsRefresh(
  token: string | undefined,
  nowMs: number,
  marginSeconds = 60,
): boolean {
  if (token === undefined || token === '') return true;
  const exp = accessTokenExpiry(token);
  return exp === null || exp * 1000 - nowMs < marginSeconds * 1000;
}

export interface RefreshCookie {
  value: string;
  maxAge: number;
}

/**
 * The API's refresh token from its `Set-Cookie` headers, with its `Max-Age`. `null` when the
 * response did not set one, or cleared it.
 */
export function readApiRefreshCookie(setCookies: readonly string[]): RefreshCookie | null {
  for (const header of setCookies) {
    const [pair = '', ...attributes] = header.split(';');
    const separator = pair.indexOf('=');
    if (separator === -1 || pair.slice(0, separator).trim() !== API_REFRESH_COOKIE) continue;
    const value = pair.slice(separator + 1).trim();
    const maxAgeAttribute = attributes.find((attribute) => /^\s*max-age=/i.test(attribute));
    const maxAge =
      maxAgeAttribute === undefined ? 12 * 3600 : Number(maxAgeAttribute.split('=')[1]);
    if (value === '' || !Number.isFinite(maxAge) || maxAge <= 0) return null;
    return { value, maxAge };
  }
  return null;
}

/** The `Cookie` header that presents our stored refresh token to the API's `/auth/refresh`. */
export function apiRefreshCookieHeader(value: string): string {
  return `${API_REFRESH_COOKIE}=${value}`;
}

/**
 * A safe page to return to after sign-in: a same-site path, not an auth page. Anything else
 * (another origin, `//evil`, the sign-in page itself) gives `/`.
 */
export function safeReturnPath(candidate: string | undefined | null): string {
  if (candidate === undefined || candidate === null) return '/';
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return '/';
  // Browsers drop tabs and newlines from a URL and read `\` as `/`, so `/\t/evil` or `/\evil`
  // could become `//evil`. Any backslash or control character anywhere is refused.
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (/[\\\u0000-\u001f\u007f]/.test(candidate)) return '/';
  if (candidate.startsWith('/sign-in') || candidate.startsWith('/api/')) return '/';
  return candidate.slice(0, 500);
}

/** The origin the API checks on `/auth/refresh` (AUTH_ALLOWED_ORIGINS). */
export function webOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.WEB_BASE_URL?.trim();
  if (configured !== undefined && configured !== '') return configured.replace(/\/+$/, '');
  // A deployed build without it would send the wrong Origin, and the API would refuse every
  // refresh: users would be signed out after ten minutes with nothing pointing at the cause.
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'WEB_BASE_URL is not set. Set it to the public origin of the web app, e.g. https://uat.example.in.',
    );
  }
  return 'http://localhost:3000';
}

/**
 * Whether cookies are `Secure`: when the public site is HTTPS (`WEB_BASE_URL`). Not from
 * `NODE_ENV`: a production build served over plain HTTP (a first UAT without a domain, or
 * `next start` on localhost) would set cookies the browser drops, and nobody could sign in.
 */
export function secureCookies(origin: string = webOrigin()): boolean {
  return origin.startsWith('https://');
}
