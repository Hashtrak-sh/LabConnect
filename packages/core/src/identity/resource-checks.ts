import type { PermissionCode } from '@labconnect/shared';
import { type CurrentActor, requireOrganisation } from './actor.js';
import { IdentityError } from './errors.js';

// Resource checks for domain services (AUTHENTICATION_AND_AUTHORISATION.md section 3, "Resource
// checks"; ROLES_AND_PERMISSIONS.md section 3 layer 2). They run *after* the guards, inside the
// service's transaction, on a resource that was just loaded.
//
// The 404-versus-403 rule (TENANT_ISOLATION section 2 rule 5, API_CONVENTIONS section 6):
//
//   1. The role-level permission is the guard's job and does not depend on any resource, so it
//      answers 403 before a resource id is even looked at. It tells a caller nothing about which
//      resources exist.
//   2. Then the service loads the resource through a tenant-scoped repository. A resource that
//      is unknown, or outside the actor's organisation or sites, is `404 NOT_FOUND`. Never 403:
//      that would confirm it exists.
//   3. Only a resource that is in scope can be `403 FORBIDDEN` (a condition of the grant, the
//      state, Maker is not Checker...).
//
// So check scope first and permission after. `assertAccess` does the two in that order.

const notFound = (): IdentityError => new IdentityError('NOT_FOUND');

/** A user with no membership has no organisation, so nothing is in its scope: 404. */
function organisationOf(actor: CurrentActor): string {
  if (actor.orgId === null) throw notFound();
  return requireOrganisation(actor).orgId;
}

/**
 * A resource of one organisation. Out of scope is `404 NOT_FOUND`. Platform staff pass: their
 * access is role-based, narrowed by permissions and break-glass rules, not by organisation.
 */
export function assertSameOrg(actor: CurrentActor, resourceOrgId: string | null | undefined): void {
  if (actor.isPlatform) return;
  if (resourceOrgId !== organisationOf(actor)) throw notFound();
}

/**
 * A shared transactional resource: it belongs to its customer organisation and its lab
 * organisation (a booking and what hangs off it). The actor's organisation must be one of the
 * two, else `404 NOT_FOUND`. Platform staff pass.
 */
export function assertPartyOrg(
  actor: CurrentActor,
  parties: { customerOrgId: string; labOrgId: string },
): void {
  if (actor.isPlatform) return;
  const orgId = organisationOf(actor);
  if (orgId !== parties.customerOrgId && orgId !== parties.labOrgId) throw notFound();
}

/**
 * A lab-side resource at a lab site: the site must be one of the lab member's assigned sites
 * (RR-3; enforced by the services and repositories only, RLS compares organisations). Out of
 * scope is `404 NOT_FOUND`. Platform staff pass (`allSites`). A customer actor, or a lab member
 * with no site assigned, is out of scope for every site. Use it for lab-side routes only; a
 * customer reading its own booking is checked with `assertPartyOrg`.
 */
export function assertSiteInScope(actor: CurrentActor, siteId: string): void {
  if (actor.allSites) return;
  if (actor.orgType !== 'LAB' || !actor.siteIds.includes(siteId)) throw notFound();
}

/**
 * Maker is not Checker: the approver must not be the user who made the record. `403
 * SELF_APPROVAL_FORBIDDEN`. The database backs it with `CHECK (checker_user_id <> maker_user_id)`.
 */
export function assertNotSameUser(actor: CurrentActor, makerUserId: string): void {
  if (actor.userId === makerUserId) {
    throw new IdentityError('SELF_APPROVAL_FORBIDDEN', {
      detail: 'The approver cannot be the user who made the record.',
    });
  }
}

/** The role-level permission, for a service that has to re-check it. `403 FORBIDDEN`. */
export function assertPermitted(actor: CurrentActor, permission: PermissionCode): void {
  if (!actor.permissions.has(permission)) throw new IdentityError('FORBIDDEN');
}

/**
 * A resource that was looked up inside the actor's scope: `404 NOT_FOUND` when the lookup found
 * nothing (`null`/`undefined`, which is also what a tenant-scoped repository answers for another
 * tenant's row) or `inScope` says it is outside the actor's scope.
 */
export function assertVisible<T>(
  resource: T | null | undefined,
  inScope: (resource: T) => boolean = () => true,
): T {
  if (resource === null || resource === undefined || !inScope(resource)) throw notFound();
  return resource;
}

/**
 * The 404-versus-403 rule in one call: not found or out of scope is 404 first, then not
 * permitted is 403.
 */
export function assertAccess(input: {
  found: boolean;
  inScope: boolean;
  permitted: boolean;
}): void {
  if (!input.found || !input.inScope) throw notFound();
  if (!input.permitted) throw new IdentityError('FORBIDDEN');
}
