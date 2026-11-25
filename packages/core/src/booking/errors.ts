import { type ErrorCode, httpStatusOf } from '@labconnect/shared';

export interface BookingErrorOptions {
  /** Safe for end users. Never put SQL, stack traces or other tenants' data here. */
  detail?: string;
  /** Code-specific details, for example `{ currentState }` (ERROR_HANDLING.md section 3). */
  meta?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * The typed error of the booking module. `packages/core` cannot import `DomainError` from
 * `apps/api` (and has no Nest), so it throws this framework-free twin: the same `code`
 * from the catalogue in `@labconnect/shared`, the same `meta`. The API's exception filter
 * turns it into the problem body exactly as it does a `DomainError`: see `isBookingError`.
 */
export class BookingError extends Error {
  override name = 'BookingError';
  readonly status: number;
  readonly detail: string | undefined;
  readonly meta: Record<string, unknown> | undefined;

  constructor(
    readonly code: ErrorCode,
    options: BookingErrorOptions = {},
  ) {
    super(
      options.detail ?? code,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.status = httpStatusOf(code);
    this.detail = options.detail;
    this.meta = options.meta;
  }
}

/** True for a `BookingError`, also when it comes from another copy of the package. */
export function isBookingError(value: unknown): value is BookingError {
  return (
    value instanceof BookingError ||
    (value instanceof Error &&
      value.name === 'BookingError' &&
      typeof (value as { code?: unknown }).code === 'string')
  );
}
