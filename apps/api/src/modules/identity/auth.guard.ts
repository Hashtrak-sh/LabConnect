import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IdentityError } from '@labconnect/core';
import type { Request } from 'express';
import { DomainError } from '../../common/domain-error.js';
import { toDomainError } from './identity-errors.js';
import { type AuthenticatedSession, IdentityService } from './identity.service.js';

const ALLOW_PARTIAL_SESSION = 'identity:allowPartialSession';

/**
 * Lets a handler accept a partial (pre-MFA) session. Only `/auth/mfa/*` and `/auth/logout` use
 * it (the contract's `bearerAuth` description); every other handler refuses a partial token.
 */
export const AllowPartialSession = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_PARTIAL_SESSION, true);

type RequestWithSession = Request & { authSession?: AuthenticatedSession };

function bearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (header === undefined) return undefined;
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header);
  return match?.[1];
}

/**
 * The first guard of AUTHENTICATION_AND_AUTHORISATION.md section 3: a valid access token
 * whose session is not revoked. It verifies the token (signature, expiry, issuer, audience),
 * then asks the database whether the session is still alive on every request, so a logout, a
 * revocation or a disabled user takes effect at once and not when the 10-minute token runs
 * out. Every failure is the same `401 UNAUTHENTICATED`: it does not say which check failed.
 *
 * It stores the session on the request; read it with `@CurrentSession()`. The guards that
 * come after it (membership, permission, step-up) belong to task P3-04.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly identity: IdentityService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithSession>();
    const token = bearerToken(request);
    if (token === undefined) throw new DomainError('UNAUTHENTICATED');

    let session: AuthenticatedSession;
    try {
      session = await this.identity.authenticate(token);
    } catch (error) {
      if (error instanceof IdentityError) throw toDomainError(error);
      throw error;
    }

    const allowPartial = this.reflector.getAllAndOverride<boolean | undefined>(
      ALLOW_PARTIAL_SESSION,
      [context.getHandler(), context.getClass()],
    );
    if (session.partial && allowPartial !== true) throw new DomainError('UNAUTHENTICATED');

    request.authSession = session;
    return true;
  }
}

/** The authenticated session of the request. Use only on routes behind `AuthGuard`. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedSession => {
    const session = context.switchToHttp().getRequest<RequestWithSession>().authSession;
    if (!session) throw new DomainError('UNAUTHENTICATED');
    return session;
  },
);
