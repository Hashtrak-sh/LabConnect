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

/**
 * Roles that a SESSION-ONLY route (`@Authorised({ noPermissionRequired: true })`: any signed-in user
 * passes the guard) refuses in the handler with 403 FORBIDDEN. There is no permission and so no
 * conditional grant to point at; the matrix test expects `deny` for these cells, checks that each
 * entry is a served session-only route, and that the reason is written down.
 */
export interface SessionOnlyRefusal {
  route: string;
  roles: readonly RoleCode[];
  reason: string;
}

const PLATFORM_ROLES: readonly RoleCode[] = [
  'PLATFORM_OPS',
  'PLATFORM_FINANCE',
  'PLATFORM_DATA_STEWARD',
  'PLATFORM_ADMIN',
];

const NO_CLAIM_FOR_STAFF =
  'A lab claim belongs to the user who started it, and platform staff cannot start one (RR-5, ' +
  'startLabClaim): the claimant reads refuse them with 403 by the actor and by the user row, ' +
  'as startLabClaim does, before any claim is read.';

const NOT_A_CUSTOMER: readonly RoleCode[] = ['LAB_MAKER', 'LAB_CHECKER', ...PLATFORM_ROLES];

const CUSTOMER_SITES_FOR_MEMBERS =
  'Every member of a customer organisation may read its sites (contract: 403 when the active ' +
  'membership is not a customer membership); a lab or platform membership has no customer sites, ' +
  'so requireCustomerOrganisation refuses it before any site is read (I2-CUS-03).';

const BOOKINGS_FOR_PARTIES =
  'A booking is read by a member of its customer or its lab organisation; platform staff use ' +
  '/admin/bookings (contract: 403 for a platform membership), so bookingVisibility refuses them ' +
  'before any booking is read (I3-SHR-01).';

export const SESSION_ONLY_REFUSALS: readonly SessionOnlyRefusal[] = [
  { route: 'GET /v1/bookings', roles: PLATFORM_ROLES, reason: BOOKINGS_FOR_PARTIES },
  { route: 'GET /v1/bookings/:id', roles: PLATFORM_ROLES, reason: BOOKINGS_FOR_PARTIES },
  { route: 'GET /v1/lab/claims', roles: PLATFORM_ROLES, reason: NO_CLAIM_FOR_STAFF },
  { route: 'GET /v1/lab/claims/:id', roles: PLATFORM_ROLES, reason: NO_CLAIM_FOR_STAFF },
  { route: 'GET /v1/customer/sites', roles: NOT_A_CUSTOMER, reason: CUSTOMER_SITES_FOR_MEMBERS },
  {
    route: 'GET /v1/customer/sites/:id',
    roles: NOT_A_CUSTOMER,
    reason: CUSTOMER_SITES_FOR_MEMBERS,
  },
];

const OPS_CANNOT_DECIDE =
  'booking.decide is held by PLATFORM_OPS only to override an undecided request ' +
  '(OPS_OVERRIDE_UNDECIDED); Ops cannot accept, reject or counter for a lab (OQ-24, the contract: ' +
  "a LAB_CHECKER assigned to the booking's site), so BookingsService.decide refuses every role " +
  'but LAB_CHECKER (I3-LAB-01).';

const INBOX_FOR_LAB_MEMBERS =
  'lab_inbox.view is held by PLATFORM_OPS only through the admin console (OPS_VIA_ADMIN_CONSOLE, ' +
  "note 11): the lab inbox lists the caller's assigned lab sites, and the contract answers 403 " +
  'to any role but LAB_MAKER and LAB_CHECKER, so getLabInbox refuses Ops before any booking is ' +
  'read (I3-LAB-01).';

const CANCEL_BEFORE_HANDOVER =
  'booking.cancel is conditional for LAB_CHECKER (after payment, from handover: T-26/T-27, ' +
  'not built yet) and for PLATFORM_OPS (with a reason, through /admin/bookings/{id}/cancel); ' +
  'the customer route builds T-25 only, so BookingsService.cancel refuses both with 403 before ' +
  'the booking is read (I3-LAB-01).';

export const HANDLER_REFUSALS: readonly HandlerRefusal[] = [
  ...(['LAB_CHECKER', 'PLATFORM_OPS'] as const).map((role) => ({
    route: 'POST /v1/bookings/:id/cancel',
    role,
    permission: 'booking.cancel',
    reason: CANCEL_BEFORE_HANDOVER,
  })),
  {
    route: 'GET /v1/lab/inbox',
    role: 'PLATFORM_OPS',
    permission: 'lab_inbox.view',
    reason: INBOX_FOR_LAB_MEMBERS,
  },
  ...['accept', 'reject', 'counter'].map((action) => ({
    route: `POST /v1/bookings/:id/${action}`,
    role: 'PLATFORM_OPS' as const,
    permission: 'booking.decide',
    reason: OPS_CANNOT_DECIDE,
  })),
  {
    route: 'GET /v1/admin/claims',
    role: 'PLATFORM_FINANCE',
    permission: 'kyc.verify',
    reason: FINANCE_BANK_ONLY,
  },
  {
    route: 'GET /v1/admin/claims/:id',
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
