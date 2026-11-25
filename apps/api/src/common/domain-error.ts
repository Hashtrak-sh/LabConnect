import { type ErrorCode, httpStatusOf } from '@labconnect/shared';

/** One field-level problem (`errors[]` in the problem body). */
export interface ProblemIssue {
  path: string;
  code: string;
  message: string;
}

export interface DomainErrorOptions {
  /** Safe for end users. Never put stack traces, SQL or other tenants' data here. */
  detail?: string;
  /** Code-specific details, for example `{ currentState }`. */
  meta?: Record<string, unknown>;
  errors?: readonly ProblemIssue[];
  cause?: unknown;
}

/**
 * The typed error domain code throws (ERROR_HANDLING.md §3). The HTTP status comes from the
 * catalogue in `@labconnect/shared`; the global exception filter maps it to the problem body.
 */
export class DomainError extends Error {
  override name = 'DomainError';
  readonly status: number;
  readonly detail: string | undefined;
  readonly meta: Record<string, unknown> | undefined;
  readonly errors: readonly ProblemIssue[] | undefined;

  constructor(
    readonly code: ErrorCode,
    options: DomainErrorOptions = {},
  ) {
    super(
      options.detail ?? code,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.status = httpStatusOf(code);
    this.detail = options.detail;
    this.meta = options.meta;
    this.errors = options.errors;
  }
}
