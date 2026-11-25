import type { Prisma } from '@labconnect/database';
import type { RoleCode } from '@labconnect/shared';

// What other modules may ask identity about people, without reading its tables. The
// notifications consumer uses it to turn "the Checkers of this lab site" into users. Read-only;
// meant for a job that runs in the system context (it must see users of several organisations).

/** An active user holding an active role in an active organisation. No contact details. */
export interface RoleHolder {
  userId: string;
  organisationId: string;
  /** The role held in that organisation that matched the query. */
  role: RoleCode;
}

export interface RoleHolderQuery {
  /** Only this organisation, or only the platform organisation. One of the two is required. */
  scope: { organisationId: string } | { platform: true };
  roles: readonly RoleCode[];
  /**
   * Lab members only: the lab site the member must be assigned to. A membership with no live
   * `membership_site` row covers no site (OQ-98), so it never matches. Ignored for platform scope.
   */
  siteId?: string;
  /** Narrow to these users (for example "the requester, if still a member"). */
  userIds?: readonly string[];
}

/**
 * The users who hold one of `roles` right now: user `ACTIVE`, membership `ACTIVE`, organisation
 * `ACTIVE`, role not revoked, and for a site query an unrevoked assignment to the site. One entry
 * per user and role, ordered by user id so the result is stable.
 */
export async function findRoleHolders(
  tx: Prisma.TransactionClient,
  query: RoleHolderQuery,
): Promise<RoleHolder[]> {
  if (query.roles.length === 0) return [];
  if (query.userIds?.length === 0) return [];
  const platform = 'platform' in query.scope;
  const rows = await tx.membershipRole.findMany({
    where: {
      revokedAt: null,
      role: { in: [...query.roles] },
      membership: {
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
        organisation: {
          status: 'ACTIVE',
          ...('platform' in query.scope
            ? { orgType: 'PLATFORM' as const }
            : { id: query.scope.organisationId }),
        },
        ...(query.userIds ? { userId: { in: [...query.userIds] } } : {}),
        ...(!platform && query.siteId !== undefined
          ? { membershipSites: { some: { labSiteId: query.siteId, revokedAt: null } } }
          : {}),
      },
    },
    select: { role: true, membership: { select: { userId: true, organisationId: true } } },
    orderBy: [{ membership: { userId: 'asc' } }, { role: 'asc' }],
  });
  return rows.map((row) => ({
    userId: row.membership.userId,
    organisationId: row.membership.organisationId,
    role: row.role,
  }));
}

/** Where to send a message to one user. The address leaves this function only to be used, never stored. */
export interface UserContact {
  userId: string;
  email: string;
  fullName: string;
  /** The user's locale, for example `en-IN`. */
  locale: string;
  status: 'INVITED' | 'ACTIVE' | 'DISABLED';
}

/** The contact details of a user, or `null` for an unknown id. `status` tells an invited or disabled user from an active one. */
export async function loadUserContact(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<UserContact | null> {
  const user = await tx.appUser.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true, locale: true, status: true },
  });
  if (!user) return null;
  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    locale: user.locale,
    status: user.status,
  };
}

/**
 * An organisation's name and type, for message wording. `null` if the id is unknown.
 */
export async function loadOrganisationName(
  tx: Prisma.TransactionClient,
  organisationId: string,
): Promise<string | null> {
  const organisation = await tx.organisation.findUnique({
    where: { id: organisationId },
    select: { displayName: true },
  });
  return organisation?.displayName ?? null;
}
