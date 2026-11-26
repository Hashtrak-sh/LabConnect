import { type Prisma, uuidv7 } from '@labconnect/database';
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

/**
 * True when the user is platform staff (`app_user.is_platform_staff`, RR-5). Read from the user
 * row, not from a membership, so staff without an active membership are recognised too. The
 * user is the one the caller authenticated, never a value from the request.
 */
export async function isPlatformStaff(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  const user = await tx.appUser.findUnique({
    where: { id: userId },
    select: { isPlatformStaff: true },
  });
  return user?.isPlatformStaff ?? false;
}

/** The reasons a user cannot be given a lab membership (`grantLabMembership`). */
export type LabMembershipRefusal =
  'USER_NOT_ACTIVE' | 'USER_IS_PLATFORM_STAFF' | 'HOLDS_LAB_ROLE' | 'ALREADY_MEMBER';

export type GrantLabMembershipResult =
  { ok: true; membershipId: string } | { ok: false; reason: LabMembershipRefusal };

/**
 * Gives a user an active membership of a lab organisation with exactly one lab role, assigned to
 * the given sites of that organisation (ROLES_AND_PERMISSIONS RR-2, RR-3, RR-5). Used when Ops
 * approves a lab claim (the first `LAB_CHECKER`); the caller decides who may call it and audits
 * the change. It refuses, and writes nothing, when:
 * - the user is not `ACTIVE` (`USER_NOT_ACTIVE`) or is platform staff (`USER_IS_PLATFORM_STAFF`);
 * - the user already holds a lab role anywhere (`HOLDS_LAB_ROLE`): a role not revoked on a
 *   membership that is not deactivated. A customer-side membership does not count (RR-4);
 * - the user already has a membership of this organisation, in any status (`ALREADY_MEMBER`):
 *   there is one membership row per user and organisation.
 *
 * The user's grants are serialised by an advisory lock held until the end of the transaction, so
 * two approvals for the same user (two labs) cannot both pass the check and leave two lab roles.
 * The database backs the rules with the one-lab-role index per membership, the role-matches-
 * organisation trigger, the platform-staff trigger and the site-of-the-organisation trigger.
 * Whether the organisation is a lab, and which sites it has, is the caller's to check.
 */
export async function grantLabMembership(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    organisationId: string;
    role: 'LAB_MAKER' | 'LAB_CHECKER';
    siteIds: readonly string[];
    grantedByUserId: string;
    now: Date;
  },
): Promise<GrantLabMembershipResult> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lab_membership:${input.userId}`}, 0))`;
  const user = await tx.appUser.findUnique({
    where: { id: input.userId },
    select: { status: true, isPlatformStaff: true },
  });
  if (user?.status !== 'ACTIVE') return { ok: false, reason: 'USER_NOT_ACTIVE' };
  if (user.isPlatformStaff) return { ok: false, reason: 'USER_IS_PLATFORM_STAFF' };
  const labRole = await tx.membershipRole.findFirst({
    where: {
      revokedAt: null,
      role: { in: ['LAB_MAKER', 'LAB_CHECKER'] },
      membership: { userId: input.userId, status: { not: 'DEACTIVATED' } },
    },
    select: { id: true },
  });
  if (labRole !== null) return { ok: false, reason: 'HOLDS_LAB_ROLE' };
  const existing = await tx.membership.findUnique({
    where: {
      userId_organisationId: { userId: input.userId, organisationId: input.organisationId },
    },
    select: { id: true },
  });
  if (existing !== null) return { ok: false, reason: 'ALREADY_MEMBER' };

  const membershipId = uuidv7(input.now.getTime());
  await tx.membership.create({
    data: {
      id: membershipId,
      userId: input.userId,
      organisationId: input.organisationId,
      status: 'ACTIVE',
      activatedAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
      createdByUserId: input.grantedByUserId,
    },
  });
  await tx.membershipRole.create({
    data: {
      id: uuidv7(input.now.getTime()),
      membershipId,
      role: input.role,
      grantedByUserId: input.grantedByUserId,
      createdAt: input.now,
      updatedAt: input.now,
      createdByUserId: input.grantedByUserId,
    },
  });
  if (input.siteIds.length > 0) {
    await tx.membershipSite.createMany({
      data: input.siteIds.map((labSiteId) => ({
        id: uuidv7(input.now.getTime()),
        membershipId,
        labSiteId,
        createdAt: input.now,
        updatedAt: input.now,
        createdByUserId: input.grantedByUserId,
      })),
    });
  }
  return { ok: true, membershipId };
}
