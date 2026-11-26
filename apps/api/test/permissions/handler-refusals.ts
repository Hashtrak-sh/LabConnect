// Roles that hold a route's permission only as a CONDITIONAL grant (the matrix writes ◐) and that
// the handler therefore refuses with 403 FORBIDDEN, after the guard let them through. The permission
// matrix test (integration/permissions/matrix.real.spec.ts) expects `deny` for these cells, not
// `allow`; it also checks that each entry is a served route, that the role really holds the
// permission as a conditional grant, and that the reason is written down. An entry is therefore
// never a way to switch off a check: a role with a plain grant cannot be listed.
//
// Keyed `METHOD /v1/path/:id`, as `describeRoutes()` prints routes.
import type { RoleCode } from '@labconnect/shared';

export interface HandlerRefusal {
  route: string;
  role: RoleCode;
  /** The permission the route declares, whose grant to `role` is conditional. */
  permission: string;
  /** The condition of the grant, and why the handler refuses it. */
  reason: string;
}

const FINANCE_BANK_ONLY =
  'kyc.verify is held by PLATFORM_FINANCE only for bank verification (note 10, condition ' +
  "BANK_VERIFICATION_ONLY); the contract's x-roles for lab claims is PLATFORM_OPS alone (OQ-112), " +
  'so the claim functions in packages/core refuse every role but PLATFORM_OPS.';

export const HANDLER_REFUSALS: readonly HandlerRefusal[] = [
  {
    route: 'GET /v1/admin/claims',
    role: 'PLATFORM_FINANCE',
    permission: 'kyc.verify',
    reason: FINANCE_BANK_ONLY,
  },
  {
    route: 'POST /v1/admin/claims/:id/approve',
    role: 'PLATFORM_FINANCE',
    permission: 'kyc.verify',
    reason: FINANCE_BANK_ONLY,
  },
  {
    route: 'POST /v1/admin/claims/:id/reject',
    role: 'PLATFORM_FINANCE',
    permission: 'kyc.verify',
    reason: FINANCE_BANK_ONLY,
  },
  {
    route: 'POST /v1/admin/claims/:id/letterhead/download-url',
    role: 'PLATFORM_FINANCE',
    permission: 'kyc.verify',
    reason: FINANCE_BANK_ONLY,
  },
];
