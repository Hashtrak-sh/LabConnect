/* eslint-disable @typescript-eslint/no-confusing-void-expression -- one-line assertions over void checks */
import { ROLES, type RoleCode } from '@labconnect/shared';
import { describe, expect, it } from 'vitest';
import { actorWithoutMembership, buildCurrentActor, type CurrentActor } from './actor.js';
import { IdentityError } from './errors.js';
import {
  assertAccess,
  assertNotSameUser,
  assertPartyOrg,
  assertPermitted,
  assertSameOrg,
  assertSiteInScope,
  assertVisible,
} from './resource-checks.js';

const MFA_AT = new Date('2026-11-25T10:00:00Z');
function actor(
  role: RoleCode,
  extra: { orgId?: string; siteIds?: string[]; userId?: string } = {},
): CurrentActor {
  return buildCurrentActor(
    { userId: extra.userId ?? 'user-1', sessionId: 'sid', mfaVerifiedAt: MFA_AT },
    {
      id: 'm-1',
      organisationId: extra.orgId ?? 'org-a',
      orgType: ROLES[role].orgType,
      orgStatus: 'ACTIVE',
      roles: [role],
      siteIds: extra.siteIds ?? [],
    },
  );
}
const codeOf = (action: () => unknown): string | undefined => {
  try {
    action();
  } catch (error) {
    return error instanceof IdentityError ? error.code : 'NOT_AN_IDENTITY_ERROR';
  }
  return undefined;
};
const nobody = actorWithoutMembership({ userId: 'u', sessionId: 's', mfaVerifiedAt: null });

describe('assertSameOrg', () => {
  it('passes for the actor organisation, and is 404 (not 403) for any other', () => {
    expect(codeOf(() => assertSameOrg(actor('LAB_CHECKER'), 'org-a'))).toBeUndefined();
    expect(codeOf(() => assertSameOrg(actor('LAB_CHECKER'), 'org-b'))).toBe('NOT_FOUND');
    expect(codeOf(() => assertSameOrg(actor('LAB_CHECKER'), null))).toBe('NOT_FOUND');
    expect(codeOf(() => assertSameOrg(actor('LAB_CHECKER'), undefined))).toBe('NOT_FOUND');
  });

  it('lets platform staff through: their access is role-based', () => {
    expect(codeOf(() => assertSameOrg(actor('PLATFORM_OPS', { orgId: 'platform' }), 'org-b'))).toBe(
      undefined,
    );
  });

  it('puts nothing in the scope of a user with no membership', () => {
    expect(codeOf(() => assertSameOrg(nobody, 'org-a'))).toBe('NOT_FOUND');
  });
});

describe('assertPartyOrg', () => {
  const parties = { customerOrgId: 'org-c', labOrgId: 'org-l' };
  it('passes for either party and is 404 for a third organisation', () => {
    expect(codeOf(() => assertPartyOrg(actor('CUSTOMER_ADMIN', { orgId: 'org-c' }), parties))).toBe(
      undefined,
    );
    expect(codeOf(() => assertPartyOrg(actor('LAB_MAKER', { orgId: 'org-l' }), parties))).toBe(
      undefined,
    );
    expect(codeOf(() => assertPartyOrg(actor('LAB_MAKER', { orgId: 'org-x' }), parties))).toBe(
      'NOT_FOUND',
    );
    expect(codeOf(() => assertPartyOrg(nobody, parties))).toBe('NOT_FOUND');
  });

  it('lets platform staff through', () => {
    expect(codeOf(() => assertPartyOrg(actor('PLATFORM_FINANCE', { orgId: 'p' }), parties))).toBe(
      undefined,
    );
  });
});

describe('assertSiteInScope', () => {
  it('passes for an assigned site and is 404 for another', () => {
    const maker = actor('LAB_MAKER', { siteIds: ['site-1', 'site-2'] });
    expect(codeOf(() => assertSiteInScope(maker, 'site-2'))).toBeUndefined();
    expect(codeOf(() => assertSiteInScope(maker, 'site-3'))).toBe('NOT_FOUND');
  });

  it('gives a lab member with no site assigned no site at all', () => {
    expect(codeOf(() => assertSiteInScope(actor('LAB_CHECKER'), 'site-1'))).toBe('NOT_FOUND');
  });

  it('gives a customer no lab site, and platform staff every one', () => {
    expect(codeOf(() => assertSiteInScope(actor('CUSTOMER_ADMIN'), 'site-1'))).toBe('NOT_FOUND');
    expect(codeOf(() => assertSiteInScope(nobody, 'site-1'))).toBe('NOT_FOUND');
    expect(codeOf(() => assertSiteInScope(actor('PLATFORM_OPS'), 'any-site'))).toBeUndefined();
  });
});

describe('assertNotSameUser (Maker is not Checker)', () => {
  it('refuses the Maker as approver with 403 SELF_APPROVAL_FORBIDDEN', () => {
    const checker = actor('LAB_CHECKER', { userId: 'user-9' });
    expect(codeOf(() => assertNotSameUser(checker, 'user-9'))).toBe('SELF_APPROVAL_FORBIDDEN');
  });

  it('passes for another user', () => {
    const checker = actor('LAB_CHECKER', { userId: 'user-9' });
    expect(codeOf(() => assertNotSameUser(checker, 'user-8'))).toBeUndefined();
  });
});

describe('assertPermitted', () => {
  it('is 403 FORBIDDEN without the permission', () => {
    expect(codeOf(() => assertPermitted(actor('LAB_MAKER'), 'receipt.record'))).toBeUndefined();
    expect(codeOf(() => assertPermitted(actor('LAB_MAKER'), 'report.publish'))).toBe('FORBIDDEN');
    expect(codeOf(() => assertPermitted(nobody, 'lab.search'))).toBe('FORBIDDEN');
  });
});

describe('the 404-versus-403 rule', () => {
  it('assertVisible: nothing found, or out of scope, is 404', () => {
    expect(codeOf(() => assertVisible(null))).toBe('NOT_FOUND');
    expect(codeOf(() => assertVisible(undefined))).toBe('NOT_FOUND');
    expect(codeOf(() => assertVisible({ org: 'b' }, (r) => r.org === 'a'))).toBe('NOT_FOUND');
    expect(assertVisible({ org: 'a' }, (r) => r.org === 'a')).toEqual({ org: 'a' });
  });

  it.each([
    { found: false, inScope: false, permitted: false, expected: 'NOT_FOUND' },
    { found: false, inScope: true, permitted: true, expected: 'NOT_FOUND' },
    { found: true, inScope: false, permitted: false, expected: 'NOT_FOUND' },
    { found: true, inScope: false, permitted: true, expected: 'NOT_FOUND' },
    { found: true, inScope: true, permitted: false, expected: 'FORBIDDEN' },
    { found: true, inScope: true, permitted: true, expected: undefined },
  ])('assertAccess %j', ({ expected, ...input }) => {
    expect(codeOf(() => assertAccess(input))).toBe(expected);
  });
});
