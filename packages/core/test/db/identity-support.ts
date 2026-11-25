import { randomBytes } from 'node:crypto';
import { type DbContext, type Prisma, withDbContext } from '@labconnect/database';
import {
  addMember,
  createCustomer,
  createPlatformTeam,
  createUser,
} from '@labconnect/database/test-utils';
import {
  AesGcmSecretCipher,
  AuditService,
  FixedClock,
  type IdentityDeps,
  IdentityHasher,
  type RequestMeta,
} from '../../src/index.js';
import { usePlatform } from './support.js';

export const START = '2026-11-25T10:00:00Z';
export const META: RequestMeta = {
  requestId: 'req-test-1',
  ipAddress: '203.0.113.7',
  userAgent: 'vitest',
};

/**
 * The pieces every identity database test needs: the three database clients, a clock that
 * only moves when told, the identity dependencies with throwaway secrets, and the two
 * database contexts the identity flows use (see docs: unauthenticated flows run as `system`,
 * authenticated ones as the user alone).
 */
export function useIdentity() {
  const platform = usePlatform();
  const clock = new FixedClock(START);
  const deps: IdentityDeps = {
    clock,
    audit: new AuditService(clock),
    hasher: new IdentityHasher(randomBytes(32)),
    cipher: new AesGcmSecretCipher(randomBytes(32)),
  };

  /** Runs `work` as the API role with the `system` context: OTP, sign-in, refresh, token lookup. */
  const asSystem = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    withDbContext(platform.api(), { kind: 'system' }, work);

  /** Runs `work` as the API role as one user, with no organisation: MFA, sessions, `/me`. */
  const asUser = <T>(
    userId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> => {
    const context: DbContext = { kind: 'tenant', orgId: '', userId };
    return withDbContext(platform.api(), context, work);
  };

  const owner = <T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> => platform.owner().$transaction(work, options);

  return { ...platform, clock, deps, asSystem, asUser, owner };
}

let counter = 0;
export const uniqueEmail = (label = 'person'): string =>
  `${label}.${String(++counter)}.${randomBytes(3).toString('hex')}@example.test`;

export { addMember, createCustomer, createPlatformTeam, createUser };
