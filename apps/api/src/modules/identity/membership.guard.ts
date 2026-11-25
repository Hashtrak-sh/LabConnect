import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { IdentityError } from '@labconnect/core';
import { DomainError } from '../../common/domain-error.js';
import type { RequestWithActor } from './current-actor.js';
import { toDomainError } from './identity-errors.js';
import { IdentityService } from './identity.service.js';

/**
 * The second guard of AUTHENTICATION_AND_AUTHORISATION.md section 3, after `AuthGuard`: resolves
 * the membership the request acts as and builds the `CurrentActor` from the database (roles, lab
 * sites, organisation), then stores it on the request (read it with `@CurrentActor()`).
 *
 * The organisation is the one of the session's active membership. `X-Active-Membership` may pick
 * another of the user's *own active* memberships for this request, else `404 NOT_FOUND`. Nothing
 * else (no path, query or body value, no other header) can change who the actor is.
 *
 * It asks the database on every request, so a deactivated membership, a role that was revoked or
 * a suspended organisation takes effect at once, not when the 10-minute access token runs out
 * (`403 FORBIDDEN`). A user with no membership gets an actor with no organisation and no
 * permissions. A role that requires MFA with no MFA done in this session is `401 STEP_UP_REQUIRED`.
 */
@Injectable()
export class MembershipGuard implements CanActivate {
  constructor(private readonly identity: IdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithActor>();
    // No session means AuthGuard did not run first: fail closed.
    if (!request.authSession) throw new DomainError('UNAUTHENTICATED');
    const header = request.headers['x-active-membership'];
    // A repeated header arrives as an array: it names nothing the user owns.
    const requested = Array.isArray(header) ? '' : header;
    try {
      request.actor = await this.identity.resolveActor(request.authSession, requested);
    } catch (error) {
      if (error instanceof IdentityError) throw toDomainError(error);
      throw error;
    }
    return true;
  }
}
