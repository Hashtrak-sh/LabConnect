import { describe, expect, it } from 'vitest';
import {
  accessTokenExpiry,
  needsRefresh,
  readApiRefreshCookie,
  safeReturnPath,
  secureCookies,
} from './session';

function token(claims: object): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'EdDSA' })}.${part(claims)}.signature`;
}

describe('web session helpers', () => {
  it('reads the expiry of an access token and refreshes a minute early', () => {
    const now = Date.parse('2026-11-26T10:00:00Z');
    const exp = now / 1000 + 600;
    expect(accessTokenExpiry(token({ exp }))).toBe(exp);
    expect(needsRefresh(token({ exp }), now)).toBe(false);
    expect(needsRefresh(token({ exp: now / 1000 + 30 }), now)).toBe(true);
    expect(needsRefresh(undefined, now)).toBe(true);
    expect(needsRefresh('not-a-jwt', now)).toBe(true);
  });

  it("takes the API's refresh token from Set-Cookie, and treats a cleared one as none", () => {
    expect(
      readApiRefreshCookie([
        'other=1; Path=/',
        'lc_refresh=abc.def; Max-Age=43200; Path=/v1/auth; HttpOnly; Secure; SameSite=Lax',
      ]),
    ).toEqual({ value: 'abc.def', maxAge: 43_200 });
    expect(readApiRefreshCookie(['lc_refresh=; Max-Age=0; Path=/v1/auth'])).toBeNull();
    expect(readApiRefreshCookie([])).toBeNull();
  });

  it('marks cookies Secure only when the public site is HTTPS', () => {
    expect(secureCookies('https://uat.labconnect.example')).toBe(true);
    expect(secureCookies('http://13.200.1.2')).toBe(false);
    expect(secureCookies('http://localhost:3000')).toBe(false);
  });

  it('returns only to a same-site page that is not an auth page', () => {
    expect(safeReturnPath('/labs/abc?tab=prices')).toBe('/labs/abc?tab=prices');
    expect(safeReturnPath('https://evil.example')).toBe('/');
    expect(safeReturnPath('//evil.example')).toBe('/');
    expect(safeReturnPath('/sign-in')).toBe('/');
    expect(safeReturnPath(undefined)).toBe('/');
  });
});
