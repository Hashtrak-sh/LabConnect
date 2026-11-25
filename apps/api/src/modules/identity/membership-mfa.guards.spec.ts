import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FixedClock, IdentityError, assertStepUp, type CurrentActor } from '@labconnect/core';
import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../common/domain-error.js';
import { MembershipGuard } from './membership.guard.js';
import { MfaGuard, RequireStepUp } from './mfa.guard.js';
import type { AuthenticatedSession, IdentityService } from './identity.service.js';

const NOW = '2026-11-25T10:00:00Z';
const session = (mfaVerifiedAt: Date | null): AuthenticatedSession => ({
  rowId: 'r',
  sessionId: 's',
  userId: 'u',
  activeMembershipId: 'm',
  mfaVerifiedAt,
  startedAt: new Date(NOW),
  expiresAt: new Date(NOW),
  partial: false,
});

function contextFor(
  controller: new () => object,
  request: Record<string, unknown>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => Reflect.get(controller.prototype, 'handler') as () => void,
    getClass: () => controller,
  } as unknown as ExecutionContext;
}
class Plain {
  handler(): void {
    /* a route */
  }
}
class Fresh {
  @RequireStepUp()
  handler(): void {
    /* a route */
  }
}
class Fresh60 {
  @RequireStepUp(60)
  handler(): void {
    /* a route */
  }
}

const failure = async (promise: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    return error instanceof DomainError ? error : new Error('not a DomainError');
  }
  return undefined;
};

describe('MembershipGuard', () => {
  const actor = { userId: 'u' } as CurrentActor;
  const identityWith = (resolveActor: IdentityService['resolveActor']) =>
    ({ resolveActor }) as unknown as IdentityService;

  it('stores the resolved actor on the request', async () => {
    const resolveActor = vi.fn().mockResolvedValue(actor);
    const request = { authSession: session(null), headers: {} };
    const guard = new MembershipGuard(identityWith(resolveActor));
    await expect(guard.canActivate(contextFor(Plain, request))).resolves.toBe(true);
    expect((request as { actor?: unknown }).actor).toBe(actor);
    expect(resolveActor).toHaveBeenCalledWith(request.authSession, undefined);
  });

  it('passes X-Active-Membership on as a choice among the user memberships, and nothing else of the request', async () => {
    const resolveActor = vi.fn().mockResolvedValue(actor);
    const request = {
      authSession: session(null),
      headers: { 'x-active-membership': 'm-2', 'x-org-id': 'org-evil', 'x-organisation-id': 'e' },
      body: { orgId: 'org-evil', organisationId: 'org-evil' },
      query: { orgId: 'org-evil' },
      params: { orgId: 'org-evil' },
    };
    await new MembershipGuard(identityWith(resolveActor)).canActivate(contextFor(Plain, request));
    expect(resolveActor).toHaveBeenCalledWith(request.authSession, 'm-2');
    expect(resolveActor).toHaveBeenCalledTimes(1);
  });

  it('treats a repeated header as naming nothing the user owns', async () => {
    const resolveActor = vi.fn().mockResolvedValue(actor);
    const request = { authSession: session(null), headers: { 'x-active-membership': ['a', 'b'] } };
    await new MembershipGuard(identityWith(resolveActor)).canActivate(contextFor(Plain, request));
    expect(resolveActor).toHaveBeenCalledWith(request.authSession, '');
  });

  it('fails closed with 401 when AuthGuard did not run first', async () => {
    const guard = new MembershipGuard(identityWith(vi.fn()));
    const error = await failure(() => guard.canActivate(contextFor(Plain, { headers: {} })));
    expect(error).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('turns a refusal of the core into the catalogued problem, and lets other errors through', async () => {
    const refuse = (code: 'FORBIDDEN' | 'NOT_FOUND' | 'STEP_UP_REQUIRED') =>
      new MembershipGuard(identityWith(vi.fn().mockRejectedValue(new IdentityError(code))));
    const request = () => ({ authSession: session(null), headers: {} });
    for (const code of ['FORBIDDEN', 'NOT_FOUND', 'STEP_UP_REQUIRED'] as const) {
      const error = await failure(refuse(code).canActivate(contextFor(Plain, request())));
      expect(error).toMatchObject({ code });
    }
    const crash = new MembershipGuard(
      identityWith(vi.fn().mockRejectedValue(new Error('db down'))),
    );
    const error = await failure(crash.canActivate(contextFor(Plain, request())));
    expect(error).not.toBeInstanceOf(DomainError);
  });
});

describe('MfaGuard', () => {
  const clock = new FixedClock(NOW);
  const identity = {
    assertStepUp: (s: AuthenticatedSession, maxAge?: number) => {
      assertStepUp(s, clock, maxAge);
    },
  } as unknown as IdentityService;
  const guard = new MfaGuard(new Reflector(), identity);
  const minutesAgo = (minutes: number): Date => new Date(clock.now().getTime() - minutes * 60_000);

  it('does nothing on a route without @RequireStepUp', () => {
    expect(guard.canActivate(contextFor(Plain, { authSession: session(null) }))).toBe(true);
  });

  it('refuses with 401 STEP_UP_REQUIRED when MFA never happened in the session', async () => {
    const error = await failure(() =>
      guard.canActivate(contextFor(Fresh, { authSession: session(null) })),
    );
    expect(error).toMatchObject({
      code: 'STEP_UP_REQUIRED',
      status: 401,
      meta: { maxAgeSeconds: 300 },
    });
  });

  it('accepts MFA within the default 5 minutes and refuses an older one', async () => {
    expect(guard.canActivate(contextFor(Fresh, { authSession: session(minutesAgo(4)) }))).toBe(
      true,
    );
    const error = await failure(() =>
      guard.canActivate(contextFor(Fresh, { authSession: session(minutesAgo(6)) })),
    );
    expect(error).toMatchObject({ code: 'STEP_UP_REQUIRED' });
  });

  it('honours a maximum age of its own', async () => {
    expect(guard.canActivate(contextFor(Fresh60, { authSession: session(minutesAgo(0.5)) }))).toBe(
      true,
    );
    const error = await failure(() =>
      guard.canActivate(contextFor(Fresh60, { authSession: session(minutesAgo(2)) })),
    );
    expect(error).toMatchObject({ code: 'STEP_UP_REQUIRED', meta: { maxAgeSeconds: 60 } });
  });

  it('fails closed without a session', async () => {
    const error = await failure(() => guard.canActivate(contextFor(Fresh, {})));
    expect(error).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuses a nonsensical maximum age when the route is declared', () => {
    expect(() => RequireStepUp(0)).toThrow(TypeError);
    expect(() => RequireStepUp(-5)).toThrow(TypeError);
    expect(() => RequireStepUp(1.5)).toThrow(TypeError);
  });
});
