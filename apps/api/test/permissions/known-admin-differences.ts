// `/admin` operations whose `x-roles` in the contract and whose permission in the shared map
// disagree today (OQ-112), keyed as the contract writes them. Seeded from the report of
// `test/admin-roles-permissions.spec.ts` (10 of 73 operations), plus the three lab claim operations
// (I2-ADM-01 to 03, listed last). Rule C ignores a listed operation
// and fails when an unlisted route disagrees, so a NEW disagreement cannot slip in. It also fails
// when a listed operation starts to agree: remove it then. Settling OQ-112 empties this list.
export const KNOWN_ADMIN_DIFFERENCES: readonly string[] = [
  // Finance-only operations: the permission code they would use (payout.hold_release,
  // refund.approve) is also held by PLATFORM_OPS, who may only place a hold or approve below the
  // threshold. The service refuses the roles x-roles leaves out.
  'POST /admin/bank-accounts/{id}/verify',
  'DELETE /admin/bookings/{id}/payout-holds/{holdId}',
  'GET /admin/payouts',
  'POST /admin/payouts/{id}/release',
  'GET /admin/reconciliation/settlements',
  'POST /admin/reconciliation/settlements',
  'POST /admin/reconciliation/settlements/upload-url',
  'GET /admin/reconciliation/exceptions',
  'GET /admin/exports/{kind}',
  // x-roles names steward and Ops; audit_log.view is held by four platform roles.
  'GET /admin/records/{type}/{id}/versions',
  // Lab claims (I2-ADM-01 to 03): x-roles is PLATFORM_OPS alone, but the only permission that names
  // claims, kyc.verify, is also held by PLATFORM_FINANCE (condition BANK_VERIFICATION_ONLY, note
  // 10). The handler refuses Finance with 403 before it reads the request, and the matrix test
  // expects that refusal (test/permissions/handler-refusals.ts).
  'GET /admin/claims',
  'POST /admin/claims/{id}/approve',
  'POST /admin/claims/{id}/reject',
];
