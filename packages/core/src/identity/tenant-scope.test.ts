import type { PrismaClient } from '@labconnect/database';
import { ROLES, type RoleCode } from '@labconnect/shared';
import { describe, expect, it, vi } from 'vitest';
import { AuditService } from '../platform/audit.js';
import { FixedClock } from '../platform/clock.js';
import { actorWithoutMembership, buildCurrentActor, type CurrentActor } from './actor.js';
import { IdentityError } from './errors.js';
import { dbContextFor, TenantScope } from './tenant-scope.js';

// The context selection and the refusals that happen before any database work. The behaviour
// against real row-level security is in test/db/tenant-scope.test.ts.

function actor(role: RoleCode, orgId = 'org-a'): CurrentActor {
  return buildCurrentActor(
    { userId: 'user-1', sessionId: 'sid', mfaVerifiedAt: new Date('2026-11-25T10:00:00Z') },
    {
      id: 'm-1',
      organisationId: orgId,
      orgType: ROLES[role].orgType,
      orgStatus: 'ACTIVE',
      roles: [role],
      siteIds: [],
    },
  );
}

function scopeWithSpy() {
  const transaction = vi.fn();
  const prisma = { $transaction: transaction } as unknown as Pick<PrismaClient, '$transaction'>;
  const scope = new TenantScope(prisma, new AuditService(new FixedClock('2026-11-25T10:00:00Z')));
  return { scope, transaction };
}

const codeOf = async (promise: Promise<unknown> | (() => unknown)): Promise<string | undefined> => {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    if (error instanceof IdentityError) return error.code;
    return `OTHER:${error instanceof Error ? error.name : 'unknown'}`;
  }
  return undefined;
};

describe('dbContextFor', () => {
  it('runs a customer or lab member as their organisation', () => {
    expect(dbContextFor(actor('CUSTOMER_ADMIN', 'org-c'))).toEqual({
      kind: 'tenant',
      orgId: 'org-c',
      userId: 'user-1',
    });
    expect(dbContextFor(actor('LAB_CHECKER', 'org-l'))).toEqual({
      kind: 'tenant',
      orgId: 'org-l',
      userId: 'user-1',
    });
  });

  it('runs platform staff as the platform, with no organisation', () => {
    expect(dbContextFor(actor('PLATFORM_OPS', 'platform'))).toEqual({
      kind: 'platform',
      userId: 'user-1',
    });
  });

  it('has no context for a user with no membership (403), and never a system one', async () => {
    const nobody = actorWithoutMembership({ userId: 'u', sessionId: 's', mfaVerifiedAt: null });
    expect(() => dbContextFor(nobody)).toThrow(IdentityError);
    await expect(codeOf(() => dbContextFor(nobody))).resolves.toBe('FORBIDDEN');
  });
});

describe('TenantScope refusals before any transaction opens', () => {
  it('run: a user with no membership is 403', async () => {
    const { scope, transaction } = scopeWithSpy();
    const nobody = actorWithoutMembership({ userId: 'u', sessionId: 's', mfaVerifiedAt: null });
    await expect(codeOf(scope.run(nobody, () => Promise.resolve(1)))).resolves.toBe('FORBIDDEN');
    expect(transaction).not.toHaveBeenCalled();
  });

  it.each(['CUSTOMER_ADMIN', 'LAB_CHECKER', 'PLATFORM_ADMIN', 'PLATFORM_FINANCE'] as const)(
    'runOnBehalfOf: %s is 403 (OQ-53: PLATFORM_OPS only)',
    async (role) => {
      const { scope, transaction } = scopeWithSpy();
      await expect(
        codeOf(
          scope.runOnBehalfOf(
            actor(role),
            {
              organisationId: '0192f3c0-0000-7000-8000-000000000001',
              reason: 'Booking for a caller',
            },
            () => Promise.resolve(1),
          ),
        ),
      ).resolves.toBe('FORBIDDEN');
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('runOnBehalfOf: an organisation id that is not a UUID is 404, and the reason is required', async () => {
    const { scope, transaction } = scopeWithSpy();
    await expect(
      codeOf(
        scope.runOnBehalfOf(
          actor('PLATFORM_OPS'),
          { organisationId: "x'; DROP TABLE organisation;--", reason: 'Booking for a caller' },
          () => Promise.resolve(1),
        ),
      ),
    ).resolves.toBe('NOT_FOUND');
    await expect(
      codeOf(
        scope.runOnBehalfOf(
          actor('PLATFORM_OPS'),
          { organisationId: '0192f3c0-0000-7000-8000-000000000001', reason: '  ' },
          () => Promise.resolve(1),
        ),
      ),
    ).resolves.toBe('OTHER:RangeError');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('runAsSystem requires a reason', async () => {
    const { scope, transaction } = scopeWithSpy();
    await expect(scope.runAsSystem('', () => Promise.resolve(1))).rejects.toThrow(RangeError);
    await expect(scope.runAsSystem('x'.repeat(201), () => Promise.resolve(1))).rejects.toThrow(
      RangeError,
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});
