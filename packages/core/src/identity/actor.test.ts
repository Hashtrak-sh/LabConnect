import { permissionsOf, ROLE_CODES, ROLES, type RoleCode } from '@labconnect/shared';
import { describe, expect, it } from 'vitest';
import {
  type ActorMembership,
  type ActorSession,
  actorWithoutMembership,
  buildCurrentActor,
  requireOrganisation,
} from './actor.js';
import { IdentityError } from './errors.js';

const MFA_AT = new Date('2026-11-25T10:00:00Z');
const session = (mfaVerifiedAt: Date | null = MFA_AT): ActorSession => ({
  userId: 'user-1',
  sessionId: 'sid-1',
  mfaVerifiedAt,
});
const membership = (role: RoleCode, extra: Partial<ActorMembership> = {}): ActorMembership => ({
  id: 'membership-1',
  organisationId: 'org-1',
  orgType: ROLES[role].orgType,
  orgStatus: 'ACTIVE',
  roles: [role],
  siteIds: [],
  ...extra,
});
const codeOf = (action: () => unknown): string | undefined => {
  try {
    action();
  } catch (error) {
    return error instanceof IdentityError ? error.code : 'NOT_AN_IDENTITY_ERROR';
  }
  return undefined;
};

describe('buildCurrentActor', () => {
  it.each(ROLE_CODES)('gives %s exactly the permissions of the shared role map', (role) => {
    const actor = buildCurrentActor(session(), membership(role));
    expect([...actor.permissions].sort()).toEqual(permissionsOf(role).sort());
    expect(actor.roles).toEqual([role]);
    expect(actor.orgType).toBe(ROLES[role].orgType);
    expect(actor.isPlatform).toBe(ROLES[role].orgType === 'PLATFORM');
    expect(actor.allSites).toBe(actor.isPlatform);
  });

  it('unions the permissions of several roles of one membership (RR-1)', () => {
    const actor = buildCurrentActor(
      session(),
      membership('CUSTOMER_ADMIN', { roles: ['CUSTOMER_FINANCE', 'CUSTOMER_REQUESTER'] }),
    );
    const expected = new Set([
      ...permissionsOf('CUSTOMER_FINANCE'),
      ...permissionsOf('CUSTOMER_REQUESTER'),
    ]);
    expect(actor.permissions).toEqual(expected);
    expect(actor.roles).toEqual(['CUSTOMER_FINANCE', 'CUSTOMER_REQUESTER']);
  });

  it('carries the ids and the session facts, and is immutable', () => {
    const actor = buildCurrentActor(session(), membership('LAB_MAKER'));
    expect(actor).toMatchObject({
      userId: 'user-1',
      sessionId: 'sid-1',
      membershipId: 'membership-1',
      orgId: 'org-1',
      mfaVerifiedAt: MFA_AT,
    });
    expect(Object.isFrozen(actor)).toBe(true);
    expect(Object.isFrozen(actor.roles)).toBe(true);
  });

  it('keeps the lab sites of a lab member, once each; an empty list means no site', () => {
    const withSites = buildCurrentActor(
      session(),
      membership('LAB_MAKER', { siteIds: ['site-a', 'site-b', 'site-a'] }),
    );
    expect(withSites.siteIds).toEqual(['site-a', 'site-b']);
    expect(withSites.allSites).toBe(false);
    expect(buildCurrentActor(session(), membership('LAB_MAKER')).siteIds).toEqual([]);
  });

  it('gives sites to nobody but a lab member, and "all sites" to platform staff only', () => {
    const customer = buildCurrentActor(
      session(),
      membership('CUSTOMER_ADMIN', { siteIds: ['site-a'] }),
    );
    expect(customer.siteIds).toEqual([]);
    expect(customer.allSites).toBe(false);
    const ops = buildCurrentActor(session(), membership('PLATFORM_OPS'));
    expect(ops.siteIds).toEqual([]);
    expect(ops.allSites).toBe(true);
  });

  it.each(['SUSPENDED', 'CLOSED'] as const)(
    'refuses a membership of a %s organisation with 403',
    (orgStatus) => {
      expect(
        codeOf(() => buildCurrentActor(session(), membership('LAB_MAKER', { orgStatus }))),
      ).toBe('FORBIDDEN');
    },
  );

  it('refuses a membership with no role, and drops a role that does not fit the organisation type', () => {
    expect(codeOf(() => buildCurrentActor(session(), membership('LAB_MAKER', { roles: [] })))).toBe(
      'FORBIDDEN',
    );
    // A platform role on a customer membership grants nothing (the database forbids it, RR-5).
    expect(
      codeOf(() =>
        buildCurrentActor(
          session(),
          membership('CUSTOMER_ADMIN', { roles: ['PLATFORM_ADMIN', 'LAB_CHECKER'] }),
        ),
      ),
    ).toBe('FORBIDDEN');
    const mixed = buildCurrentActor(
      session(),
      membership('CUSTOMER_ADMIN', { roles: ['PLATFORM_ADMIN', 'CUSTOMER_ADMIN'] }),
    );
    expect(mixed.roles).toEqual(['CUSTOMER_ADMIN']);
    expect(mixed.permissions.has('platform_config.manage')).toBe(false);
  });

  describe('MFA-required roles (the AuthGuard full-session rule is not the only line)', () => {
    const required = ROLE_CODES.filter((role) => ROLES[role].mfa === 'REQUIRED');
    const notRequired = ROLE_CODES.filter((role) => ROLES[role].mfa !== 'REQUIRED');

    it.each(required)('refuses %s with STEP_UP_REQUIRED when MFA never completed', (role) => {
      expect(codeOf(() => buildCurrentActor(session(null), membership(role)))).toBe(
        'STEP_UP_REQUIRED',
      );
    });

    it.each(required)('lets %s through once MFA completed', (role) => {
      expect(codeOf(() => buildCurrentActor(session(MFA_AT), membership(role)))).toBeUndefined();
    });

    it.each(notRequired)('lets %s through without MFA', (role) => {
      expect(codeOf(() => buildCurrentActor(session(null), membership(role)))).toBeUndefined();
    });

    it('says why, so a client can tell it from a stale step-up', () => {
      try {
        buildCurrentActor(session(null), membership('LAB_CHECKER'));
        expect.fail('expected a refusal');
      } catch (error) {
        expect((error as IdentityError).meta).toEqual({ reason: 'MFA_REQUIRED_FOR_ROLE' });
      }
    });
  });
});

describe('a user with no membership', () => {
  it('is an actor with no organisation, no roles and no permissions', () => {
    const actor = actorWithoutMembership(session(null));
    expect(actor).toMatchObject({
      userId: 'user-1',
      membershipId: null,
      orgId: null,
      orgType: null,
      allSites: false,
      isPlatform: false,
    });
    expect(actor.roles).toEqual([]);
    expect(actor.permissions.size).toBe(0);
    expect(actor.siteIds).toEqual([]);
  });

  it('cannot become an organisation actor', () => {
    expect(codeOf(() => requireOrganisation(actorWithoutMembership(session())))).toBe('FORBIDDEN');
    const member = buildCurrentActor(session(), membership('CUSTOMER_ADMIN'));
    expect(requireOrganisation(member).orgId).toBe('org-1');
  });
});
