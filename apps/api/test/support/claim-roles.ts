// One user per role for the Ops claim tests, without `buildWorld`: that builds its own catalogue,
// which cannot sit in one database beside the catalogue of `useClaimLabs` (unique master-data codes).
// The labs come from the claim labs (`onboarded: true` gives a claimed lab with a Maker and a Checker).
import { createCustomer, createPlatformTeam } from '@labconnect/database/test-utils';
import type { RoleCode } from '@labconnect/shared';
import type { ClaimableLab } from './claim-labs.js';
import type { IdentityApp, TenantUser } from './isolation/world.js';

export interface ClaimRoleUsers {
  byRole(role: RoleCode): TenantUser;
  /** A Checker of a second claimed lab. */
  otherLabChecker: TenantUser;
  labOrganisationId: string;
  otherLabOrganisationId: string;
  labSiteIds: string[];
  otherLabSiteIds: string[];
}

export async function claimRoleUsers(
  t: IdentityApp,
  makeLab: (options?: { onboarded?: boolean }) => Promise<ClaimableLab>,
): Promise<ClaimRoleUsers> {
  const team = await t.owner((tx) => createPlatformTeam(tx));
  const customer = await t.owner((tx) => createCustomer(tx));
  const lab = await makeLab({ onboarded: true });
  const other = await makeLab({ onboarded: true });

  const person = async (
    userId: string | undefined,
    role: RoleCode,
    organisationId: string,
  ): Promise<TenantUser> => {
    if (userId === undefined) throw new Error(`no user for ${role}`);
    const row = await t.db().query<{ id: string; email: string }>(
      `SELECT m.id, u.email FROM membership m JOIN app_user u ON u.id = m.user_id
        WHERE m.user_id = $1 AND m.organisation_id = $2`,
      [userId, organisationId],
    );
    const found = row.rows[0];
    if (!found) throw new Error(`no membership of ${userId} in ${organisationId}`);
    return { id: userId, email: found.email, role, organisationId, membershipId: found.id };
  };

  const users = new Map<RoleCode, TenantUser>([
    ['PLATFORM_OPS', await person(team.ops, 'PLATFORM_OPS', team.organisationId)],
    ['PLATFORM_FINANCE', await person(team.finance, 'PLATFORM_FINANCE', team.organisationId)],
    [
      'PLATFORM_DATA_STEWARD',
      await person(team.steward, 'PLATFORM_DATA_STEWARD', team.organisationId),
    ],
    ['PLATFORM_ADMIN', await person(team.admin, 'PLATFORM_ADMIN', team.organisationId)],
    ['CUSTOMER_ADMIN', await person(customer.admin, 'CUSTOMER_ADMIN', customer.organisationId)],
    [
      'CUSTOMER_REQUESTER',
      await person(customer.requester, 'CUSTOMER_REQUESTER', customer.organisationId),
    ],
    [
      'CUSTOMER_FINANCE',
      await person(customer.finance, 'CUSTOMER_FINANCE', customer.organisationId),
    ],
    ['LAB_CHECKER', await person(lab.fixture.checkers[0], 'LAB_CHECKER', lab.organisationId)],
    ['LAB_MAKER', await person(lab.fixture.makers[0], 'LAB_MAKER', lab.organisationId)],
  ]);
  return {
    byRole(role) {
      const found = users.get(role);
      if (!found) throw new Error(`no user for ${role}`);
      return found;
    },
    otherLabChecker: await person(other.fixture.checkers[0], 'LAB_CHECKER', other.organisationId),
    labOrganisationId: lab.organisationId,
    otherLabOrganisationId: other.organisationId,
    labSiteIds: lab.fixture.sites.map((site) => site.id),
    otherLabSiteIds: other.fixture.sites.map((site) => site.id),
  };
}
