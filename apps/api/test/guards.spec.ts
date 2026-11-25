// AuthGuard, MembershipGuard, PermissionGuard and MfaGuard over HTTP (P3-04), with a faked identity
// service (no database) and test-only controllers. The real app's routes stay those of the
// contract. The same guards against real memberships are tested in test/integration/.
import 'reflect-metadata';
import { type INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import {
  assertStepUp,
  buildCurrentActor,
  FixedClock,
  IdentityError,
  type CurrentActor,
} from '@labconnect/core';
import { ROLES, type RoleCode } from '@labconnect/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { configureApp } from '../src/app.config.js';
import {
  type AuthenticatedSession,
  IdentityService,
} from '../src/modules/identity/identity.service.js';
import { expectProblemResponse, undocumentedRequest } from './support/contract/index.js';
import { GuardProbeController, type ActorSummary } from './support/guard-probe.js';

const NOW = '2026-11-25T10:00:00Z';
const clock = new FixedClock(NOW);
const minutesAgo = (minutes: number): Date => new Date(clock.now().getTime() - minutes * 60_000);

interface Persona {
  userId: string;
  mfaAt: Date | null;
  partial?: boolean;
  /** Memberships by id; the first is the session's. Empty: a user with no membership. */
  memberships: { id: string; orgId: string; role: RoleCode; siteIds?: string[] }[];
}
const persona = (
  userId: string,
  role: RoleCode,
  mfaAt: Date | null = minutesAgo(1),
  extra: Partial<Persona> = {},
): Persona => ({
  userId,
  mfaAt,
  memberships: [{ id: `m-${userId}`, orgId: `org-of-${userId}`, role, siteIds: ['site-1'] }],
  ...extra,
});

/** Tokens are persona names. Everything else about identity is the real core code. */
const PERSONAS: Record<string, Persona> = {
  maker: persona('maker', 'LAB_MAKER', null),
  'checker-fresh': persona('checker-fresh', 'LAB_CHECKER', minutesAgo(1)),
  'checker-stale': persona('checker-stale', 'LAB_CHECKER', minutesAgo(10)),
  'checker-nomfa': persona('checker-nomfa', 'LAB_CHECKER', null),
  'checker-partial': persona('checker-partial', 'LAB_CHECKER', null, { partial: true }),
  customer: persona('customer', 'CUSTOMER_ADMIN', null),
  ops: persona('ops', 'PLATFORM_OPS', minutesAgo(1)),
  nobody: { userId: 'nobody', mfaAt: null, memberships: [] },
  consultant: {
    userId: 'consultant',
    mfaAt: null,
    memberships: [
      { id: 'm-org-a', orgId: 'org-a', role: 'CUSTOMER_REQUESTER' },
      { id: 'm-org-b', orgId: 'org-b', role: 'CUSTOMER_REQUESTER' },
    ],
  },
};

class FakeIdentity {
  authenticate(token: string): Promise<AuthenticatedSession> {
    const found = PERSONAS[token];
    if (!found) return Promise.reject(new IdentityError('UNAUTHENTICATED'));
    return Promise.resolve({
      rowId: 'row',
      sessionId: `sid-${found.userId}`,
      userId: found.userId,
      activeMembershipId: found.memberships[0]?.id ?? null,
      mfaVerifiedAt: found.mfaAt,
      startedAt: clock.now(),
      expiresAt: clock.now(),
      partial: found.partial === true,
    });
  }

  resolveActor(session: AuthenticatedSession, requested?: string): Promise<CurrentActor> {
    const found = Object.values(PERSONAS).find((p) => p.userId === session.userId);
    const chosenId = requested ?? session.activeMembershipId;
    if (chosenId === null) {
      return Promise.resolve(buildCurrentActorWithoutMembership(session));
    }
    const membership = found?.memberships.find((m) => m.id === chosenId);
    if (!membership) {
      return Promise.reject(new IdentityError(requested === undefined ? 'FORBIDDEN' : 'NOT_FOUND'));
    }
    try {
      return Promise.resolve(
        buildCurrentActor(session, {
          id: membership.id,
          organisationId: membership.orgId,
          orgType: ROLES[membership.role].orgType,
          orgStatus: 'ACTIVE',
          roles: [membership.role],
          siteIds: membership.siteIds ?? [],
        }),
      );
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('unknown'));
    }
  }

  assertStepUp(session: AuthenticatedSession, maxAgeSeconds?: number): void {
    assertStepUp(session, clock, maxAgeSeconds);
  }
}

function buildCurrentActorWithoutMembership(session: AuthenticatedSession): CurrentActor {
  return {
    userId: session.userId,
    sessionId: session.sessionId,
    membershipId: null,
    orgId: null,
    orgType: null,
    roles: [],
    permissions: new Set(),
    siteIds: [],
    allSites: false,
    mfaVerifiedAt: session.mfaVerifiedAt,
    isPlatform: false,
  };
}

describe('guards over HTTP', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    // The guard logs the route that forgot its declaration; keep the test output clean.
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      controllers: [GuardProbeController],
      providers: [{ provide: IdentityService, useClass: FakeIdentity }],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  const http = () => undocumentedRequest(app);
  const as = (token: string, headers: Record<string, string> = {}) => ({
    headers: { Authorization: `Bearer ${token}`, ...headers },
  });
  const body = (response: { body: unknown }) => response.body as ActorSummary;

  describe('authentication (AuthGuard)', () => {
    it.each(['decide', 'forgotten', 'open', 'class-level'])(
      '401 UNAUTHENTICATED without a token on %s',
      async (route) => {
        const response = await http().get(`/v1/guard-probe/${route}`);
        expect(response.status).toBe(401);
        expectProblemResponse(response);
        expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
      },
    );

    it('401 for a token the identity service does not know, and for a malformed header', async () => {
      expect((await http().get('/v1/guard-probe/decide', as('nobody-knows-me'))).status).toBe(401);
      const malformed = await http().get('/v1/guard-probe/decide', {
        headers: { Authorization: 'Basic abc' },
      });
      expect(malformed.status).toBe(401);
    });

    it('answers 401 before it can answer 403: an anonymous caller learns nothing about permissions', async () => {
      const response = await http().get('/v1/guard-probe/decide');
      expect(response.body).toMatchObject({ status: 401 });
    });

    it('401 for a partial (pre-MFA) session on a protected route', async () => {
      const response = await http().get('/v1/guard-probe/decide', as('checker-partial'));
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    });
  });

  describe('permission (PermissionGuard)', () => {
    it('403 FORBIDDEN as problem+json when the role lacks the permission', async () => {
      const response = await http().get('/v1/guard-probe/decide', as('maker'));
      expect(response.status).toBe(403);
      expectProblemResponse(response);
      expect(response.body).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    });

    it('lets the role that holds it through, with the actor built from the membership', async () => {
      const response = await http().get('/v1/guard-probe/decide', as('checker-fresh'));
      expect(response.status).toBe(200);
      expect(body(response)).toMatchObject({
        userId: 'checker-fresh',
        orgId: 'org-of-checker-fresh',
        orgType: 'LAB',
        roles: ['LAB_CHECKER'],
        isPlatform: false,
      });
    });

    it('refuses other roles, customers included', async () => {
      for (const token of ['customer', 'maker']) {
        expect((await http().get('/v1/guard-probe/decide', as(token))).status, token).toBe(403);
      }
    });

    it('is a role-level check: a CONDITIONAL grant (Ops on booking.decide, note 4) passes here and is the service to refuse', async () => {
      // OQ-24 says Ops may not override a lab decision; no transition exists for it. The guard
      // follows the shared matrix (hasPermission: any form of grant), see OQ-105.
      expect((await http().get('/v1/guard-probe/decide', as('ops'))).status).toBe(200);
    });

    it('FAILS CLOSED: a route behind the guards with no declaration refuses everyone', async () => {
      for (const token of ['maker', 'checker-fresh', 'customer', 'ops', 'nobody']) {
        const response = await http().get('/v1/guard-probe/forgotten', as(token));
        expect(response.status, token).toBe(403);
        expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
      }
    });

    it('serves an explicit @NoPermissionRequired() route to any signed-in actor, no membership included', async () => {
      const nobody = await http().get('/v1/guard-probe/open', as('nobody'));
      expect(nobody.status).toBe(200);
      expect(body(nobody)).toMatchObject({
        orgId: null,
        membershipId: null,
        roles: [],
        permissionCount: 0,
      });
      expect((await http().get('/v1/guard-probe/open', as('maker'))).status).toBe(200);
    });

    it('refuses a user with no membership on a route that declares a permission', async () => {
      const response = await http().get('/v1/guard-probe/class-level', as('nobody'));
      expect(response.status).toBe(403);
    });
  });

  describe('step-up MFA (MfaGuard)', () => {
    it('401 STEP_UP_REQUIRED, with the age that is accepted, when MFA is too old', async () => {
      const response = await http().post('/v1/guard-probe/publish', as('checker-stale'));
      expect(response.status).toBe(401);
      expectProblemResponse(response);
      expect(response.body).toMatchObject({
        code: 'STEP_UP_REQUIRED',
        meta: { maxAgeSeconds: 300 },
      });
    });

    it('lets a fresh MFA through', async () => {
      expect((await http().post('/v1/guard-probe/publish', as('checker-fresh'))).status).toBe(200);
    });

    it('honours the maximum age of the route', async () => {
      // MFA was 1 minute ago; the route accepts 30 seconds.
      const response = await http().post('/v1/guard-probe/publish-fresh', as('checker-fresh'));
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        code: 'STEP_UP_REQUIRED',
        meta: { maxAgeSeconds: 30 },
      });
    });

    it('asks for permission before it asks for step-up: a Maker is 403, not 401', async () => {
      const response = await http().post('/v1/guard-probe/publish', as('maker'));
      expect(response.status).toBe(403);
    });
  });

  describe('MFA-required roles (AuthGuard full-session rule, and the actor as the second line)', () => {
    it('a full session of a Checker who never did MFA gets no actor: 401 STEP_UP_REQUIRED, on every route', async () => {
      for (const route of ['decide', 'open', 'class-level']) {
        const response = await http().get(`/v1/guard-probe/${route}`, as('checker-nomfa'));
        expect(response.status, route).toBe(401);
        expect(response.body, route).toMatchObject({ code: 'STEP_UP_REQUIRED' });
      }
    });

    it('a partial session never reaches the membership guard at all', async () => {
      const response = await http().get('/v1/guard-probe/open', as('checker-partial'));
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('a role that does not require MFA works without it', async () => {
      expect((await http().get('/v1/guard-probe/open', as('maker'))).status).toBe(200);
      expect((await http().get('/v1/guard-probe/open', as('customer'))).status).toBe(200);
    });
  });

  describe('the organisation never comes from the client', () => {
    it('ignores an organisation id in the body, the query and a header', async () => {
      const response = await http().post('/v1/guard-probe/whoami?orgId=org-evil', {
        ...as('customer', { 'X-Org-Id': 'org-evil' }),
        body: { orgId: 'org-evil', organisationId: 'org-evil' },
      });
      expect(response.status).toBe(200);
      const result = response.body as {
        actor: ActorSummary;
        clientSent: Record<string, string>;
      };
      expect(result.actor.orgId).toBe('org-of-customer');
      // The handler did receive the foreign id; it is just not what the actor is.
      expect(result.clientSent).toEqual({
        bodyOrgId: 'org-evil',
        bodyOrganisationId: 'org-evil',
        queryOrgId: 'org-evil',
        headerOrgId: 'org-evil',
      });
    });

    it('X-Active-Membership only chooses among the user own memberships', async () => {
      const own = await http().post('/v1/guard-probe/whoami', as('consultant'));
      expect((own.body as { actor: ActorSummary }).actor.orgId).toBe('org-a');
      const switched = await http().post(
        '/v1/guard-probe/whoami',
        as('consultant', { 'X-Active-Membership': 'm-org-b' }),
      );
      expect((switched.body as { actor: ActorSummary }).actor.orgId).toBe('org-b');
    });

    it('404 for an X-Active-Membership that is not the user own', async () => {
      for (const value of ['m-of-someone-else', 'org-b', '']) {
        const response = await http().post(
          '/v1/guard-probe/whoami',
          as('consultant', { 'X-Active-Membership': value }),
        );
        expect(response.status, value).toBe(404);
        expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
      }
    });
  });

  describe('resource checks reach the client as the catalogued problem', () => {
    it('404 for a lab site outside the actor sites, 200 for an assigned one', async () => {
      const outside = await http().get('/v1/guard-probe/sites/site-9', as('maker'));
      expect(outside.status).toBe(404);
      expect(outside.body).toMatchObject({ code: 'NOT_FOUND' });
      expect((await http().get('/v1/guard-probe/sites/site-1', as('maker'))).status).toBe(200);
    });

    it('403 SELF_APPROVAL_FORBIDDEN when the Checker approves their own record', async () => {
      const self = await http().post('/v1/guard-probe/approve', {
        ...as('checker-fresh'),
        body: { makerUserId: 'checker-fresh' },
      });
      expect(self.status).toBe(403);
      expect(self.body).toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN' });
      const other = await http().post('/v1/guard-probe/approve', {
        ...as('checker-fresh'),
        body: { makerUserId: 'maker' },
      });
      expect(other.status).toBe(200);
    });
  });
});
