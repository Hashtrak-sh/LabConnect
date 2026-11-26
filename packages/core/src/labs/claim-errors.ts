import { CoreError } from '../platform/errors.js';

/**
 * A failure of a lab claim operation that carries a catalogued code (ERROR_HANDLING.md section 2).
 * The API's exception filter turns any `CoreError` into the problem body and sets `Retry-After`
 * from `retryAfterSeconds`, so the labs module needs no mapping of its own.
 *
 * As in identity, a failure that must be *saved* (a wrong code counts as an attempt) is not thrown
 * from inside the transaction: `verifyLabClaimOtp` returns it as an outcome, the caller commits,
 * and only then raises the error (`claimOtpFailure`).
 */
export class LabClaimError extends CoreError {
  override name = 'LabClaimError';
}

/**
 * The refusal of an operation on the caller's own claim that was found stale (I1-LAB-06: still
 * `PENDING_OTP` 24 hours after it was created). The claim has been set to `EXPIRED` and that is
 * *committed*, so the function returns this as an outcome (`{ ok: false, reason: 'CLAIM_EXPIRED' }`)
 * and the caller raises `claimExpiredError()` after the commit.
 */
export function claimExpiredError(): LabClaimError {
  return new LabClaimError('INVALID_STATE_TRANSITION', {
    detail: 'This claim has expired. Start a new claim.',
    meta: { currentState: 'EXPIRED' },
  });
}

/** What the caller of `verifyLabClaimOtp` raises after it has committed a rejected code. */
export function claimOtpFailure(
  reason: 'INVALID' | 'EXPIRED' | 'LOCKED' | 'CLAIM_EXPIRED',
): LabClaimError {
  switch (reason) {
    case 'CLAIM_EXPIRED':
      return claimExpiredError();
    case 'EXPIRED':
      return new LabClaimError('OTP_EXPIRED', {
        detail: 'This code has expired. Ask for a new one.',
      });
    case 'LOCKED':
      return new LabClaimError('OTP_LOCKED', {
        detail: 'Too many wrong codes. Ask for a new one.',
      });
    case 'INVALID':
      return new LabClaimError('OTP_INVALID', { detail: 'The code is not correct.' });
  }
}
