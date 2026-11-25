import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IdentityError } from '@labconnect/core';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../common/domain-error.js';
import { AllowPartialSession, AuthGuard } from './auth.guard.js';
import type { AuthenticatedSession, IdentityService } from './identity.service.js';

const session = (partial: boolean): AuthenticatedSession => ({
  rowId: 'row',
  sessionId: 'sid',
  userId: 'user',
  activeMembershipId: null,
  mfaVerifiedAt: null,
  startedAt: new Date(0),
  expiresAt: new Date(1),
  partial,
});

class Plain {
  handler(): void {
    /* a route that does not accept a partial session */
  }
}
class Lenient {
  @AllowPartialSession()
  handler(): void {
    /* a route that does */
  }
}

function contextFor(
  controller: new () => { handler(): void },
  headers: Record<string, string | undefined>,
): {
  context: ExecutionContext;
  request: { headers: Record<string, string | undefined>; authSession?: unknown };
} {
  const request: { headers: Record<string, string | undefined>; authSession?: unknown } = {
    headers,
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => Reflect.get(controller.prototype, 'handler') as () => void,
    getClass: () => controller,
  } as unknown as ExecutionContext;
  return { context, request };
}

function guardWith(authenticate: (token: string) => Promise<AuthenticatedSession>) {
  return new AuthGuard({ authenticate } as unknown as IdentityService, new Reflector());
}

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    return (error as DomainError).code;
  }
  return 'OK';
};

describe('AuthGuard', () => {
  it('lets a valid full session through and stores it on the request', async () => {
    const guard = guardWith(() => Promise.resolve(session(false)));
    const { context, request } = contextFor(Plain, { authorization: 'Bearer abc.def.ghi' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authSession).toMatchObject({ userId: 'user', partial: false });
  });

  it('passes the bare token, not the header, to the identity service', async () => {
    let seen = '';
    const guard = guardWith((token) => {
      seen = token;
      return Promise.resolve(session(false));
    });
    await guard.canActivate(contextFor(Plain, { authorization: 'Bearer abc.def.ghi' }).context);
    expect(seen).toBe('abc.def.ghi');
  });

  it('answers UNAUTHENTICATED without a usable Authorization header, without asking the service', async () => {
    let asked = false;
    const guard = guardWith(() => {
      asked = true;
      return Promise.resolve(session(false));
    });
    for (const headers of [
      {},
      { authorization: 'Basic abc' },
      { authorization: 'Bearer' },
      { authorization: 'Bearer ' },
      { authorization: 'bearer abc' },
      { authorization: 'Bearer a b' },
    ]) {
      expect(await codeOf(guard.canActivate(contextFor(Plain, headers).context))).toBe(
        'UNAUTHENTICATED',
      );
    }
    expect(asked).toBe(false);
  });

  it('turns an identity failure into the same UNAUTHENTICATED, and does not swallow anything else', async () => {
    const rejecting = guardWith(() => Promise.reject(new IdentityError('UNAUTHENTICATED')));
    expect(
      await codeOf(rejecting.canActivate(contextFor(Plain, { authorization: 'Bearer x' }).context)),
    ).toBe('UNAUTHENTICATED');
    const broken = guardWith(() => Promise.reject(new Error('database down')));
    await expect(
      broken.canActivate(contextFor(Plain, { authorization: 'Bearer x' }).context),
    ).rejects.toThrow('database down');
  });

  it('refuses a partial session except on routes that allow it', async () => {
    const guard = guardWith(() => Promise.resolve(session(true)));
    expect(
      await codeOf(guard.canActivate(contextFor(Plain, { authorization: 'Bearer x' }).context)),
    ).toBe('UNAUTHENTICATED');
    const { context, request } = contextFor(Lenient, { authorization: 'Bearer x' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authSession).toMatchObject({ partial: true });
  });

  it('does not store a session when it refuses', async () => {
    const guard = guardWith(() => Promise.resolve(session(true)));
    const { context, request } = contextFor(Plain, { authorization: 'Bearer x' });
    await codeOf(guard.canActivate(context));
    expect(request.authSession).toBeUndefined();
  });
});
