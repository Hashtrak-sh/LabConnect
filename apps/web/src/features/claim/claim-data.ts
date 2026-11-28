import { cleanEtag } from '@/features/common/problem';
import { api } from '@/lib/api';
import { type LabClaim, type ReadFailure, readFailure } from './claim-model';

/** How many claims a page of "Your claims" holds (the API's default is 25, its most 100). */
export const CLAIMS_PAGE_SIZE = 25;

export type ClaimPage =
  { kind: 'ok'; claims: readonly LabClaim[]; nextCursor: string | null } | { kind: ReadFailure };

/**
 * One page of `listMyLabClaims`: the caller's own claims, newest first, the API's cursor as it is.
 * Never throws: an answer that is not a page is a failure the screen words (a 503 is
 * "unavailable", never "no claims"). The caller must not be platform staff (the API answers 403).
 */
export async function loadMyClaims(token: string, cursor: string | null): Promise<ClaimPage> {
  try {
    const { data, response } = await api(token).GET('/lab/claims', {
      params: {
        query: { limit: CLAIMS_PAGE_SIZE, ...(cursor === null ? {} : { cursor }) },
      },
    });
    if (data === undefined) return { kind: readFailure(response.status, 'list') };
    return { kind: 'ok', claims: data.data, nextCursor: data.page.nextCursor };
  } catch {
    return { kind: 'unavailable' };
  }
}

export type ClaimRead =
  { kind: 'ok'; claim: LabClaim; etag: string | null } | { kind: ReadFailure };

/**
 * `getLabClaim`: one claim of the caller, with the `ETag` that the writes expect as `If-Match`,
 * read now (never remembered). Another user's claim and an unknown id are the same 404, which is
 * `not-found` here and nothing else.
 */
export async function loadMyClaim(token: string, id: string): Promise<ClaimRead> {
  try {
    const { data, response } = await api(token).GET('/lab/claims/{id}', {
      params: { path: { id } },
    });
    if (data === undefined) return { kind: readFailure(response.status, 'one') };
    return { kind: 'ok', claim: data, etag: cleanEtag(response.headers.get('etag')) };
  } catch {
    return { kind: 'unavailable' };
  }
}
