// A deliberately wrong PermissionGuard, for the negative controls of the permission matrix
// (P3-05): it lets the listed roles through on every route, whatever the route declares. A
// testing module swaps it in with `overrideGuard(PermissionGuard)`; nothing in the real app uses it.
import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RoleCode } from '@labconnect/shared';
import type { RequestWithActor } from '../../../src/modules/identity/current-actor.js';
import { PermissionGuard } from '../../../src/modules/identity/permission.guard.js';

export class LeakyPermissionGuard extends PermissionGuard {
  constructor(private readonly extraRoles: readonly RoleCode[]) {
    super(new Reflector());
  }

  override canActivate(context: ExecutionContext): boolean {
    const actor = context.switchToHttp().getRequest<RequestWithActor>().actor;
    if (actor?.roles.some((role) => this.extraRoles.includes(role)) === true) return true;
    return super.canActivate(context);
  }
}
