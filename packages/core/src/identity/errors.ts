import { CoreError, type CoreErrorOptions } from '../platform/errors.js';

export type IdentityErrorOptions = CoreErrorOptions;

/**
 * A failure of an identity operation that carries a catalogued code (ERROR_HANDLING.md section
 * 2). `packages/core` does not know the HTTP layer; the API maps this to its `DomainError`.
 *
 * Failures that must be *saved* (a wrong code counts as an attempt, a reused refresh token
 * revokes its family) are not thrown from inside the transaction: the functions return an
 * outcome, the caller commits, and only then raises the error. A thrown error rolls the
 * transaction back.
 */
export class IdentityError extends CoreError {
  override name = 'IdentityError';
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
