import { cookies } from 'next/headers';
import { type ClaimJar, readJar, writeJar } from './claim-model';

/**
 * The claims this browser knows (see `ClaimRecord`). The cookie is HttpOnly, only sent to `/lab`
 * pages, and bound to the signed-in user inside its value, so it holds nothing a script or
 * another user could use.
 */
export const CLAIMS_COOKIE = 'lc_claims';

const THIRTY_DAYS = 30 * 24 * 3600;

export async function loadJar(userId: string): Promise<ClaimJar> {
  return readJar((await cookies()).get(CLAIMS_COOKIE)?.value, userId);
}

/** Only from a server action or route handler (a page cannot set cookies). */
export async function saveJar(jar: ClaimJar): Promise<void> {
  (await cookies()).set(CLAIMS_COOKIE, writeJar(jar), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/lab',
    maxAge: THIRTY_DAYS,
  });
}
