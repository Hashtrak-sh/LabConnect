/**
 * The limits of the sign-in flow. They come from AUTHENTICATION_AND_AUTHORISATION.md, the
 * contract descriptions (`auth.yaml`) and the schema (`ck_otp_challenge_attempts`, C-79).
 *
 * None of them has a `config_parameter` key yet (OQ-85), so they are constants here. When a
 * key is added, read it through `ConfigParameters` and keep these as documentation only.
 */
export const IDENTITY_POLICY = {
  /** Digits in an email OTP. */
  otpLength: 6,
  /** An OTP is valid for 10 minutes. */
  otpTtlSeconds: 600,
  /** Wrong guesses allowed per challenge. Equal to the database CHECK (0 to 5). */
  otpMaxAttempts: 5,
  /** `requestOtp`: 5 per 15 minutes per destination. */
  otpRequestsPerDestination: { max: 5, windowSeconds: 900 },
  /** `requestOtp`: 20 per hour per IP address. */
  otpRequestsPerIp: { max: 20, windowSeconds: 3600 },

  /** Access token lifetime (10 minutes). */
  accessTokenTtlSeconds: 600,
  /** A partial (pre-MFA) session lives as long as one access token. */
  partialSessionTtlSeconds: 600,
  /** A full session expires after 12 hours without a refresh... */
  sessionIdleSeconds: 12 * 60 * 60,
  /** ...and in any case 7 days after it started. */
  sessionAbsoluteSeconds: 7 * 24 * 60 * 60,

  /** TOTP, RFC 6238: 30 second steps, 6 digits, one step either side. */
  totpPeriodSeconds: 30,
  totpDigits: 6,
  totpWindowSteps: 1,
  /** Consecutive wrong TOTP codes before the factor locks, and for how long. */
  mfaMaxFailedAttempts: 5,
  mfaLockSeconds: 900,
  recoveryCodeCount: 10,

  /** Step-up: MFA no older than 5 minutes (FR-IAM-04). */
  stepUpMaxAgeSeconds: 300,
} as const;

export const TOTP_ISSUER = 'LabConnect';
