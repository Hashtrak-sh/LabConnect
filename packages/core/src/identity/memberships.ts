import type { Prisma } from '@labconnect/database';
import { type RoleCode, roleRequiresMfa } from '@labconnect/shared';

export interface OrganisationSummary {
  id: string;
  orgType: 'CUSTOMER' | 'LAB' | 'PLATFORM';
  displayName: string;
}

/** An active membership of a user with its active roles (the contract's `MembershipSummary`). */
export interface MembershipView {
  id: string;
  organisation: OrganisationSummary;
  roles: RoleCode[];
}

/**
 * The user's active memberships, oldest first, each with its roles that are not revoked.
 * A membership with no active role is left out: it grants nothing. The user is the one the
 * transaction's database context belongs to, never a value from the request.
 */
export async function loadMemberships(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<MembershipView[]> {
  const memberships = await tx.membership.findMany({
    where: { userId, status: 'ACTIVE' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      organisation: { select: { id: true, orgType: true, displayName: true } },
    },
  });
  if (memberships.length === 0) return [];
  const roles = await tx.membershipRole.findMany({
    where: { membershipId: { in: memberships.map((m) => m.id) }, revokedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { membershipId: true, role: true },
  });
  return memberships.flatMap((membership) => {
    const own = roles.filter((row) => row.membershipId === membership.id).map((row) => row.role);
    return own.length === 0
      ? []
      : [{ id: membership.id, organisation: membership.organisation, roles: own }];
  });
}

/** True when any active membership holds a role that cannot be used without MFA (FR-IAM-03). */
export function requiresMfa(memberships: readonly MembershipView[]): boolean {
  return memberships.some((membership) => membership.roles.some(roleRequiresMfa));
}

/** True when the user has a verified, unrevoked TOTP factor. */
export async function hasVerifiedTotp(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  const factor = await tx.mfaFactor.findFirst({
    where: { userId, factorType: 'TOTP', verifiedAt: { not: null }, revokedAt: null },
    select: { id: true },
  });
  return factor !== null;
}
