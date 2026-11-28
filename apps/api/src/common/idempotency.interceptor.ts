import { createHash } from 'node:crypto';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import {
  CoreError,
  hashRequest,
  type IdempotencyClaim,
  IdempotencyService,
  isValidIdempotencyKey,
} from '@labconnect/core';
import type { ErrorCode } from '@labconnect/shared';
import type { Request } from 'express';
import { IdempotencyLease } from './idempotency-lease.js';
import {
  catchError,
  concatMap,
  finalize,
  from,
  mergeMap,
  type Observable,
  of,
  throwError,
} from 'rxjs';
import { DomainError, type ProblemIssue } from './domain-error.js';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

// Nest's metadata key for `@HttpCode()`. The interceptor runs before Nest applies the status, so
// it reads the status the handler is declared to answer with.
const HTTP_CODE_METADATA = '__httpCode__';
const MAX_ROUTE_LENGTH = 200;

// A business answer is stored and replayed. 401 and 403 are decided before the handler and depend
// on the session; 400 is a malformed request; 412 depends on `If-Match`, which is not part of the
// request hash; 429 passes with time. 5xx and unmapped errors are never stored.
const STORED_ERROR_STATUSES: ReadonlySet<number> = new Set([404, 409, 422]);

/**
 * The request as the guards of `@Authorised()` leave it. Read-only. The user, the acting
 * organisation and the active membership all come from the resolved actor and from nowhere else:
 * a bare session without an actor is refused, because it would say nothing about the organisation.
 */
type GuardedRequest = Request & {
  actor?: { userId: string; orgId: string | null; membershipId: string | null };
};

interface StoredProblem {
  code: ErrorCode;
  detail?: string;
  meta?: Record<string, unknown>;
  errors?: readonly ProblemIssue[];
}

/**
 * Makes a POST idempotent (API_CONVENTIONS.md section 5). Apply after `@Authorised()`:
 *
 * ```ts
 * @Post(':id/verify-otp')
 * @Authorised({ permission: '...' })
 * @Idempotent()
 * ```
 *
 * The scope is (key, user, concrete route); the request hash adds the body, the acting organisation,
 * the active membership and the query, so the same key meaning something else is a 422. Only for authenticated routes: with no user on the
 * request it refuses with a 500 and never runs the handler (anonymous routes need OQ-42). Never
 * for `/auth/*` (OQ-33): a stored response there would hold tokens at rest.
 */
export const Idempotent = (): MethodDecorator & ClassDecorator =>
  UseInterceptors(IdempotencyInterceptor);

/** Method and concrete path without the query. A path too long for the column is hashed. */
export function routeOf(request: Pick<Request, 'method' | 'path'>): string {
  const path = request.path.length > 1 ? request.path.replace(/\/+$/, '') : request.path;
  const route = `${request.method.toUpperCase()} ${path}`;
  if (route.length <= MAX_ROUTE_LENGTH) return route;
  return `${route.slice(0, 150)}#${createHash('sha256').update(route).digest('hex').slice(0, 32)}`;
}

/** The raw query string without the `?` (empty when there is none). */
function queryOf(request: Pick<Request, 'originalUrl'>): string {
  const at = request.originalUrl.indexOf('?');
  return at === -1 ? '' : request.originalUrl.slice(at + 1);
}

function storedProblemOf(error: unknown): { status: number; body: StoredProblem } | undefined {
  if (!(error instanceof DomainError) && !(error instanceof CoreError)) return undefined;
  if (!STORED_ERROR_STATUSES.has(error.status)) return undefined;
  if (error.code === 'REQUEST_IN_PROGRESS' || error.code === 'IDEMPOTENCY_KEY_REUSED') {
    return undefined;
  }
  return {
    status: error.status,
    body: {
      code: error.code,
      ...(error.detail !== undefined && { detail: error.detail }),
      ...(error.meta !== undefined && { meta: error.meta }),
      ...(error.errors !== undefined && { errors: error.errors }),
    },
  };
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly idempotency: IdempotencyService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const actor = request.actor;
    if (actor === undefined) {
      // A programming error, not a client error: fail closed, loudly, before anything runs. A
      // session alone is not enough: the organisation and membership are part of the request hash.
      throw new Error('@Idempotent() needs an authenticated user: put it behind @Authorised().');
    }
    const userId = actor.userId;
    const key = request.headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()];
    if (!isValidIdempotencyKey(key)) {
      // Names the header and the rule, never the value.
      throw new DomainError('VALIDATION_FAILED', {
        status: 400,
        detail:
          key === undefined
            ? `The ${IDEMPOTENCY_KEY_HEADER} header is required on this request: 1 to 100 visible ASCII characters.`
            : `The ${IDEMPOTENCY_KEY_HEADER} header is not valid: it must be 1 to 100 visible ASCII characters, sent once.`,
      });
    }

    const begin = await this.idempotency.begin({
      key,
      actorUserId: userId,
      route: routeOf(request),
      // The one place the parts are assembled. Organisation and membership are what the guards
      // resolved onto the actor (never a raw header); the query is this request's raw string.
      requestHash: hashRequest({
        body: request.body,
        organisationId: actor.orgId,
        membershipId: actor.membershipId,
        query: queryOf(request),
      }),
    });
    switch (begin.kind) {
      case 'in_progress':
        throw new CoreError('REQUEST_IN_PROGRESS', {
          detail: 'A request with this Idempotency-Key is still being processed.',
        });
      case 'reused':
        throw new CoreError('IDEMPOTENCY_KEY_REUSED', {
          detail: 'This Idempotency-Key was already used for a different request.',
        });
      case 'replay': {
        const { status, body } = begin.response;
        if (status < 400) return of(body ?? undefined);
        // Rebuilt from the stored fields, so the filter writes the problem with the current
        // request id, and the status and title come from the catalogue as for any other error.
        const stored = body as StoredProblem;
        throw new DomainError(stored.code, {
          ...(stored.detail !== undefined && { detail: stored.detail }),
          ...(stored.meta !== undefined && { meta: stored.meta }),
          ...(stored.errors !== undefined && { errors: stored.errors }),
        });
      }
      case 'started': {
        const status = this.successStatus(context, request.method);
        // The lease renews the lock while the handler runs. `stop()` ends the timer on success and
        // on error (and hands out the latest claim); `finalize` ends it if the stream is
        // unsubscribed or completes without a value.
        const lease = new IdempotencyLease(this.idempotency, begin.claim, this.logger);
        return next.handle().pipe(
          concatMap((value: unknown) =>
            from(lease.stop()).pipe(
              concatMap((claim) => this.finish(claim, { status, body: toJson(value) })),
              mergeMap(() => of(value)),
            ),
          ),
          catchError((error: unknown) => {
            const problem = storedProblemOf(error);
            return from(lease.stop()).pipe(
              concatMap((claim) => (problem ? this.finish(claim, problem) : this.release(claim))),
              mergeMap(() => throwError(() => error)),
            );
          }),
          finalize(() => {
            lease.halt();
          }),
        );
      }
    }
  }

  private successStatus(context: ExecutionContext, method: string): number {
    const declared = Reflect.getMetadata(HTTP_CODE_METADATA, context.getHandler()) as
      number | undefined;
    return declared ?? (method.toUpperCase() === 'POST' ? 201 : 200);
  }

  /** A failure to store must not turn a done operation into an error: log it, with no content. */
  private async finish(
    claim: IdempotencyClaim,
    response: { status: number; body: unknown },
  ): Promise<void> {
    try {
      await this.idempotency.complete(claim, response);
    } catch (error) {
      // Only the error's name: a database error message can quote what was being written.
      this.logger.error(
        `Could not store an idempotent response (${errorName(error)}); the record stays IN_PROGRESS until it is taken over.`,
      );
    }
  }

  private async release(claim: IdempotencyClaim): Promise<void> {
    try {
      await this.idempotency.abandon(claim);
    } catch (error) {
      this.logger.error(
        `Could not release an idempotency key (${errorName(error)}); it stays IN_PROGRESS until it is taken over.`,
      );
    }
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}

/** What the client receives, as JSON: the stored body and the replay are the same value. */
function toJson(value: unknown): unknown {
  return value === undefined ? null : (JSON.parse(JSON.stringify(value)) as unknown);
}
