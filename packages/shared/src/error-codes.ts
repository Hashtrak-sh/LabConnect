// The error code catalogue. Source: docs/04-api/ERROR_HANDLING.md §2.
// test/error-codes.doc.test.ts asserts equality with that table and with the OpenAPI
// `components.schemas.ErrorCode` enum in packages/api-contract.
// The document gives no per-code title, so none is defined here.

/** Code → HTTP status, in the order of ERROR_HANDLING.md §2. */
export const ERROR_CODES = {
  VALIDATION_FAILED: { status: 422 },
  UNAUTHENTICATED: { status: 401 },
  STEP_UP_REQUIRED: { status: 401 },
  MFA_ENROLMENT_REQUIRED: { status: 403 },
  FORBIDDEN: { status: 403 },
  SELF_APPROVAL_FORBIDDEN: { status: 403 },
  FOUR_EYES_REQUIRED: { status: 403 },
  NOT_FOUND: { status: 404 },
  INVALID_STATE_TRANSITION: { status: 409 },
  CONCURRENT_MODIFICATION: { status: 412 },
  REQUEST_IN_PROGRESS: { status: 409 },
  IDEMPOTENCY_KEY_REUSED: { status: 422 },
  SLOT_UNAVAILABLE: { status: 409 },
  SITE_NOT_BOOKABLE: { status: 422 },
  SCOPE_LINE_NOT_BOOKABLE: { status: 422 },
  OPEN_BOOKING_LIMIT: { status: 429 },
  COUNTER_FIELD_NOT_ALLOWED: { status: 422 },
  PAYMENT_AMOUNT_MISMATCH: { status: 422 },
  QR_INVALID_SIGNATURE: { status: 422 },
  QR_WRONG_SITE: { status: 422 },
  PACKAGE_ALREADY_RECEIVED: { status: 409 },
  PACKAGE_VOIDED: { status: 422 },
  FILE_NOT_CLEAN: { status: 422 },
  REPORT_PARAMETER_NOT_BOOKED: { status: 422 },
  ULR_NOT_UNIQUE: { status: 409 },
  DISPUTE_WINDOW_CLOSED: { status: 422 },
  RATE_LIMITED: { status: 429 },
  OTP_INVALID: { status: 422 },
  OTP_EXPIRED: { status: 422 },
  OTP_LOCKED: { status: 429 },
  GATEWAY_UNAVAILABLE: { status: 503 },
  INTERNAL_ERROR: { status: 500 },
} as const satisfies Record<string, { status: number }>;

export type ErrorCode = keyof typeof ERROR_CODES;

export const ERROR_CODE_LIST = Object.keys(ERROR_CODES) as ErrorCode[];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CODES, value);
}

export function httpStatusOf(code: ErrorCode): number {
  return ERROR_CODES[code].status;
}
