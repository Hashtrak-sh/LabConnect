import { type NextRequest, NextResponse } from 'next/server';
import { apiBaseUrl } from '@/lib/api';
import { createRefresher } from '@/lib/refresh';
import {
  ACCESS_COOKIE,
  apiRefreshCookieHeader,
  cookieOptions,
  needsRefresh,
  REFRESH_COOKIE,
  RETURN_COOKIE,
  safeReturnPath,
  webOrigin,
} from '@/lib/session';

/** A one-minute flag that the session just ended, so the page can say so (board G3). */
export const SESSION_ENDED_COOKIE = 'lc_session_ended';

/** One refresh per refresh token at a time, for this server process (lib/refresh.ts, OQ-91). */
const refreshSession = createRefresher({
  call: (refreshToken) =>
    fetch(`${apiBaseUrl()}/auth/refresh`, {
      method: 'POST',
      headers: {
        Cookie: apiRefreshCookieHeader(refreshToken),
        Origin: webOrigin(),
        'Idempotency-Key': crypto.randomUUID(),
      },
      cache: 'no-store',
    }),
});

let refusedLogged = false;

/**
 * Runs before every page (Next.js 16 "proxy", formerly middleware):
 *
 * 1. Keeps the session alive: when the access token is missing or about to expire and a refresh
 *    token is stored, rotate it with `POST /auth/refresh` (the refresh cookie and the `Origin` the
 *    API checks), and hand the new access token to this request so the page renders signed in.
 *    Requests that arrive together share one refresh (`createRefresher`): a second refresh with
 *    the same token would make the API revoke the session. A spent token (401) ends the session:
 *    both cookies are cleared and G3's "Your session has ended" is shown once. A 403 is a
 *    configuration fault (WEB_BASE_URL not in AUTH_ALLOWED_ORIGINS): logged once, and the session
 *    is cleared too, or every page would try again. If the API cannot be reached, nothing changes.
 * 2. Remembers where the user came from when they open /sign-in (G1: back to the same page; the
 *    return page is kept in a cookie, never in the address).
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  let response = NextResponse.next();

  if (refresh !== undefined && refresh !== '' && needsRefresh(access, Date.now())) {
    const outcome = await refreshSession(refresh);
    if (outcome.kind === 'ok') {
      request.cookies.set(ACCESS_COOKIE, outcome.accessToken);
      response = NextResponse.next({ request: { headers: request.headers } });
      response.cookies.set(ACCESS_COOKIE, outcome.accessToken, cookieOptions(outcome.expiresIn));
      if (outcome.refresh !== null) {
        response.cookies.set(
          REFRESH_COOKIE,
          outcome.refresh.value,
          cookieOptions(outcome.refresh.maxAge),
        );
      }
    } else if (outcome.kind === 'ended' || outcome.kind === 'refused') {
      if (outcome.kind === 'refused' && !refusedLogged) {
        refusedLogged = true;
        console.error(
          "The API refused a session refresh (403). Check that WEB_BASE_URL is the public web origin and is listed in the API's AUTH_ALLOWED_ORIGINS.",
        );
      }
      request.cookies.delete(ACCESS_COOKIE);
      request.cookies.delete(REFRESH_COOKIE);
      response = NextResponse.next({ request: { headers: request.headers } });
      response.cookies.delete(ACCESS_COOKIE);
      response.cookies.delete(REFRESH_COOKIE);
      response.cookies.set(SESSION_ENDED_COOKIE, '1', cookieOptions(60));
    }
  }

  // Only a page visit from another page: the sign-in form's own posts (server actions) come from
  // /sign-in and must not overwrite the page to return to.
  if (request.nextUrl.pathname === '/sign-in' && request.method === 'GET') {
    const referer = request.headers.get('referer');
    if (referer !== null) {
      try {
        const from = new URL(referer);
        // The public origin, not `request.nextUrl.origin`: behind a reverse proxy the server
        // sees its own address (http://web:3000), which no browser page ever has.
        if (from.origin === webOrigin() && !from.pathname.startsWith('/sign-in')) {
          response.cookies.set(
            RETURN_COOKIE,
            safeReturnPath(`${from.pathname}${from.search}`),
            cookieOptions(30 * 60),
          );
        }
      } catch {
        // An unreadable referer is ignored: sign-in then returns to the home page.
      }
    }
  }

  return response;
}

export const config = {
  // Pages only: not Next's own files, not static files, not the API route handlers.
  matcher: ['/((?!_next/|api/|favicon.ico|.*\\..*).*)'],
};
