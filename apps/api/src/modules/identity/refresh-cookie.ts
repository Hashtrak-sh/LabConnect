import type { Request, Response } from 'express';

/** Cookie name, from the contract's `refreshCookie` security scheme. */
export const REFRESH_COOKIE = 'lc_refresh';

/**
 * httpOnly, Secure, SameSite=Lax, host-only (so scoped to the API domain), and limited to
 * `/v1/auth`: the browser sends it to no other route, though only `/auth/refresh` reads it.
 */
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/v1/auth',
} as const;

export function setRefreshCookie(response: Response, token: string, maxAgeSeconds: number): void {
  response.cookie(REFRESH_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: maxAgeSeconds * 1000 });
}

export function clearRefreshCookie(response: Response): void {
  response.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS);
}

/** The value of one cookie of the request, or `undefined`. No cookie parser is installed. */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
