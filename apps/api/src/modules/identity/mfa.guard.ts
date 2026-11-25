import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IdentityError } from '@labconnect/core';
import { DomainError } from '../../common/domain-error.js';
import type { RequestWithActor } from './current-actor.js';
import { toDomainError } from './identity-errors.js';
import { IdentityService } from './identity.service.js';

const STEP_UP = 'identity:stepUp';

/** `maxAgeSeconds: undefined` is the default of 5 minutes (`IDENTITY_POLICY.stepUpMaxAgeSeconds`). */
interface StepUpRequirement {
  readonly maxAgeSeconds: number | undefined;
}

/**
 * The route needs a fresh MFA: it must have succeeded in this session no more than
 * `maxAgeSeconds` ago (default 300). Otherwise `401 STEP_UP_REQUIRED` with `meta.maxAgeSeconds`,
 * and the client calls `/auth/mfa/verify` with its full session and retries. Declare it per
 * endpoint (OQ-39): report publish (T-21), bank account change, payout release, refund approval
 * above the threshold, break-glass access, platform role changes (AUTHENTICATION section 2).
 */
export const RequireStepUp = (maxAgeSeconds?: number): MethodDecorator & ClassDecorator => {
  if (maxAgeSeconds !== undefined && (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0)) {
    throw new TypeError('maxAgeSeconds must be a positive whole number of seconds.');
  }
  return SetMetadata<string, StepUpRequirement>(STEP_UP, { maxAgeSeconds });
};

/**
 * The last guard of AUTHENTICATION_AND_AUTHORISATION.md section 3: step-up MFA, for routes that
 * declare `@RequireStepUp()`. It reads `mfa_verified_at` from the session row `AuthGuard` loaded
 * on this request, never from the token alone.
 *
 * It does not check that an MFA-required role has done MFA at all: `MembershipGuard` never builds
 * an actor for such a membership without it, so nothing reaches this guard that has not.
 */
@Injectable()
export class MfaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identity: IdentityService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithActor>();
    const declared = this.reflector.getAllAndOverride<StepUpRequirement | undefined>(STEP_UP, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (declared === undefined) return true;
    if (!request.authSession) throw new DomainError('UNAUTHENTICATED');
    try {
      this.identity.assertStepUp(request.authSession, declared.maxAgeSeconds);
    } catch (error) {
      if (error instanceof IdentityError) throw toDomainError(error);
      throw error;
    }
    return true;
  }
}
