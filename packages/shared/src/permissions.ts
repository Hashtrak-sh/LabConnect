// Roles, permission codes and the role → permission matrix.
// Source: docs/01-product/ROLES_AND_PERMISSIONS.md (§1 roles, §2 matrix and its notes).
// test/permissions.doc.test.ts asserts that this file and the document are equal, both ways.
//
// A grant says what the role may attempt. API guards check the role level with
// hasPermission(); a grant that is OWN or CONDITIONAL also has to be enforced by the domain
// service inside the transaction (ROLES_AND_PERMISSIONS.md §3), using grantsFor().

/** Equal to the Prisma enum `RoleCode` (packages/database/prisma/schema/enums.prisma). */
export const ROLE_CODES = [
  'CUSTOMER_ADMIN',
  'CUSTOMER_REQUESTER',
  'CUSTOMER_FINANCE',
  'LAB_MAKER',
  'LAB_CHECKER',
  'PLATFORM_OPS',
  'PLATFORM_DATA_STEWARD',
  'PLATFORM_FINANCE',
  'PLATFORM_ADMIN',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export type OrgType = 'CUSTOMER' | 'LAB' | 'PLATFORM';

/** The MFA column of §1. `OPTIONAL_RECOMMENDED` is "Optional (recommended)". */
export type MfaPolicy = 'REQUIRED' | 'OPTIONAL_RECOMMENDED' | 'OPTIONAL';

export interface RoleDefinition {
  readonly orgType: OrgType;
  /** The short name used in the matrix and the transition table, e.g. `C-Admin`. */
  readonly abbreviation: string;
  readonly mfa: MfaPolicy;
}

export const ROLES: Readonly<Record<RoleCode, RoleDefinition>> = {
  CUSTOMER_ADMIN: { orgType: 'CUSTOMER', abbreviation: 'C-Admin', mfa: 'OPTIONAL_RECOMMENDED' },
  CUSTOMER_REQUESTER: { orgType: 'CUSTOMER', abbreviation: 'C-Req', mfa: 'OPTIONAL' },
  CUSTOMER_FINANCE: { orgType: 'CUSTOMER', abbreviation: 'C-Fin', mfa: 'REQUIRED' },
  LAB_MAKER: { orgType: 'LAB', abbreviation: 'L-Maker', mfa: 'OPTIONAL' },
  LAB_CHECKER: { orgType: 'LAB', abbreviation: 'L-Checker', mfa: 'REQUIRED' },
  PLATFORM_OPS: { orgType: 'PLATFORM', abbreviation: 'P-Ops', mfa: 'REQUIRED' },
  PLATFORM_DATA_STEWARD: { orgType: 'PLATFORM', abbreviation: 'P-Data', mfa: 'REQUIRED' },
  PLATFORM_FINANCE: { orgType: 'PLATFORM', abbreviation: 'P-Fin', mfa: 'REQUIRED' },
  PLATFORM_ADMIN: { orgType: 'PLATFORM', abbreviation: 'P-Admin', mfa: 'REQUIRED' },
};

export function isRoleCode(value: unknown): value is RoleCode {
  return typeof value === 'string' && (ROLE_CODES as readonly string[]).includes(value);
}

/** True when the role cannot be used without an enrolled MFA factor (§1, `MFA_ENROLMENT_REQUIRED`). */
export function roleRequiresMfa(role: RoleCode): boolean {
  return ROLES[role].mfa === 'REQUIRED';
}

export interface PermissionDefinition {
  /** The capability exactly as the matrix row names it. */
  readonly capability: string;
  /** Also available without a session ("also anonymous"). */
  readonly anonymous?: true;
  /** Needs a fresh step-up MFA (the row is marked "(MFA)"). */
  readonly stepUpMfa?: true;
}

/** One permission code per row of the matrix in §2. `booking.decide` is the example §3 uses. */
export const PERMISSIONS = {
  'lab.search': { capability: 'Search labs (also anonymous)', anonymous: true },
  'booking.create_edit': { capability: 'Create / edit booking (REQUESTED)' },
  'booking.cancel': { capability: 'Cancel booking' },
  'counter.respond': { capability: 'Respond to counter-offer' },
  'booking.pay': { capability: 'Pay' },
  'handover.view': { capability: 'View QR labels and drop instructions' },
  'label.print': { capability: 'Print labels' },
  'lab_inbox.view': { capability: 'View lab inbox' },
  'booking.decide': { capability: 'Accept / reject / counter' },
  'lab_profile.manage': { capability: 'Manage profile, prices, slots, hours' },
  'lab_user.manage': { capability: 'Manage lab users' },
  'receipt.record': { capability: 'Scan QR, record receipt' },
  'receipt.approve': { capability: 'Approve receipt / confirm hold' },
  'hold.decide': { capability: 'Decide on hold (proceed/replace/cancel)' },
  'testing.start': { capability: 'Start testing, update ETA' },
  'report.submit': { capability: 'Upload / bind / submit report' },
  'report.publish': {
    capability: 'Approve & publish / return report (MFA)',
    stepUpMfa: true,
  },
  'label_reprint.approve': { capability: 'Approve label reprint' },
  'report.download': { capability: 'Download report' },
  'share_link.manage': { capability: 'Create / revoke share link' },
  'dispute.raise': { capability: 'Raise dispute' },
  'dispute.decide': { capability: 'Decide dispute' },
  'payout.hold_release': { capability: 'Payout hold / release' },
  'refund.approve': { capability: 'Approve refund' },
  'financial_document.view': { capability: 'View invoices / receipts' },
  'org_user.manage': { capability: 'Manage org users and sites' },
  'masterdata.changeset.prepare': { capability: 'Prepare master-data change set' },
  'masterdata.changeset.approve': { capability: 'Approve and publish change set' },
  'kyc.verify': { capability: 'Verify KYC and bank, approve claims' },
  'platform_config.manage': { capability: 'Configure SLAs, policies, fees' },
  'audit_log.view': { capability: 'View audit log' },
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionCode = keyof typeof PERMISSIONS;
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export function isPermissionCode(value: unknown): value is PermissionCode {
  return typeof value === 'string' && Object.hasOwn(PERMISSIONS, value);
}

/**
 * The named conditions behind the ◐ cells, each tied to its numbered note in §2. The domain
 * service enforces them; this file only names them.
 */
export const PERMISSION_CONDITIONS = {
  OPS_ON_BEHALF_OF_CUSTOMER: {
    note: 1,
    description:
      'On behalf of a customer, recorded with on_behalf_of. The customer must still pay.',
  },
  LAB_CHECKER_AFTER_PAYMENT: {
    note: 2,
    description: 'A Checker cancels after payment (EC-20, lab penalty).',
  },
  OPS_WITH_REASON: {
    note: 2,
    description:
      'Ops can cancel at any non-terminal state, with a reason. The transition table covers Ops cancellation up to UNDER_TEST only (OQ-24).',
  },
  REQUESTER_CAN_PAY_SETTING: {
    note: 3,
    description: 'Only if the org setting requester_can_pay is true.',
  },
  OPS_OVERRIDE_UNDECIDED: {
    note: 4,
    description:
      'Override in exceptional cases only, with a reason, visible to the lab. Not in the transition table yet (OQ-24); not built until decided.',
  },
  OPS_MAP_PIN_REVIEW_ONLY: {
    note: 5,
    description: 'Review and approve map-pin changes. No direct price edits.',
  },
  NOT_ON_OWN_MAKER_ITEM: {
    note: 6,
    description:
      'Never on items where the same user was the Maker. Needs step-up MFA for report publication.',
  },
  METADATA_ONLY_UNLESS_BREAK_GLASS: {
    note: 7,
    description:
      'Metadata only by default. The file needs a time-boxed break_glass_grant approved by another PLATFORM_ADMIN, each access logged.',
  },
  OPS_PLACE_HOLD_ONLY: {
    note: 8,
    description: 'Ops can place a hold. PLATFORM_FINANCE releases payouts.',
  },
  OPS_REFUND_UP_TO_THRESHOLD: {
    note: 8,
    description:
      'PLATFORM_FINANCE approves refunds above the configurable threshold (refund.approval_threshold_paise).',
  },
  DIFFERENT_APPROVER_THAN_PREPARER: {
    note: 9,
    description: 'A different steward or PLATFORM_ADMIN must approve (RR-6).',
  },
  BANK_VERIFICATION_ONLY: {
    note: 10,
    description: 'Bank verification needs PLATFORM_FINANCE.',
  },
} as const satisfies Record<string, { note: number; description: string }>;

export type PermissionCondition = keyof typeof PERMISSION_CONDITIONS;

/**
 * ✔ → `ALL`, ○ → `OWN` (own records only), ◐ → `CONDITIONAL` with its named condition.
 * A role that has no grant (— in the matrix) is absent.
 */
export type PermissionGrant =
  | { readonly access: 'ALL' }
  | { readonly access: 'OWN' }
  | { readonly access: 'CONDITIONAL'; readonly condition: PermissionCondition };

const ALL: PermissionGrant = { access: 'ALL' };
const OWN: PermissionGrant = { access: 'OWN' };
function when(condition: PermissionCondition): PermissionGrant {
  return { access: 'CONDITIONAL', condition };
}

/** Every role column of the matrix in one place: ✔ everywhere. */
const EVERY_ROLE: Readonly<Record<RoleCode, PermissionGrant>> = {
  CUSTOMER_ADMIN: ALL,
  CUSTOMER_REQUESTER: ALL,
  CUSTOMER_FINANCE: ALL,
  LAB_MAKER: ALL,
  LAB_CHECKER: ALL,
  PLATFORM_OPS: ALL,
  PLATFORM_DATA_STEWARD: ALL,
  PLATFORM_FINANCE: ALL,
  PLATFORM_ADMIN: ALL,
};

export const PERMISSION_MATRIX: Readonly<
  Record<PermissionCode, Readonly<Partial<Record<RoleCode, PermissionGrant>>>>
> = {
  'lab.search': EVERY_ROLE,
  'booking.create_edit': {
    CUSTOMER_ADMIN: ALL,
    CUSTOMER_REQUESTER: OWN,
    PLATFORM_OPS: when('OPS_ON_BEHALF_OF_CUSTOMER'),
  },
  'booking.cancel': {
    CUSTOMER_ADMIN: ALL,
    CUSTOMER_REQUESTER: OWN,
    LAB_CHECKER: when('LAB_CHECKER_AFTER_PAYMENT'),
    PLATFORM_OPS: when('OPS_WITH_REASON'),
  },
  'counter.respond': { CUSTOMER_ADMIN: ALL, CUSTOMER_REQUESTER: OWN },
  'booking.pay': {
    CUSTOMER_ADMIN: ALL,
    CUSTOMER_REQUESTER: when('REQUESTER_CAN_PAY_SETTING'),
    CUSTOMER_FINANCE: ALL,
  },
  'handover.view': {
    CUSTOMER_ADMIN: ALL,
    CUSTOMER_REQUESTER: OWN,
    LAB_MAKER: ALL,
    LAB_CHECKER: ALL,
    PLATFORM_OPS: ALL,
  },
  'label.print': { CUSTOMER_ADMIN: ALL, CUSTOMER_REQUESTER: OWN, LAB_MAKER: ALL, LAB_CHECKER: ALL },
  'lab_inbox.view': { LAB_MAKER: ALL, LAB_CHECKER: ALL, PLATFORM_OPS: ALL },
  'booking.decide': { LAB_CHECKER: ALL, PLATFORM_OPS: when('OPS_OVERRIDE_UNDECIDED') },
  'lab_profile.manage': { LAB_CHECKER: ALL, PLATFORM_OPS: when('OPS_MAP_PIN_REVIEW_ONLY') },
  'lab_user.manage': { LAB_CHECKER: ALL, PLATFORM_OPS: ALL },
  'receipt.record': { LAB_MAKER: ALL },
  'receipt.approve': { LAB_CHECKER: when('NOT_ON_OWN_MAKER_ITEM') },
  'hold.decide': { CUSTOMER_ADMIN: ALL, CUSTOMER_REQUESTER: OWN },
  'testing.start': { LAB_MAKER: ALL },
  'report.submit': { LAB_MAKER: ALL },
  'report.publish': { LAB_CHECKER: when('NOT_ON_OWN_MAKER_ITEM') },
  'label_reprint.approve': { LAB_CHECKER: when('NOT_ON_OWN_MAKER_ITEM') },
  'report.download': {
    CUSTOMER_ADMIN: ALL,
    CUSTOMER_REQUESTER: OWN,
    CUSTOMER_FINANCE: ALL,
    LAB_MAKER: ALL,
    LAB_CHECKER: ALL,
    PLATFORM_OPS: when('METADATA_ONLY_UNLESS_BREAK_GLASS'),
  },
  'share_link.manage': { CUSTOMER_ADMIN: ALL, CUSTOMER_REQUESTER: OWN, CUSTOMER_FINANCE: ALL },
  'dispute.raise': {
    CUSTOMER_ADMIN: ALL,
    CUSTOMER_REQUESTER: OWN,
    CUSTOMER_FINANCE: ALL,
    LAB_CHECKER: ALL,
  },
  'dispute.decide': { PLATFORM_OPS: ALL },
  'payout.hold_release': { PLATFORM_OPS: when('OPS_PLACE_HOLD_ONLY'), PLATFORM_FINANCE: ALL },
  'refund.approve': { PLATFORM_OPS: when('OPS_REFUND_UP_TO_THRESHOLD'), PLATFORM_FINANCE: ALL },
  'financial_document.view': {
    CUSTOMER_ADMIN: ALL,
    CUSTOMER_FINANCE: ALL,
    LAB_CHECKER: ALL,
    PLATFORM_OPS: ALL,
    PLATFORM_FINANCE: ALL,
  },
  'org_user.manage': {
    CUSTOMER_ADMIN: ALL,
    LAB_CHECKER: ALL,
    PLATFORM_OPS: ALL,
    PLATFORM_ADMIN: ALL,
  },
  'masterdata.changeset.prepare': { PLATFORM_DATA_STEWARD: ALL },
  'masterdata.changeset.approve': {
    PLATFORM_DATA_STEWARD: when('DIFFERENT_APPROVER_THAN_PREPARER'),
    PLATFORM_ADMIN: ALL,
  },
  'kyc.verify': { PLATFORM_OPS: ALL, PLATFORM_FINANCE: when('BANK_VERIFICATION_ONLY') },
  'platform_config.manage': { PLATFORM_ADMIN: ALL },
  'audit_log.view': {
    PLATFORM_OPS: ALL,
    PLATFORM_DATA_STEWARD: ALL,
    PLATFORM_FINANCE: ALL,
    PLATFORM_ADMIN: ALL,
  },
};

/** The grant one role holds for a permission, or `undefined` when the matrix says —. */
export function grantOf(role: RoleCode, permission: PermissionCode): PermissionGrant | undefined {
  return PERMISSION_MATRIX[permission][role];
}

/** The grants the given roles hold for a permission, one per role that holds it. */
export function grantsFor(
  roles: readonly RoleCode[],
  permission: PermissionCode,
): { readonly role: RoleCode; readonly grant: PermissionGrant }[] {
  return roles.flatMap((role) => {
    const grant = grantOf(role, permission);
    return grant ? [{ role, grant }] : [];
  });
}

/**
 * True when at least one of the roles holds the permission in any form (✔, ○ or ◐). This is the
 * role-level check of an API guard: an `OWN` or `CONDITIONAL` grant still has to be enforced
 * by the domain service (see grantsFor()).
 */
export function hasPermission(roles: readonly RoleCode[], permission: PermissionCode): boolean {
  return grantsFor(roles, permission).length > 0;
}

/** True when at least one of the roles holds the permission without any qualifier (✔). */
export function hasUnconditionalPermission(
  roles: readonly RoleCode[],
  permission: PermissionCode,
): boolean {
  return grantsFor(roles, permission).some(({ grant }) => grant.access === 'ALL');
}

/** Every permission a role holds in any form. */
export function permissionsOf(role: RoleCode): PermissionCode[] {
  return PERMISSION_CODES.filter((permission) => grantOf(role, permission) !== undefined);
}
