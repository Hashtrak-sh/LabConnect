import type { Prisma } from '@labconnect/database';
import {
  type OrgType,
  type PermissionCode,
  permissionsOf,
  type RoleCode,
  ROLES,
  roleRequiresMfa,
} from '@labconnect/shared';
import { IdentityError } from './errors.js';

// What one request may act as (AUTHENTICATION_AND_AUTHORISATION.md section 3, ROLES_AND_PERMISSIONS
// section 3, TENANT_ISOLATION section 2 rules 2 and 4).
//
// A CurrentActor is built from the session and the database only. No value of the request (path,
// query, body, header) is an input here, with one exception that is a *choice*, not an authority:
// `X-Active-Membership` names one of the user's own active memberships (API_CONVENTIONS section 4).

/** The organisation statuses of `org_status`, as the actor loader reads them. */
export type ActorOrgStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

/**
 * Who the request acts as. Immutable; built once per request by `MembershipGuard`.
 *
 * - `membershipId`, `orgId`, `orgType` are all `null` for a user with no active membership (a
 *   fresh customer self-signup). That actor has no roles and no permissions, so every route
 *   that declares a permission refuses it; only routes marked `@NoPermissionRequired()` serve it.
 * - `permissions` is what the roles hold in *any* form of the matrix (✔, ○ or ◐). An `OWN` or
 *   `CONDITIONAL` grant still has to be enforced by the domain service (`grantsFor(actor.roles, …)`).
 * - `siteIds` are the lab sites of the live `membership_site` rows (lab members only). An empty
 *   list means *no* site, not all sites. `allSites` is true only for platform staff, whose access
 *   is role-based and not site-bound (TENANT_ISOLATION section 2 rule 6).
 */
export interface CurrentActor {
  readonly userId: string;
  readonly sessionId: string;
  readonly membershipId: string | null;
  readonly orgId: string | null;
  readonly orgType: OrgType | null;
  readonly roles: readonly RoleCode[];
  readonly permissions: ReadonlySet<PermissionCode>;
  readonly siteIds: readonly string[];
  readonly allSites: boolean;
  /** When MFA last succeeded in this session. Not a freshness check: see `assertStepUp`. */
  readonly mfaVerifiedAt: Date | null;
  readonly isPlatform: boolean;
}

/** An actor that belongs to an organisation: `orgId`, `orgType` and `membershipId` are set. */
export type OrganisationActor = CurrentActor & {
  readonly membershipId: string;
  readonly orgId: string;
  readonly orgType: OrgType;
};

/** The part of the session the builder reads. */
export interface ActorSession {
  userId: string;
  sessionId: string;
  mfaVerifiedAt: Date | null;
}

/** One active membership as the database holds it. */
export interface ActorMembership {
  id: string;
  organisationId: string;
  orgType: OrgType;
  orgStatus: ActorOrgStatus;
  /** Roles that are not revoked. */
  roles: readonly RoleCode[];
  /** Lab sites of the live `membership_site` rows. */
  siteIds: readonly string[];
}

/** The actor of a user with no membership: no organisation, no roles, no permissions. */
export function actorWithoutMembership(session: ActorSession): CurrentActor {
  return Object.freeze({
    userId: session.userId,
    sessionId: session.sessionId,
    membershipId: null,
    orgId: null,
    orgType: null,
    roles: Object.freeze([]),
    permissions: new Set<PermissionCode>(),
    siteIds: Object.freeze([]),
    allSites: false,
    mfaVerifiedAt: session.mfaVerifiedAt,
    isPlatform: false,
  });
}

/**
 * The actor of a membership. Fails closed:
 * - the organisation is not `ACTIVE` (suspended or closed): `403 FORBIDDEN`;
 * - no role of the membership fits the organisation's type (the database forbids it, RR-5, so
 *   this is a second line): `403 FORBIDDEN`;
 * - a role that requires MFA (`roleRequiresMfa`) while this session has never completed MFA:
 *   `401 STEP_UP_REQUIRED`. Sign-in already refuses a full session to a user whose memberships
 *   need MFA, but a membership or role gained after sign-in, or chosen with
 *   `X-Active-Membership`, would otherwise slip through. The client answers it with
 *   `/auth/mfa/verify`, which enrols first when there is no factor.
 */
export function buildCurrentActor(
  session: ActorSession,
  membership: ActorMembership,
): OrganisationActor {
  if (membership.orgStatus !== 'ACTIVE') {
    throw new IdentityError('FORBIDDEN', {
      detail: 'The organisation of this membership is not active.',
    });
  }
  const roles = [...new Set(membership.roles)].filter(
    (role) => ROLES[role].orgType === membership.orgType,
  );
  if (roles.length === 0) {
    throw new IdentityError('FORBIDDEN', { detail: 'This membership holds no active role.' });
  }
  if (roles.some(roleRequiresMfa) && session.mfaVerifiedAt === null) {
    throw new IdentityError('STEP_UP_REQUIRED', {
      detail: 'A role of this membership requires multi-factor authentication.',
      meta: { reason: 'MFA_REQUIRED_FOR_ROLE' },
    });
  }
  const isPlatform = membership.orgType === 'PLATFORM';
  return Object.freeze({
    userId: session.userId,
    sessionId: session.sessionId,
    membershipId: membership.id,
    orgId: membership.organisationId,
    orgType: membership.orgType,
    roles: Object.freeze(roles),
    permissions: new Set(roles.flatMap((role) => permissionsOf(role))),
    siteIds: Object.freeze(membership.orgType === 'LAB' ? [...new Set(membership.siteIds)] : []),
    allSites: isPlatform,
    mfaVerifiedAt: session.mfaVerifiedAt,
    isPlatform,
  });
}

/**
 * Loads the actor of a session. Run it in a transaction as the user alone (no organisation),
 * where the policies show the user only their own memberships.
 *
 * - `requestedMembershipId` (`X-Active-Membership`) must be one of the user's own *active*
 *   memberships, else `404 NOT_FOUND`, whether it exists or not. It is a choice among the
 *   user's memberships and never an authority (a request cannot name an organisation).
 * - Without it, the session's membership is used. A session with none gives the actor of a user
 *   with no membership. A session whose membership has since lapsed (deactivated, no active
 *   role) is refused at once with `403 FORBIDDEN`, although the access token has not expired.
 */
export async function loadCurrentActor(
  tx: Prisma.TransactionClient,
  session: ActorSession & { activeMembershipId: string | null },
  requestedMembershipId?: string,
): Promise<CurrentActor> {
  const chosenId = requestedMembershipId ?? session.activeMembershipId;
  if (chosenId === null) return actorWithoutMembership(session);

  const rows = await tx.membership.findMany({
    where: { userId: session.userId, status: 'ACTIVE' },
    select: {
      id: true,
      organisationId: true,
      organisation: { select: { orgType: true, status: true } },
      membershipRoles: { where: { revokedAt: null }, select: { role: true } },
      membershipSites: { where: { revokedAt: null }, select: { labSiteId: true } },
    },
  });
  const row = rows.find((candidate) => candidate.id === chosenId);
  if (!row) {
    if (requestedMembershipId !== undefined) throw new IdentityError('NOT_FOUND');
    throw new IdentityError('FORBIDDEN', {
      detail: 'The active membership of this session is no longer active.',
    });
  }
  return buildCurrentActor(session, {
    id: row.id,
    organisationId: row.organisationId,
    orgType: row.organisation.orgType,
    orgStatus: row.organisation.status,
    roles: row.membershipRoles.map((entry) => entry.role),
    siteIds: row.membershipSites.map((entry) => entry.labSiteId),
  });
}

/**
 * Narrows an actor to one that belongs to an organisation. `403 FORBIDDEN` for a user with no
 * active membership. Every query on tenant data goes through this first.
 */
export function requireOrganisation(actor: CurrentActor): OrganisationActor {
  if (actor.membershipId === null || actor.orgId === null || actor.orgType === null) {
    throw new IdentityError('FORBIDDEN', { detail: 'This action needs an active membership.' });
  }
  return actor as OrganisationActor;
}
