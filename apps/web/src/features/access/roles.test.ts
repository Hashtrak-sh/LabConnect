import type { components } from '@labconnect/api-contract';
import { describe, expect, it } from 'vitest';
import {
  CLAIM_REVIEW_ROLES,
  hasAnyRole,
  isPlatformStaff,
  labMemberships,
  toAccessUser,
} from './roles';

type Me = components['schemas']['Me'];

function me(
  memberships: [string, 'CUSTOMER' | 'LAB' | 'PLATFORM', string[]][],
  active: number,
): Me {
  return {
    user: {
      id: 'u1',
      email: 'x@example.com',
      fullName: 'Test User',
      designation: null,
      locale: 'en-IN',
      mfaEnrolled: true,
    },
    memberships: memberships.map(([name, orgType, roles], index) => ({
      id: `m${String(index)}`,
      organisation: { id: `o${String(index)}`, orgType, displayName: name },
      roles: roles as never,
    })),
    activeMembershipId: active < 0 ? null : `m${String(active)}`,
    permissions: [],
  };
}

describe('access checks', () => {
  it('opens the claim review only to Platform Ops acting as Platform Ops', () => {
    const ops = toAccessUser(me([['LabConnect', 'PLATFORM', ['PLATFORM_OPS']]], 0));
    expect(hasAnyRole(ops, CLAIM_REVIEW_ROLES)).toBe(true);
    for (const role of ['PLATFORM_ADMIN', 'PLATFORM_FINANCE', 'LAB_CHECKER', 'CUSTOMER_ADMIN']) {
      const other = toAccessUser(me([['Org', 'PLATFORM', [role]]], 0));
      expect(hasAnyRole(other, CLAIM_REVIEW_ROLES)).toBe(false);
    }
  });

  it('counts only the active membership: a Checker of one lab who is also Ops elsewhere', () => {
    const memberships: [string, 'LAB' | 'PLATFORM', string[]][] = [
      ['Lab A', 'LAB', ['LAB_CHECKER']],
      ['LabConnect', 'PLATFORM', ['PLATFORM_OPS']],
    ];
    expect(hasAnyRole(toAccessUser(me(memberships, 0)), CLAIM_REVIEW_ROLES)).toBe(false);
    expect(hasAnyRole(toAccessUser(me(memberships, 1)), CLAIM_REVIEW_ROLES)).toBe(true);
  });

  it('gives a user with no membership no role at all', () => {
    const nobody = toAccessUser(me([], -1));
    expect(nobody.active).toBeNull();
    expect(hasAnyRole(nobody, CLAIM_REVIEW_ROLES)).toBe(false);
    expect(isPlatformStaff(nobody)).toBe(false);
  });

  it('knows platform staff and lab memberships across organisations', () => {
    const user = toAccessUser(
      me(
        [
          ['Customer', 'CUSTOMER', ['CUSTOMER_ADMIN']],
          ['Lab', 'LAB', ['LAB_CHECKER']],
        ],
        0,
      ),
    );
    expect(isPlatformStaff(user)).toBe(false);
    expect(labMemberships(user)).toHaveLength(1);
    expect(
      isPlatformStaff(toAccessUser(me([['LabConnect', 'PLATFORM', ['PLATFORM_OPS']]], 0))),
    ).toBe(true);
  });
});
