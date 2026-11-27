import type { components } from '@labconnect/api-contract';
import { api } from '@/lib/api';
import { type AdminClaim, type ClaimPage, type ClaimStatus, findClaim } from './ops-model';

type PublicLabSite = components['schemas']['PublicLabSite'];

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

/** One claim and its current version, found through the list (the API has no single read). */
export function loadClaim(token: string, id: string): Promise<AdminClaim | null> {
  return findClaim((cursor) => loadClaimPage(token, { status: null, cursor, limit: 100 }), id);
}

/**
 * The public profile of the claim's site, to show a name and a certificate number where Ops
 * would otherwise see only ids. A listed site is public data; any failure is "unavailable".
 */
export async function loadSite(siteId: string): Promise<PublicLabSite | null> {
  try {
    const { data } = await api().GET('/public/lab-sites/{siteId}', {
      params: { path: { siteId } },
    });
    return data ?? null;
  } catch {
    return null;
  }
}
