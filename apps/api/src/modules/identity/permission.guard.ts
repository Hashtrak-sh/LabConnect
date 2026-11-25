import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isPermissionCode, type PermissionCode } from '@labconnect/shared';
import { DomainError } from '../../common/domain-error.js';
import type { RequestWithActor } from './current-actor.js';

const PERMISSION_REQUIREMENT = 'identity:permissionRequirement';

/**
 * What a route declares: `ALL` (the actor holds every code), `ANY` (at least one), or `NONE` (the
 * route is open to any actor, with or without a membership; the handler checks what it needs).
 */
export interface PermissionRequirement {
  readonly mode: 'ALL' | 'ANY' | 'NONE';
  readonly codes: readonly PermissionCode[];
}

function requirement(
  mode: 'ALL' | 'ANY',
  codes: readonly string[],
): MethodDecorator & ClassDecorator {
  if (codes.length === 0) throw new TypeError('A permission requirement names at least one code.');
  const known = codes.filter(isPermissionCode);
  if (known.length !== codes.length) {
    // A typo would otherwise be a permission nobody holds: fail at start-up, not in production.
    throw new TypeError(`Unknown permission code in ${codes.join(', ')}.`);
  }
  return SetMetadata<string, PermissionRequirement>(PERMISSION_REQUIREMENT, {
    mode,
    codes: known,
  });
}

/**
 * What a route (a handler and its controller) declares, read the way `PermissionGuard` reads it:
 * the method's declaration replaces its controller's. `undefined` is a route with no declaration,
 * which the guard refuses. Read-only: the coverage tests (P3-05) use it to see every route's
 * requirement without repeating the metadata key.
 */
export function permissionRequirementOf(
  handler: object,
  controller: object,
): PermissionRequirement | undefined {
  return (
    (Reflect.getMetadata(PERMISSION_REQUIREMENT, handler) as PermissionRequirement | undefined) ??
    (Reflect.getMetadata(PERMISSION_REQUIREMENT, controller) as PermissionRequirement | undefined)
  );
}

/**
 * The actor must hold **every** listed permission (AND). `@RequirePermission('booking.decide')`.
 * Role level only (ROLES_AND_PERMISSIONS section 3): a permission the role holds as `OWN` or
 * `CONDITIONAL` passes here and is enforced again by the domain service.
 */
export const RequirePermission = (...codes: PermissionCode[]): MethodDecorator & ClassDecorator =>
  requirement('ALL', codes);

/** The actor must hold **at least one** of the listed permissions (OR). */
export const RequireAnyPermission = (
  ...codes: PermissionCode[]
): MethodDecorator & ClassDecorator => requirement('ANY', codes);

/**
 * Marks a route that deliberately needs no permission, so any signed-in actor may call it, also
 * one with no membership. The explicit marker is what keeps `PermissionGuard` fail-closed: a
 * route with neither this nor `@RequirePermission` is refused. The handler must check for itself
 * what the actor may do (for example `requireOrganisation(actor)`).
 */
export const NoPermissionRequired = (): MethodDecorator & ClassDecorator =>
  SetMetadata<string, PermissionRequirement>(PERMISSION_REQUIREMENT, { mode: 'NONE', codes: [] });

/**
 * The third guard of AUTHENTICATION_AND_AUTHORISATION.md section 3, after `MembershipGuard`.
 *
 * **Fails closed.** A route with no declaration (neither `@RequirePermission`/
 * `@RequireAnyPermission` nor `@NoPermissionRequired()`) is `403 FORBIDDEN`, so a forgotten
 * decorator cannot open an endpoint. So is a request that reaches it with no actor. A method's
 * declaration replaces its controller's.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const actor = context.switchToHttp().getRequest<RequestWithActor>().actor;
    if (!actor) throw new DomainError('FORBIDDEN');

    const declared = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(
      PERMISSION_REQUIREMENT,
      [context.getHandler(), context.getClass()],
    );
    if (declared === undefined) {
      this.logger.error(
        `${context.getClass().name}.${context.getHandler().name} declares no permission: refused.`,
      );
      throw new DomainError('FORBIDDEN');
    }
    if (declared.mode === 'NONE') return true;

    const holds = (code: PermissionCode): boolean => actor.permissions.has(code);
    const allowed =
      declared.mode === 'ALL' ? declared.codes.every(holds) : declared.codes.some(holds);
    if (!allowed) throw new DomainError('FORBIDDEN');
    return true;
  }
}
