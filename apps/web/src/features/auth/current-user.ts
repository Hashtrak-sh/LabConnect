import { cookies } from 'next/headers';
import { cache } from 'react';
import { api } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

export interface CurrentUser {
  name: string;
  email: string;
  /** The active membership's organisation name, when there is one. */
  organisation: string | null;
  /** The kind of the active membership's organisation, when there is one. */
  activeOrgType: 'CUSTOMER' | 'LAB' | 'PLATFORM' | null;
  /** The kinds and names of all the user's organisations (sign-up checks for a customer one). */
  memberships: { orgType: 'CUSTOMER' | 'LAB' | 'PLATFORM'; name: string }[];
}

/**
 * The signed-in user for the header (`GET /me`), or `null` when signed out. The proxy has already
 * refreshed the access token for this request. A failure counts as signed out: the header must
 * never break a public page.
 */
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const access = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (access === undefined) return null;
  try {
    const { data } = await api(access).GET('/me');
    if (!data) return null;
    const active = data.memberships.find((membership) => membership.id === data.activeMembershipId);
    return {
      name: data.user.fullName,
      email: data.user.email,
      organisation: active?.organisation.displayName ?? null,
      activeOrgType: active?.organisation.orgType ?? null,
      memberships: data.memberships.map((membership) => ({
        orgType: membership.organisation.orgType,
        name: membership.organisation.displayName,
      })),
    };
  } catch {
    return null;
  }
});
