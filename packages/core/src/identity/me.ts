import type { Prisma } from '@labconnect/database';
import { type PermissionCode, permissionsOf } from '@labconnect/shared';
import { IdentityError } from './errors.js';
import { hasVerifiedTotp, loadMemberships, type MembershipView } from './memberships.js';

export interface MeUser {
  id: string;
  email: string;
  fullName: string;
  designation: string | null;
  locale: string;
  mfaEnrolled: boolean;
}

/** The contract's `Me`. */
export interface MeView {
  user: MeUser;
  memberships: MembershipView[];
  activeMembershipId: string | null;
  permissions: PermissionCode[];
}

/**
 * Picks the membership a request acts as: the one asked for in `X-Active-Membership` if
 * given, else the session's. A requested membership that is not one of the user's own active
 * memberships is `NOT_FOUND`, whether it does not exist or belongs to someone else: the
 * header is a choice among the user's memberships, never an authority (API_CONVENTIONS 4).
 * A session whose own membership has since lapsed falls back to none.
 */
export function resolveActiveMembership(
  memberships: readonly MembershipView[],
  sessionMembershipId: string | null,
  requestedMembershipId?: string,
): string | null {
  if (requestedMembershipId !== undefined) {
    if (!memberships.some((membership) => membership.id === requestedMembershipId)) {
      throw new IdentityError('NOT_FOUND');
    }
    return requestedMembershipId;
  }
  return memberships.some((membership) => membership.id === sessionMembershipId)
    ? sessionMembershipId
    : null;
}

/** The profile, the user's active memberships and the permissions of the active one. */
export async function loadMe(
  tx: Prisma.TransactionClient,
  input: { userId: string; sessionMembershipId: string | null; requestedMembershipId?: string },
): Promise<MeView> {
  const user = await tx.appUser.findUniqueOrThrow({
    where: { id: input.userId },
    select: { id: true, email: true, fullName: true, designation: true, locale: true },
  });
  const memberships = await loadMemberships(tx, input.userId);
  const activeMembershipId = resolveActiveMembership(
    memberships,
    input.sessionMembershipId,
    input.requestedMembershipId,
  );
  const active = memberships.find((membership) => membership.id === activeMembershipId);
  const permissions = [
    ...new Set((active?.roles ?? []).flatMap((role) => permissionsOf(role))),
  ].sort();
  return {
    user: { ...user, mfaEnrolled: await hasVerifiedTotp(tx, input.userId) },
    memberships,
    activeMembershipId,
    permissions,
  };
}
