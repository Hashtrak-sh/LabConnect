import type { ErrorCode } from '@labconnect/shared';

export interface IdentityErrorOptions {
  /** Safe for end users. Never put a code, a token or an email address here. */
  detail?: string;
  meta?: Record<string, unknown>;
  /** For `RATE_LIMITED` and `OTP_LOCKED`: becomes the `Retry-After` header. */
  retryAfterSeconds?: number;
  cause?: unknown;
}

/**
 * A failure of an identity operation that carries a catalogued code (ERROR_HANDLING.md section
 * 2). `packages/core` does not know the HTTP layer; the API maps this to its `DomainError`.
 *
 * Failures that must be *saved* (a wrong code counts as an attempt, a reused refresh token
 * revokes its family) are not thrown from inside the transaction: the functions return an
 * outcome, the caller commits, and only then raises the error. A thrown error rolls the
 * transaction back.
 */
export class IdentityError extends Error {
  override name = 'IdentityError';
  readonly detail: string | undefined;
  readonly meta: Record<string, unknown> | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    readonly code: ErrorCode,
    options: IdentityErrorOptions = {},
  ) {
    super(
      options.detail ?? code,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.detail = options.detail;
    this.meta = options.meta;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/** Where a request came from, for audit rows and session records. */
export interface RequestMeta {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/** The request details an audit entry takes, leaving out what is absent. */
export function auditMeta(meta: RequestMeta): RequestMeta {
  return {
    ...(meta.requestId !== undefined && { requestId: meta.requestId }),
    ...(meta.ipAddress !== undefined && { ipAddress: meta.ipAddress }),
    ...(meta.userAgent !== undefined && { userAgent: meta.userAgent }),
  };
}
