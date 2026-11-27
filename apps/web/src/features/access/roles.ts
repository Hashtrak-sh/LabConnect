import type { components } from '@labconnect/api-contract';

type Me = components['schemas']['Me'];
export type RoleCode = components['schemas']['RoleCode'];
export type OrgType = components['schemas']['OrgType'];

/**
 * The signed-in user as the screens need them, from `GET /me`. The API stays the authority on
 * every call; this only decides what to render (and, in the server actions, what to attempt).
 */
export interface AccessUser {
  id: string;
  name: string;
  /** The membership this session acts as; `null` when the user has none (a new claimant). */
  active: { organisation: string; orgType: OrgType; roles: readonly RoleCode[] } | null;
  memberships: readonly { organisation: string; orgType: OrgType; roles: readonly RoleCode[] }[];
}

/** The `GET /me` answer reduced to what the access checks use. */
export function toAccessUser(me: Me): AccessUser {
  const memberships = me.memberships.map((membership) => ({
    organisation: membership.organisation.displayName,
    orgType: membership.organisation.orgType,
    roles: membership.roles,
  }));
  const activeId = me.activeMembershipId;
  const activeIndex = me.memberships.findIndex((membership) => membership.id === activeId);
  return {
    id: me.user.id,
    name: me.user.fullName,
    active: activeIndex === -1 ? null : (memberships[activeIndex] ?? null),
    memberships,
  };
}

/**
 * Whether the role the session acts as is one of `allowed`. Only the active membership counts:
 * that is the one the API authorises the next request with, so a role held in another
 * organisation does not open a page here.
 */
export function hasAnyRole(user: AccessUser, allowed: readonly RoleCode[]): boolean {
  return user.active !== null && user.active.roles.some((role) => allowed.includes(role));
}

/** Platform staff cannot hold a lab claim (RR-5); the API refuses them too. */
export function isPlatformStaff(user: AccessUser): boolean {
  return user.memberships.some((membership) => membership.orgType === 'PLATFORM');
}

/**
 * Who may review lab claims. The contract says `PLATFORM_OPS` for all four operations, and
 * every handler refuses any other role (also Platform Admin and Platform Finance), so the
 * screens follow the contract, not the board's wording "Platform Ops and Platform Finance".
 */
export const CLAIM_REVIEW_ROLES: readonly RoleCode[] = ['PLATFORM_OPS'];

/** The lab memberships of the user (what an approved claim becomes). */
export function labMemberships(user: AccessUser): AccessUser['memberships'] {
  return user.memberships.filter((membership) => membership.orgType === 'LAB');
}
