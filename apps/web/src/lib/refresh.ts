import { createHash } from 'node:crypto';
import { type RefreshCookie, readApiRefreshCookie } from './session';

/** What one call of `POST /auth/refresh` came to. */
export type RefreshOutcome =
  /** A new access token, and the rotated refresh token when the API sent one. */
  | { kind: 'ok'; accessToken: string; expiresIn: number; refresh: RefreshCookie | null }
  /** 401: the refresh token is spent, expired or revoked. The session is over. */
  | { kind: 'ended' }
  /**
   * 403: the API refused the request itself, which is a configuration fault (the `Origin` is not
   * in AUTH_ALLOWED_ORIGINS), not an ended session.
   */
  | { kind: 'refused' }
  /** The API could not be reached, or answered anything else. Nothing changes; try next time. */
  | { kind: 'unavailable' };

/** Calls the API once with this refresh token. `null`: the API could not be reached. */
export type RefreshCall = (refreshToken: string) => Promise<Response | null>;

export interface RefresherOptions {
  call: RefreshCall;
  now?: () => number;
  /** How long a finished outcome is reused for the same token. */
  keepMs?: number;
}

interface Entry {
  promise: Promise<RefreshOutcome>;
  /** Until when a finished outcome is reused; `Infinity` while the call runs. */
  until: number;
}

/**
 * Synchronous on purpose: the lookup and the insert below then happen with no `await` between
 * them, so two requests can never both miss the map and both call the API.
 */
function hashOf(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

async function outcomeOf(response: Response | null): Promise<RefreshOutcome> {
  if (response === null) return { kind: 'unavailable' };
  if (response.status === 200) {
    try {
      const body = (await response.json()) as { accessToken?: unknown; expiresIn?: unknown };
      if (typeof body.accessToken === 'string' && typeof body.expiresIn === 'number') {
        return {
          kind: 'ok',
          accessToken: body.accessToken,
          expiresIn: body.expiresIn,
          refresh: readApiRefreshCookie(response.headers.getSetCookie()),
        };
      }
    } catch {
      // An unreadable body is treated like an unreachable API.
    }
    return { kind: 'unavailable' };
  }
  if (response.status === 401) return { kind: 'ended' };
  if (response.status === 403) return { kind: 'refused' };
  return { kind: 'unavailable' };
}

/**
 * Refreshes a session at most once per refresh token (OQ-91). The API rotates the refresh token
 * on every use and treats a second use of a spent one as theft: it revokes the whole session. A
 * browser easily sends two requests at once near the end of the access token's life (link
 * prefetches on the results page, two tabs), and each would refresh.
 *
 * So, per refresh token:
 * - a call that is running is shared: a second request waits for the first one's outcome;
 * - a finished outcome is kept for `keepMs` (10 seconds), because requests the browser sent
 *   before it stored the new cookies still carry the old token, and must get the same new
 *   tokens instead of calling the API with a spent one;
 * - "unavailable" is not kept, so the next request tries again.
 *
 * Entries are keyed by a SHA-256 hash of the token; the token itself is never stored as a key
 * and never logged. This holds within one web server process. More than one process (several
 * web tasks) would need a shared store, or a grace window in the API (a decision on OQ-91).
 */
export function createRefresher(
  options: RefresherOptions,
): (refreshToken: string) => Promise<RefreshOutcome> {
  const now = options.now ?? Date.now;
  const keepMs = options.keepMs ?? 10_000;
  const entries = new Map<string, Entry>();

  const prune = (at: number): void => {
    for (const [key, entry] of entries) if (entry.until <= at) entries.delete(key);
  };

  return async (refreshToken) => {
    const key = hashOf(refreshToken);
    prune(now());
    const existing = entries.get(key);
    if (existing !== undefined) return existing.promise;

    const entry: Entry = {
      until: Number.POSITIVE_INFINITY,
      promise: Promise.resolve({ kind: 'unavailable' }),
    };
    entry.promise = options
      .call(refreshToken)
      .catch(() => null)
      .then(outcomeOf)
      .then((outcome) => {
        if (outcome.kind === 'unavailable') entries.delete(key);
        else entry.until = now() + keepMs;
        return outcome;
      });
    entries.set(key, entry);
    return entry.promise;
  };
}
