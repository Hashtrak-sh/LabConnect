import 'reflect-metadata';
import { Controller, Get, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_CODES, PERMISSIONS } from '@labconnect/shared';
import { describe, expect, it } from 'vitest';
import { AuthGuard } from './auth.guard.js';
import { Authorised } from './authorised.decorator.js';
import { IdentityErrorInterceptor } from './identity-errors.js';
import { MembershipGuard } from './membership.guard.js';
import { MfaGuard } from './mfa.guard.js';
import {
  NoPermissionRequired,
  type PermissionRequirement,
  PermissionGuard,
  RequireAnyPermission,
  RequirePermission,
} from './permission.guard.js';

const GUARDS = '__guards__';
const INTERCEPTORS = '__interceptors__';

@Controller('probe')
class Probe {
  @Get('decide')
  @Authorised({ permission: 'booking.decide' })
  decide(): void {
    /* a route */
  }

  @Get('publish')
  @Authorised({ permission: 'report.publish', stepUp: true })
  publish(): void {
    /* a route */
  }

  @Get('fresh')
  @Authorised({ permission: 'report.publish', stepUp: 60 })
  fresh(): void {
    /* a route */
  }

  @Get('both')
  @Authorised({ permission: ['booking.pay', 'booking.cancel'] })
  both(): void {
    /* a route */
  }

  @Get('either')
  @Authorised({ anyPermission: ['booking.pay', 'booking.cancel'] })
  either(): void {
    /* a route */
  }

  @Get('open')
  @Authorised({ noPermissionRequired: true })
  open(): void {
    /* a route */
  }
}

const handler = (name: keyof Probe): (() => void) => {
  const fn: unknown = Reflect.get(Probe.prototype, name);
  return fn as () => void;
};
const requirementOf = (name: keyof Probe): PermissionRequirement | undefined =>
  Reflect.getMetadata('identity:permissionRequirement', handler(name)) as
    PermissionRequirement | undefined;
const stepUpOf = (name: keyof Probe): { maxAgeSeconds: number | undefined } | undefined =>
  Reflect.getMetadata('identity:stepUp', handler(name)) as
    { maxAgeSeconds: number | undefined } | undefined;

describe('@Authorised', () => {
  it('applies the guards in the documented order: auth, membership, permission, step-up', () => {
    for (const name of ['decide', 'publish', 'both', 'either', 'open'] as const) {
      expect(Reflect.getMetadata(GUARDS, handler(name)), name).toEqual([
        AuthGuard,
        MembershipGuard,
        PermissionGuard,
        MfaGuard,
      ]);
    }
  });

  it('maps errors thrown by the handler to problem responses', () => {
    expect(Reflect.getMetadata(INTERCEPTORS, handler('decide'))).toEqual([
      IdentityErrorInterceptor,
    ]);
  });

  it('declares one permission, several (all of them), or any of several', () => {
    expect(requirementOf('decide')).toEqual({ mode: 'ALL', codes: ['booking.decide'] });
    expect(requirementOf('both')).toEqual({
      mode: 'ALL',
      codes: ['booking.pay', 'booking.cancel'],
    });
    expect(requirementOf('either')).toEqual({
      mode: 'ANY',
      codes: ['booking.pay', 'booking.cancel'],
    });
  });

  it('marks an open route explicitly', () => {
    expect(requirementOf('open')).toEqual({ mode: 'NONE', codes: [] });
  });

  it('declares step-up only when asked, with the default or its own age', () => {
    expect(stepUpOf('decide')).toBeUndefined();
    expect(stepUpOf('publish')).toEqual({ maxAgeSeconds: undefined });
    expect(stepUpOf('fresh')).toEqual({ maxAgeSeconds: 60 });
  });

  it('applies to a whole controller', () => {
    @Authorised({ permission: 'lab_inbox.view' })
    @Controller('inbox')
    class Inbox {}
    expect(Reflect.getMetadata(GUARDS, Inbox)).toEqual([
      AuthGuard,
      MembershipGuard,
      PermissionGuard,
      MfaGuard,
    ]);
  });
});

describe('permission decorators', () => {
  it('refuse a code that is not a permission, when the route is declared (start-up), not at request time', () => {
    expect(() => RequirePermission('booking.decidee' as never)).toThrow(TypeError);
    expect(() => RequireAnyPermission('nope' as never)).toThrow(TypeError);
    expect(() => Authorised({ permission: 'nope' as never })).toThrow(TypeError);
  });

  it('refuse an empty requirement', () => {
    expect(() => RequirePermission()).toThrow(TypeError);
    expect(() => RequireAnyPermission()).toThrow(TypeError);
  });

  it('accept every permission code of the shared matrix', () => {
    for (const code of PERMISSION_CODES) {
      expect(() => RequirePermission(code), code).not.toThrow();
    }
    expect(PERMISSION_CODES.length).toBe(Object.keys(PERMISSIONS).length);
  });

  it('let a method replace its controller declaration', () => {
    @RequirePermission('lab_inbox.view')
    @Injectable()
    class Mixed {
      @NoPermissionRequired()
      open(): void {
        /* a route */
      }

      plain(): void {
        /* a route */
      }
    }
    const reflector = new Reflector();
    const decl = (name: 'open' | 'plain'): PermissionRequirement | undefined => {
      const method: unknown = Reflect.get(Mixed.prototype, name);
      const value: unknown = reflector.getAllAndOverride('identity:permissionRequirement', [
        method as () => void,
        Mixed,
      ]);
      return value as PermissionRequirement | undefined;
    };
    expect(decl('open')).toEqual({ mode: 'NONE', codes: [] });
    expect(decl('plain')).toEqual({ mode: 'ALL', codes: ['lab_inbox.view'] });
  });
});
