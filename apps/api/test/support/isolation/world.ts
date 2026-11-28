// Two tenants of each kind, with users, memberships and data, and a signed-in client per user
// (P3-05). The data comes from the shared factories (`@labconnect/database/test-utils`), written
// on the owner connection like every other database test; the API then reads it as `app_rw`
// under row-level security. Both the permission-matrix tests (one user per role) and the
// isolation tests (tenant A against tenant B) build on this.
import type { INestApplication } from '@nestjs/common';
import {
  addMember,
  type CustomerFixture,
  type LabFixture,
  createCatalogue,
  createCustomer,
  createLab,
  createPlatformTeam,
  createPublishedChangeSet,
  createUser,
  loadReference,
  seedReference,
} from '@labconnect/database/test-utils';
import { type OrgType, ROLES, type RoleCode } from '@labconnect/shared';
import type { Server } from 'node:http';
import type { Response } from 'supertest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { useIdentityApp } from '../identity-app.js';

export type IdentityApp = ReturnType<typeof useIdentityApp>;

export interface TenantUser {
  id: string;
  email: string;
  /** The one lab or customer or platform role this user holds. */
  role: RoleCode;
  organisationId: string;
  membershipId: string;
}

export interface Tenant {
  label: string;
  orgType: OrgType;
  organisationId: string;
  displayName: string;
  users: readonly TenantUser[];
  /** Lab sites (labs) or the default customer site (customers). */
  siteIds: readonly string[];
  /** The user holding a role in this tenant. Throws if there is none. */
  user(role: RoleCode): TenantUser;
  /**
   * Values that identify this tenant: ids, emails, names. None of them may appear in a response
   * to someone outside the tenant.
   */
  markers(): string[];
}

export interface World {
  customerA: Tenant;
  customerB: Tenant;
  labA: Tenant;
  labB: Tenant;
  platform: Tenant;
  /** A requester with an active membership in both customer A and customer B. */
  dual: { user: TenantUser; inA: TenantUser; inB: TenantUser };
  /** A Maker of lab A assigned to the first site only (site scope, TENANT_ISOLATION rule 4). */
  siteMaker: TenantUser;
  /** One user per role, each in its own tenant (customer A, lab A, platform). */
  byRole(role: RoleCode): TenantUser;
  /** The factory fixtures behind the tenants, for tests that add bookings (`bookingInState`). */
  fixtures: {
    customerA: CustomerFixture;
    customerB: CustomerFixture;
    labA: LabFixture;
    labB: LabFixture;
  };
}

const PATIENT = { timeout: 240_000, maxWait: 60_000 };

function tenantOf(
  label: string,
  orgType: OrgType,
  organisationId: string,
  displayName: string,
  users: TenantUser[],
  siteIds: string[],
): Tenant {
  return {
    label,
    orgType,
    organisationId,
    displayName,
    users,
    siteIds,
    user(role) {
      const found = users.find((candidate) => candidate.role === role);
      if (!found) throw new Error(`${label} has no ${role} user`);
      return found;
    },
    markers() {
      return [
        organisationId,
        displayName,
        ...users.flatMap((user) => [user.id, user.email, user.membershipId]),
        ...siteIds,
      ];
    },
  };
}

/**
 * Builds the world in one transaction on the owner connection (reference data, catalogue, labs
 * with two sites each, customers, the platform team) and reads back the ids the tests need.
 */
export async function buildWorld(t: IdentityApp): Promise<World> {
  const created = await t.owner(async (tx) => {
    await seedReference(tx);
    const reference = await loadReference(tx);
    const platform = await createPlatformTeam(tx);
    const changeSetId = await createPublishedChangeSet(tx, platform, 'DEMO isolation world');
    const catalogue = await createCatalogue(tx, reference, changeSetId);
    const context = { reference, platform, catalogue, changeSetId };
    const customerA = await createCustomer(tx, { name: 'DEMO Customer Alpha' });
    const customerB = await createCustomer(tx, { name: 'DEMO Customer Bravo' });
    const labA = await createLab(tx, context, { name: 'DEMO Lab Alpha', sites: [{}, {}] });
    const labB = await createLab(tx, context, { name: 'DEMO Lab Bravo', sites: [{}, {}] });
    const dualUser = await createUser(tx, {
      email: `consultant.${randomUUID().slice(0, 8)}@demo.labconnect.test`,
      fullName: 'DEMO Consultant',
    });
    const dualInA = await addMember(tx, dualUser, customerA.organisationId, 'CUSTOMER_REQUESTER');
    const dualInB = await addMember(tx, dualUser, customerB.organisationId, 'CUSTOMER_REQUESTER');
    const siteMakerId = await createUser(tx, {
      email: `sitemaker.${randomUUID().slice(0, 8)}@demo.labconnect.test`,
      fullName: 'DEMO Site Maker',
    });
    const firstSite = labA.sites[0];
    if (!firstSite) throw new Error('the lab has no site');
    const siteMakerMembership = await addMember(tx, siteMakerId, labA.organisationId, 'LAB_MAKER', [
      firstSite.id,
    ]);
    return {
      platform,
      customerA,
      customerB,
      labA,
      labB,
      dualUser,
      dualInA,
      dualInB,
      siteMakerId,
      siteMakerMembership,
    };
  }, PATIENT);

  const person = async (
    id: string,
    role: RoleCode,
    organisationId: string,
  ): Promise<TenantUser> => {
    const row = await t.db().query<{ id: string; email: string }>(
      `SELECT m.id, u.email FROM membership m JOIN app_user u ON u.id = m.user_id
          WHERE m.user_id = $1 AND m.organisation_id = $2`,
      [id, organisationId],
    );
    const found = row.rows[0];
    if (!found) throw new Error(`no membership of ${id} in ${organisationId}`);
    return { id, email: found.email, role, organisationId, membershipId: found.id };
  };
  const nameOf = async (organisationId: string): Promise<string> =>
    (
      await t
        .db()
        .query<{ display_name: string }>('SELECT display_name FROM organisation WHERE id = $1', [
          organisationId,
        ])
    ).rows[0]?.display_name ?? '';

  const customer = async (label: string, c: typeof created.customerA): Promise<Tenant> =>
    tenantOf(
      label,
      'CUSTOMER',
      c.organisationId,
      await nameOf(c.organisationId),
      [
        await person(c.admin, 'CUSTOMER_ADMIN', c.organisationId),
        await person(c.requester ?? '', 'CUSTOMER_REQUESTER', c.organisationId),
        await person(c.finance ?? '', 'CUSTOMER_FINANCE', c.organisationId),
      ],
      [c.siteId],
    );
  const lab = async (label: string, l: typeof created.labA): Promise<Tenant> =>
    tenantOf(
      label,
      'LAB',
      l.organisationId,
      await nameOf(l.organisationId),
      [
        await person(l.makers[0] ?? '', 'LAB_MAKER', l.organisationId),
        await person(l.checkers[0] ?? '', 'LAB_CHECKER', l.organisationId),
      ],
      l.sites.map((site) => site.id),
    );

  const customerA = await customer('customer A', created.customerA);
  const customerB = await customer('customer B', created.customerB);
  const labA = await lab('lab A', created.labA);
  const labB = await lab('lab B', created.labB);
  const team = created.platform;
  const platform = tenantOf(
    'platform',
    'PLATFORM',
    team.organisationId,
    await nameOf(team.organisationId),
    [
      await person(team.ops, 'PLATFORM_OPS', team.organisationId),
      await person(team.steward, 'PLATFORM_DATA_STEWARD', team.organisationId),
      await person(team.finance, 'PLATFORM_FINANCE', team.organisationId),
      await person(team.admin, 'PLATFORM_ADMIN', team.organisationId),
    ],
    [],
  );
  const inA = await person(created.dualUser, 'CUSTOMER_REQUESTER', customerA.organisationId);
  const inB = await person(created.dualUser, 'CUSTOMER_REQUESTER', customerB.organisationId);
  const siteMaker = await person(created.siteMakerId, 'LAB_MAKER', labA.organisationId);

  const byRoleTenants = [customerA, labA, platform];
  return {
    customerA,
    customerB,
    labA,
    labB,
    platform,
    dual: { user: inA, inA, inB },
    siteMaker,
    fixtures: {
      customerA: created.customerA,
      customerB: created.customerB,
      labA: created.labA,
      labB: created.labB,
    },
    byRole(role) {
      const tenant = byRoleTenants.find((candidate) => ROLES[role].orgType === candidate.orgType);
      if (!tenant) throw new Error(`no tenant for ${role}`);
      return tenant.user(role);
    },
  };
}

// ------------------------------------------------------------------------------------ clients

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface CallOptions {
  body?: unknown;
  headers?: Record<string, string>;
  /** Overrides the client's own token (for example `''` to send none). */
  token?: string | null;
}

/** A signed-in user: calls any route of the app, documented or not, with a real access token. */
export interface Client {
  user: TenantUser;
  call(method: HttpMethod, path: string, options?: CallOptions): Promise<Response>;
  get(path: string, options?: CallOptions): Promise<Response>;
  post(path: string, options?: CallOptions): Promise<Response>;
  put(path: string, options?: CallOptions): Promise<Response>;
  delete(path: string, options?: CallOptions): Promise<Response>;
  /** The same user, acting through another of their memberships for each request. */
  asMembership(membershipId: string): Client;
}

/** How long a token is reused before the client signs in again (the access token lives 10 minutes). */
const REUSE_SECONDS = 240;

let address = 0;
const nextAddress = (): string => {
  address += 1;
  return `10.${String((address >> 16) & 255)}.${String((address >> 8) & 255)}.${String(address & 255)}`;
};

/**
 * Real sign-in (OTP, then TOTP for a role that requires MFA), once per user, repeated only when
 * the token is old. Roles that do not require MFA enrol it too when `withMfa` is set, so their
 * session also passes a step-up (the permission matrix uses that).
 */
export function clientFactory(
  t: IdentityApp,
  options: { withMfa?: boolean } = {},
): (user: TenantUser, membershipId?: string) => Client {
  const sessions = new Map<string, { token: string; at: number; secret?: string }>();

  const token = async (user: TenantUser): Promise<string> => {
    const seen = sessions.get(user.id);
    const now = t.clock.now().getTime();
    if (seen && now - seen.at < REUSE_SECONDS * 1000) return seen.token;
    const needsMfa = options.withMfa === true || ROLES[user.role].mfa === 'REQUIRED';
    const signedIn = needsMfa
      ? await t.signInWithMfa(user.email, seen?.secret)
      : await t.signIn(user.email);
    sessions.set(user.id, {
      token: signedIn.accessToken,
      at: t.clock.now().getTime(),
      ...('secret' in signedIn &&
        typeof signedIn.secret === 'string' && {
          secret: signedIn.secret,
        }),
    });
    return signedIn.accessToken;
  };

  const make = (user: TenantUser, membershipId?: string): Client => {
    const call: Client['call'] = async (method, path, callOptions = {}) => {
      const bearer =
        callOptions.token === undefined ? await token(user) : (callOptions.token ?? undefined);
      const app: INestApplication<Server> = t.app();
      let test = request(app.getHttpServer())[method](path).set('X-Forwarded-For', nextAddress());
      if (bearer !== undefined && bearer !== '')
        test = test.set('Authorization', `Bearer ${bearer}`);
      if (membershipId !== undefined) test = test.set('X-Active-Membership', membershipId);
      if (method !== 'get' && method !== 'delete') test = test.set('Idempotency-Key', randomUUID());
      for (const [name, value] of Object.entries(callOptions.headers ?? {})) {
        test = test.set(name, value);
      }
      if (callOptions.body !== undefined) test = test.send(callOptions.body as object);
      return test;
    };
    return {
      user,
      call,
      get: (path, o) => call('get', path, o),
      post: (path, o) => call('post', path, o),
      put: (path, o) => call('put', path, o),
      delete: (path, o) => call('delete', path, o),
      asMembership: (id) => make(user, id),
    };
  };
  return make;
}
