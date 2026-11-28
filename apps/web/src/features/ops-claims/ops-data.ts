import { cleanEtag, etagOf } from '@/features/common/problem';
import { api } from '@/lib/api';
import {
  type AdminClaim,
  type ClaimPage,
  type ClaimReadFailure,
  type ClaimStatus,
  claimReadFailure,
} from './ops-model';

export const PAGE_SIZE = 25;

/** One page of `listAdminLabClaims`; `null` when the API refuses or cannot be reached. */
export async function loadClaimPage(
  token: string,
  options: { status: ClaimStatus | null; cursor: string | null; limit?: number },
): Promise<ClaimPage | null> {
  try {
    const { data } = await api(token).GET('/admin/claims', {
      params: {
        query: {
          ...(options.status === null ? {} : { status: options.status }),
          ...(options.cursor === null ? {} : { cursor: options.cursor }),
          limit: options.limit ?? PAGE_SIZE,
        },
      },
    });
    if (data === undefined) return null;
    return { data: data.data, nextCursor: data.page.nextCursor };
  } catch {
    return null;
  }
}

export type ClaimRead =
  { kind: 'ok'; claim: AdminClaim; etag: string } | { kind: ClaimReadFailure };

/**
 * `getAdminLabClaim`: one claim with the lab and the claimant, and its `ETag`, which is what
 * approve and reject expect in `If-Match`. The `ETag` is the one the API sent; the claim's own
 * `lockVersion` (the same number, as the contract says) is used only if the header is missing.
 * A claim that cannot be read is never "not found" unless the API said 404.
 */
export async function loadClaim(token: string, id: string): Promise<ClaimRead> {
  try {
    const { data, response } = await api(token).GET('/admin/claims/{id}', {
      params: { path: { id } },
    });
    if (data === undefined) return { kind: claimReadFailure(response.status) };
    return {
      kind: 'ok',
      claim: data,
      etag: cleanEtag(response.headers.get('etag')) ?? etagOf(data.lockVersion),
    };
  } catch {
    return { kind: 'unavailable' };
  }
}
