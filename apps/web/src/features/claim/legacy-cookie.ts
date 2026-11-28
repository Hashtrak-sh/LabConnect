import { cookies } from 'next/headers';
import { secureCookies } from '@/lib/session';

/**
 * The cookie the earlier build kept the claimant's claims in (path `/lab`, HttpOnly). Nothing
 * reads or writes it any more: the claims come from the API. A browser that used the earlier
 * build may still hold a copy, so the server deletes it when it sees one.
 */
export const LEGACY_CLAIMS_COOKIE = 'lc_claims';

/** The attributes the cookie was set with, expired, so that a browser drops its copy. */
export function legacyClaimsExpiry() {
  return {
    name: LEGACY_CLAIMS_COOKIE,
    value: '',
    path: '/lab',
    maxAge: 0,
    expires: new Date(0),
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: secureCookies(),
  };
}

/** Whether this request carries an old `lc_claims` cookie. */
export async function hasLegacyClaimsCookie(): Promise<boolean> {
  return (await cookies()).has(LEGACY_CLAIMS_COOKIE);
}

/** Deletes an old `lc_claims` cookie; only from a server action or a route handler. */
export async function dropLegacyClaimsCookie(): Promise<void> {
  const store = await cookies();
  if (store.has(LEGACY_CLAIMS_COOKIE)) store.set(legacyClaimsExpiry());
}
