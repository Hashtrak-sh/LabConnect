import type { Prisma } from '@labconnect/database';
import { type BookingTransition, ROLES, type TransitionActor } from '@labconnect/shared';
import type { BookingActor } from './types.js';

/** The row-level-security settings of the caller's transaction (`withDbContext`). */
export interface CallerContext {
  userId: string | null;
  orgId: string | null;
  isPlatform: boolean;
  isSystem: boolean;
}

export async function readCallerContext(tx: Prisma.TransactionClient): Promise<CallerContext> {
  const rows = await tx.$queryRaw<
    { user_id: string | null; org_id: string | null; is_platform: boolean; is_system: boolean }[]
  >`SELECT app_user_id()::text AS user_id, app_org_id()::text AS org_id,
           app_is_platform() AS is_platform, app_is_system() AS is_system`;
  const row = rows[0];
  return {
    userId: row?.user_id ?? null,
    orgId: row?.org_id ?? null,
    isPlatform: row?.is_platform ?? false,
    isSystem: row?.is_system ?? false,
  };
}

/** What the booking itself says about who is a party to it. Never taken from the command. */
export interface BookingParties {
  customerOrgId: string;
  labOrgId: string;
  labSiteId: string;
  requesterUserId: string;
}

export type ActorDecision = { allowed: true } | { allowed: false; reason: string };

const deny = (reason: string): ActorDecision => ({ allowed: false, reason });

/**
 * Whether `actor` may trigger `transition` on a booking with these parties, given the
 * database context the caller set. This is the engine's own defence in depth: the HTTP
 * guards (permissions) are separate and come first.
 *
 * 1. The command must agree with the database context. A SYSTEM actor needs the system
 *    context; a user needs a context of their own (`app.user_id`), a tenant context for a
 *    customer or lab role and the platform context for a platform role; a stated `orgId`
 *    must be the context's. So a request cannot call itself SYSTEM or Ops.
 * 2. A customer or lab role must belong to the party it speaks for: the context's
 *    organisation is the booking's customer or lab organisation.
 * 3. The (role, qualifier) or owner or system source must be one the table lists for the
 *    transition, for any of its commands (T-08 lists `DeclineCounter` and `ExpireCounter`).
 */
export function authorizeActor(
  transition: BookingTransition,
  actor: BookingActor,
  caller: CallerContext,
  parties: BookingParties,
): ActorDecision {
  const allowed: TransitionActor[] = transition.commands.flatMap((command) => [...command.actors]);

  if (actor.kind === 'SYSTEM') {
    if (!caller.isSystem) return deny('SYSTEM_ACTOR_OUTSIDE_SYSTEM_CONTEXT');
    const permitted = allowed.some(
      (entry) =>
        entry.kind === 'SYSTEM' && (entry.source === undefined || entry.source === actor.source),
    );
    return permitted ? { allowed: true } : deny('SYSTEM_NOT_ALLOWED');
  }

  // A user.
  if (caller.isSystem) return deny('USER_ACTOR_IN_SYSTEM_CONTEXT');
  if (caller.userId === null || caller.userId !== actor.userId)
    return deny('USER_CONTEXT_MISMATCH');
  const orgType = ROLES[actor.role].orgType;
  if (orgType === 'PLATFORM') {
    if (!caller.isPlatform) return deny('PLATFORM_ROLE_OUTSIDE_PLATFORM_CONTEXT');
  } else {
    if (caller.isPlatform || caller.orgId === null)
      return deny('TENANT_ROLE_OUTSIDE_TENANT_CONTEXT');
    if (actor.orgId !== undefined && actor.orgId !== caller.orgId)
      return deny('ORG_CONTEXT_MISMATCH');
    const partyOrg = orgType === 'CUSTOMER' ? parties.customerOrgId : parties.labOrgId;
    if (caller.orgId !== partyOrg) return deny('NOT_A_PARTY');
  }

  const siteOk = actor.labSiteIds === undefined || actor.labSiteIds.includes(parties.labSiteId);
  const permitted = allowed.some((entry) => {
    switch (entry.kind) {
      case 'SYSTEM':
        return false;
      case 'OWNER':
        return orgType === 'CUSTOMER' && actor.userId === parties.requesterUserId;
      case 'ROLE':
        if (entry.role !== actor.role) return false;
        if (entry.qualifier === 'OF_SITE') return siteOk;
        if (entry.qualifier === 'OWN') return actor.userId === parties.requesterUserId;
        return true;
    }
  });
  return permitted ? { allowed: true } : deny('ROLE_NOT_ALLOWED');
}
