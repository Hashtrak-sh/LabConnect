/**
 * The abuse limits of the lab claim flow (I1-LAB-06). Decided by the product owner on 2026-11-26
 * for the MVP; they may be reopened and may later move to `config_parameter` (not built: they
 * are constants until then, so a change is a code change with a test).
 */
export const CLAIM_LIMITS = {
  /**
   * A claim still `PENDING_OTP` this long after `created_at` is expired. The boundary is
   * inclusive: at exactly 24 hours the claim is expired, one millisecond earlier it is not.
   */
  unverifiedClaimTtlMs: 24 * 60 * 60 * 1000,
  /** Open claims (`PENDING_OTP` not yet expired, or `PENDING_REVIEW`) one person may hold at once. */
  maxOpenClaimsPerUser: 3,
  /** Letterhead upload URLs one claim may ever ask for, whatever became of the files. */
  maxLetterheadUploadsPerClaim: 5,
} as const;
