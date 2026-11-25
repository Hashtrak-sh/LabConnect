import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { IdentityError } from '@labconnect/core';
import type { Response } from 'express';
import { catchError, type Observable, throwError } from 'rxjs';
import { DomainError } from '../../common/domain-error.js';

/** Maps the core's `IdentityError` to the API's `DomainError` (same catalogued code, same meta). */
export function toDomainError(error: IdentityError): DomainError {
  return new DomainError(error.code, {
    ...(error.detail !== undefined && { detail: error.detail }),
    ...((error.meta !== undefined || error.retryAfterSeconds !== undefined) && {
      meta: {
        ...error.meta,
        ...(error.retryAfterSeconds !== undefined && {
          retryAfterSeconds: error.retryAfterSeconds,
        }),
      },
    }),
    cause: error,
  });
}

/**
 * Turns an `IdentityError` thrown by a handler into the problem response, and sets
 * `Retry-After` on a 429 (ERROR_HANDLING.md section 2). Anything else passes through to the
 * global filter unchanged.
 */
@Injectable()
export class IdentityErrorInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (!(error instanceof IdentityError)) return throwError(() => error);
        if (error.retryAfterSeconds !== undefined && !response.headersSent) {
          response.setHeader('Retry-After', String(error.retryAfterSeconds));
        }
        return throwError(() => toDomainError(error));
      }),
    );
  }
}
