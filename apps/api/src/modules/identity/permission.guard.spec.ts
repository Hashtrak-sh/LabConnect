import 'reflect-metadata';
import { type ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { buildCurrentActor, type CurrentActor } from '@labconnect/core';
import {
  PERMISSION_CODES,
  type PermissionCode,
  permissionsOf,
  ROLE_CODES,
  ROLES,
  type RoleCode,
} from '@labconnect/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../common/domain-error.js';
import {
  NoPermissionRequired,
  PermissionGuard,
  RequireAnyPermission,
  RequirePermission,
} from './permission.guard.js';

const actorOf = (...roles: RoleCode[]): CurrentActor => {
  const orgType = ROLES[roles[0] ?? 'CUSTOMER_ADMIN'].orgType;
  return buildCurrentActor(
    { userId: 'u', sessionId: 's', mfaVerifiedAt: new Date('2026-11-25T10:00:00Z') },
    { id: 'm', organisationId: 'o', orgType, orgStatus: 'ACTIVE', roles, siteIds: [] },
  );
};

function contextFor(
  controller: new () => object,
  actor: CurrentActor | undefined,
): ExecutionContext {
  const request = { actor };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => Reflect.get(controller.prototype, 'handler') as () => void,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

const codeOf = (action: () => unknown): string => {
  try {
    action();
  } catch (error) {
    return error instanceof DomainError ? error.code : 'OTHER';
  }
  return 'OK';
};

const guard = new PermissionGuard(new Reflector());

// The guard logs the route that forgot its declaration; keep the test output clean.
beforeEach(() => {
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

class Undeclared {
  handler(): void {
    /* forgot the decorator */
  }
}
class Open {
  @NoPermissionRequired()
  handler(): void {
    /* a route */
  }
}
const requiring = (...codes: PermissionCode[]): new () => object => {
  class Route {
    handler(): void {
      /* a route */
    }
  }
  RequirePermission(...codes)(Route.prototype, 'handler', {
    value: Reflect.get(Route.prototype, 'handler') as unknown,
  } as PropertyDescriptor);
  return Route;
};
const requiringAny = (...codes: PermissionCode[]): new () => object => {
  class Route {
    handler(): void {
      /* a route */
    }
  }
  RequireAnyPermission(...codes)(Route.prototype, 'handler', {
    value: Reflect.get(Route.prototype, 'handler') as unknown,
  } as PropertyDescriptor);
  return Route;
};

describe('PermissionGuard resolves permissions for every role of the shared map', () => {
  const cases = ROLE_CODES.flatMap((role) =>
    PERMISSION_CODES.map((code) => ({
      role,
      code,
      allowed: permissionsOf(role).includes(code),
    })),
  );

  it.each(cases)('$role + $code: allowed=$allowed', ({ role, code, allowed }) => {
    expect(codeOf(() => guard.canActivate(contextFor(requiring(code), actorOf(role))))).toBe(
      allowed ? 'OK' : 'FORBIDDEN',
    );
  });
});

describe('PermissionGuard', () => {
  it('FAILS CLOSED: a route with no declaration is refused, whoever asks', () => {
    for (const role of ROLE_CODES) {
      expect(codeOf(() => guard.canActivate(contextFor(Undeclared, actorOf(role))))).toBe(
        'FORBIDDEN',
      );
    }
  });

  it('fails closed with no actor too, also on an open route', () => {
    expect(codeOf(() => guard.canActivate(contextFor(Undeclared, undefined)))).toBe('FORBIDDEN');
    expect(codeOf(() => guard.canActivate(contextFor(Open, undefined)))).toBe('FORBIDDEN');
    expect(codeOf(() => guard.canActivate(contextFor(requiring('lab.search'), undefined)))).toBe(
      'FORBIDDEN',
    );
  });

  it('admits any actor on a route marked @NoPermissionRequired()', () => {
    for (const role of ROLE_CODES) {
      expect(codeOf(() => guard.canActivate(contextFor(Open, actorOf(role))))).toBe('OK');
    }
  });

  it('ALL (the default): every listed permission is needed', () => {
    const route = requiring('booking.pay', 'booking.cancel');
    expect(codeOf(() => guard.canActivate(contextFor(route, actorOf('CUSTOMER_ADMIN'))))).toBe(
      'OK',
    );
    // Finance may pay but not cancel.
    expect(codeOf(() => guard.canActivate(contextFor(route, actorOf('CUSTOMER_FINANCE'))))).toBe(
      'FORBIDDEN',
    );
  });

  it('ANY: one of the listed permissions is enough', () => {
    const route = requiringAny('booking.pay', 'booking.cancel');
    expect(codeOf(() => guard.canActivate(contextFor(route, actorOf('CUSTOMER_FINANCE'))))).toBe(
      'OK',
    );
    expect(codeOf(() => guard.canActivate(contextFor(route, actorOf('LAB_MAKER'))))).toBe(
      'FORBIDDEN',
    );
  });

  it('refuses a user with no membership on any route that declares a permission', () => {
    const nobody = buildNobody();
    for (const code of PERMISSION_CODES) {
      expect(
        codeOf(() => guard.canActivate(contextFor(requiring(code), nobody))),
        code,
      ).toBe('FORBIDDEN');
    }
    expect(codeOf(() => guard.canActivate(contextFor(Open, nobody)))).toBe('OK');
  });

  it('the role-level check admits an OWN or CONDITIONAL grant (the service enforces the rest)', () => {
    // C-Req holds booking.create_edit as OWN, Ops holds it as a condition.
    expect(
      codeOf(() =>
        guard.canActivate(
          contextFor(requiring('booking.create_edit'), actorOf('CUSTOMER_REQUESTER')),
        ),
      ),
    ).toBe('OK');
    expect(
      codeOf(() =>
        guard.canActivate(contextFor(requiring('booking.create_edit'), actorOf('PLATFORM_OPS'))),
      ),
    ).toBe('OK');
  });
});

function buildNobody(): CurrentActor {
  return {
    userId: 'u',
    sessionId: 's',
    membershipId: null,
    orgId: null,
    orgType: null,
    roles: [],
    permissions: new Set(),
    siteIds: [],
    allSites: false,
    mfaVerifiedAt: null,
    isPlatform: false,
  };
}
