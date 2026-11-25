import { applyDecorators, UseGuards, UseInterceptors } from '@nestjs/common';
import type { PermissionCode } from '@labconnect/shared';
import { AuthGuard } from './auth.guard.js';
import { IdentityErrorInterceptor } from './identity-errors.js';
import { MembershipGuard } from './membership.guard.js';
import { MfaGuard, RequireStepUp } from './mfa.guard.js';
import {
  NoPermissionRequired,
  PermissionGuard,
  RequireAnyPermission,
  RequirePermission,
} from './permission.guard.js';

interface CommonOptions {
  /**
   * Needs a fresh MFA (`401 STEP_UP_REQUIRED`): `true` for the default of 5 minutes, or the
   * maximum age in seconds.
   */
  stepUp?: true | number;
}

/**
 * Exactly one way to say who may call a route. The union has no empty member, so a route cannot
 * be `@Authorised()` without deciding.
 */
export type AuthorisedOptions = CommonOptions &
  (
    | { permission: PermissionCode | readonly [PermissionCode, ...PermissionCode[]] }
    | { anyPermission: readonly [PermissionCode, ...PermissionCode[]] }
    | { noPermissionRequired: true }
  );

/**
 * Protects a route: `AuthGuard` → `MembershipGuard` → `PermissionGuard` → `MfaGuard`, in that
 * order (AUTHENTICATION_AND_AUTHORISATION.md section 3), plus the mapping of core errors to
 * problem responses. Controllers use this instead of stacking guards by hand, so the order cannot
 * be wrong.
 *
 * ```ts
 * @Post(':id/accept')
 * @Authorised({ permission: 'booking.decide' })
 * accept(@CurrentActor() actor: CurrentActor, @Param('id') id: string) { ... }
 *
 * @Post(':id/publish')
 * @Authorised({ permission: 'report.publish', stepUp: true })
 * ```
 *
 * `permission` with several codes needs all of them; `anyPermission` needs one;
 * `noPermissionRequired` admits any signed-in actor, also one with no membership.
 */
export function Authorised(options: AuthorisedOptions): MethodDecorator & ClassDecorator {
  const decorators: (MethodDecorator & ClassDecorator)[] = [];
  if ('permission' in options) {
    const codes =
      typeof options.permission === 'string' ? [options.permission] : options.permission;
    decorators.push(RequirePermission(...codes));
  } else if ('anyPermission' in options) {
    decorators.push(RequireAnyPermission(...options.anyPermission));
  } else {
    decorators.push(NoPermissionRequired());
  }
  if (options.stepUp !== undefined) {
    decorators.push(RequireStepUp(options.stepUp === true ? undefined : options.stepUp));
  }
  return applyDecorators(
    UseGuards(AuthGuard, MembershipGuard, PermissionGuard, MfaGuard),
    UseInterceptors(IdentityErrorInterceptor),
    ...decorators,
  );
}
