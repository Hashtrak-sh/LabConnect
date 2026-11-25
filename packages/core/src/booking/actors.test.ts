import { findTransition } from '@labconnect/shared';
import { describe, expect, it } from 'vitest';
import { authorizeActor, type BookingParties, type CallerContext } from './actors.js';
import type { BookingActor } from './types.js';

const parties: BookingParties = {
  customerOrgId: 'cust-org',
  labOrgId: 'lab-org',
  labSiteId: 'site-1',
  requesterUserId: 'owner-user',
};
const tenant = (orgId: string, userId: string): CallerContext => ({
  userId,
  orgId,
  isPlatform: false,
  isSystem: false,
});
const platform: CallerContext = {
  userId: 'ops-user',
  orgId: 'plat-org',
  isPlatform: true,
  isSystem: false,
};
const system: CallerContext = { userId: null, orgId: null, isPlatform: false, isSystem: true };

const user = (
  role: Extract<BookingActor, { kind: 'USER' }>['role'],
  userId: string,
  extra = {},
): BookingActor => ({
  kind: 'USER',
  userId,
  role,
  ...extra,
});
const allowed = (
  id: Parameters<typeof findTransition>[0],
  actor: BookingActor,
  caller: CallerContext,
) => authorizeActor(findTransition(id), actor, caller, parties);

describe('authorizeActor', () => {
  it('lets the lab checker of the site accept, but not a maker or a checker of another lab', () => {
    const lab = tenant('lab-org', 'checker-user');
    expect(allowed('T-03', user('LAB_CHECKER', 'checker-user'), lab).allowed).toBe(true);
    expect(allowed('T-03', user('LAB_MAKER', 'checker-user'), lab).allowed).toBe(false);
    expect(allowed('T-03', user('LAB_CHECKER', 'x'), tenant('other-lab', 'x'))).toEqual({
      allowed: false,
      reason: 'NOT_A_PARTY',
    });
  });

  it('applies the site limit only when the membership has one', () => {
    const lab = tenant('lab-org', 'c');
    expect(allowed('T-03', user('LAB_CHECKER', 'c', { labSiteIds: ['site-1'] }), lab).allowed).toBe(
      true,
    );
    expect(allowed('T-03', user('LAB_CHECKER', 'c', { labSiteIds: ['site-2'] }), lab).allowed).toBe(
      false,
    );
    expect(allowed('T-03', user('LAB_CHECKER', 'c', { labSiteIds: [] }), lab).allowed).toBe(false);
  });

  it('"owner" is the requester of the booking, whatever customer role they hold', () => {
    const ownerCtx = tenant('cust-org', 'owner-user');
    expect(allowed('T-02', user('CUSTOMER_REQUESTER', 'owner-user'), ownerCtx).allowed).toBe(true);
    expect(allowed('T-02', user('CUSTOMER_FINANCE', 'owner-user'), ownerCtx).allowed).toBe(true);
    expect(
      allowed('T-02', user('CUSTOMER_REQUESTER', 'someone'), tenant('cust-org', 'someone')).allowed,
    ).toBe(false);
    expect(
      allowed('T-02', user('CUSTOMER_ADMIN', 'someone'), tenant('cust-org', 'someone')).allowed,
    ).toBe(true);
  });

  it('T-08: the owner may decline, the admin may not (OQ-37 a), the system may expire', () => {
    expect(
      allowed('T-08', user('CUSTOMER_REQUESTER', 'owner-user'), tenant('cust-org', 'owner-user'))
        .allowed,
    ).toBe(true);
    expect(
      allowed('T-08', user('CUSTOMER_ADMIN', 'admin'), tenant('cust-org', 'admin')).allowed,
    ).toBe(false);
    expect(allowed('T-08', { kind: 'SYSTEM' }, system).allowed).toBe(true);
  });

  it('"C-Req (own)" of T-22 needs the requester; C-Fin and the lab checker are listed', () => {
    expect(
      allowed('T-22', user('CUSTOMER_REQUESTER', 'owner-user'), tenant('cust-org', 'owner-user'))
        .allowed,
    ).toBe(true);
    expect(
      allowed('T-22', user('CUSTOMER_REQUESTER', 'other'), tenant('cust-org', 'other')).allowed,
    ).toBe(false);
    expect(
      allowed('T-22', user('CUSTOMER_FINANCE', 'fin'), tenant('cust-org', 'fin')).allowed,
    ).toBe(true);
    expect(allowed('T-22', user('LAB_CHECKER', 'c'), tenant('lab-org', 'c')).allowed).toBe(true);
  });

  it('a system actor needs the system context and, for T-09 and T-25 to T-27, the named source', () => {
    expect(allowed('T-09', { kind: 'SYSTEM', source: 'PAYMENTS' }, system).allowed).toBe(true);
    expect(allowed('T-09', { kind: 'SYSTEM' }, system).allowed).toBe(false);
    expect(allowed('T-09', { kind: 'SYSTEM', source: 'EC-01' }, system).allowed).toBe(false);
    expect(allowed('T-25', { kind: 'SYSTEM', source: 'EC-01' }, system).allowed).toBe(true);
    expect(allowed('T-25', { kind: 'SYSTEM' }, system).allowed).toBe(false);
    expect(allowed('T-06', { kind: 'SYSTEM' }, system).allowed).toBe(true);
    expect(allowed('T-06', { kind: 'SYSTEM' }, tenant('lab-org', 'u'))).toEqual({
      allowed: false,
      reason: 'SYSTEM_ACTOR_OUTSIDE_SYSTEM_CONTEXT',
    });
  });

  it('a user never acts in the system context, and a platform role needs the platform context', () => {
    expect(allowed('T-24', user('PLATFORM_OPS', 'ops-user'), platform).allowed).toBe(true);
    expect(allowed('T-24', user('PLATFORM_OPS', 'ops-user'), system).allowed).toBe(false);
    expect(
      allowed('T-24', user('PLATFORM_OPS', 'ops-user'), tenant('lab-org', 'ops-user')).allowed,
    ).toBe(false);
    expect(allowed('T-24', user('PLATFORM_ADMIN', 'ops-user'), platform).allowed).toBe(false); // P-Ops only
  });

  it('the stated user and organisation must be the context', () => {
    expect(allowed('T-03', user('LAB_CHECKER', 'other-user'), tenant('lab-org', 'c')).allowed).toBe(
      false,
    );
    expect(
      allowed('T-03', user('LAB_CHECKER', 'c', { orgId: 'lab-org' }), tenant('lab-org', 'c'))
        .allowed,
    ).toBe(true);
    expect(
      allowed('T-03', user('LAB_CHECKER', 'c', { orgId: 'cust-org' }), tenant('lab-org', 'c')),
    ).toEqual({
      allowed: false,
      reason: 'ORG_CONTEXT_MISMATCH',
    });
  });
});
