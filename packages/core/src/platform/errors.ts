import { type ErrorCode, httpStatusOf } from '@labconnect/shared';

export interface CoreErrorOptions {
  /** Safe for end users. Never put SQL, stack traces, secrets or other tenants' data here. */
  detail?: string;
  /** Code-specific details, for example `{ currentState }` (ERROR_HANDLING.md section 3). */
  meta?: Record<string, unknown>;
  /** For `RATE_LIMITED` and `OTP_LOCKED`: becomes the `Retry-After` header. */
  retryAfterSeconds?: number;
  cause?: unknown;
}

/**
 * The base of every typed error thrown by `packages/core`. Core cannot import the API's
 * `DomainError` (and has no Nest), so its modules throw subclasses of this: a code from the
 * catalogue in `@labconnect/shared`, a user-safe detail and optional meta. The API's
 * exception filter turns any `CoreError` into the problem body, exactly as it does a
 * `DomainError`, so a module needs no mapping of its own.
 */
export class CoreError extends Error {
  override name = 'CoreError';
  readonly status: number;
  readonly detail: string | undefined;
  readonly meta: Record<string, unknown> | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    readonly code: ErrorCode,
    options: CoreErrorOptions = {},
  ) {
    super(
      options.detail ?? code,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.status = httpStatusOf(code);
    this.detail = options.detail;
    this.meta = options.meta;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
