import { cookies } from 'next/headers';
import { api } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

export interface CurrentUser {
  name: string;
  email: string;
  /** The active membership's organisation name, when there is one. */
  organisation: string | null;
}

/**
 * The signed-in user for the header (`GET /me`), or `null` when signed out. The proxy has already
 * refreshed the access token for this request. A failure counts as signed out: the header must
 * never break a public page.
 */
export async function currentUser(): Promise<CurrentUser | null> {
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
    };
  } catch {
    return null;
  }
}
