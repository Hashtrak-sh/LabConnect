// The permission-matrix generator over the fixture module (P3-05), as the real app's guards run
// it: real sign-in, real memberships, one user per role, row-level security on. The same
// `runMatrix()` runs over the real app in matrix.real.spec.ts; this file proves it on routes that
// exist today, and verifies the assumption it rests on (guards run before body validation).
import { PERMISSION_CODES, ROLE_CODES } from '@labconnect/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  isFixtureController,
  PermissionFixtureModule,
} from '../../support/fixtures/permission-fixtures.js';
import { useIdentityApp } from '../../support/identity-app.js';
import { buildWorld, clientFactory, type World } from '../../support/isolation/world.js';
import {
  formatFindings,
  isMatrixRoute,
  matrixCells,
  rolesAllowedBy,
  runMatrix,
} from '../../support/permissions/matrix.js';
import {
  describeRoutes,
  type RouteDeclaration,
} from '../../support/permissions/route-declarations.js';

describe('permission matrix over the fixture routes', () => {
  const t = useIdentityApp({ imports: [PermissionFixtureModule] });
  let world: World;
  let routes: RouteDeclaration[];
  const clients = clientFactory(t, { withMfa: true });

  beforeAll(async () => {
    world = await buildWorld(t);
    routes = describeRoutes(t.app(), { controller: (n) => n === 'FixtureGoodController' });
  });

  it('allows exactly the roles the shared permission map allows, denies the rest, and refuses no token', async () => {
    const run = await runMatrix({ routes, clientOf: (role) => clients(world.byRole(role)) });
    const matrixRoutes = routes.filter(isMatrixRoute);
    // 7 routes with a declaration x 9 roles, plus one no-token call each.
    expect(matrixRoutes).toHaveLength(7);
    expect(run.cells).toBe(7 * ROLE_CODES.length + 7);
    console.info(
      `Permission matrix (fixtures): ${String(matrixRoutes.length)} routes x ${String(ROLE_CODES.length)} roles, ${String(run.cells)} calls, ${String(run.findings.length)} findings`,
    );
    expect(formatFindings(run.findings)).toEqual([]);
  });

  it('takes the expectation from the permission map: ALL needs every code, ANY needs one', () => {
    const cells = matrixCells(routes);
    const allowedFor = (handler: string) =>
      cells
        .filter((cell) => cell.route.handler === handler && cell.expected === 'allow')
        .map((cell) => cell.role);
    // booking.pay (Admin, Requester conditionally, Finance) AND booking.create_edit (Admin,
    // Requester own, Ops conditionally): only the two customer roles hold both.
    expect(allowedFor('payAndEdit')).toEqual(['CUSTOMER_ADMIN', 'CUSTOMER_REQUESTER']);
    expect(allowedFor('either')).toEqual(['LAB_MAKER', 'LAB_CHECKER', 'PLATFORM_OPS']);
    expect(allowedFor('anyone')).toEqual([...ROLE_CODES]);
    expect(allowedFor('search')).toEqual([...ROLE_CODES]);
    expect(allowedFor('publish')).toEqual(['LAB_CHECKER']);
  });

  it('covers every role and every permission code of the map (the cells are generated, not listed)', () => {
    for (const code of PERMISSION_CODES) {
      const allowed = rolesAllowedBy({ mode: 'ALL', codes: [code] });
      for (const role of ROLE_CODES) {
        expect(allowed.includes(role), `${code} ${role}`).toBe(
          rolesAllowedBy({ mode: 'ANY', codes: [code] }).includes(role),
        );
      }
    }
  });

  it('guards run before body validation: a role without the permission gets 403 for an invalid body, an allowed role gets the handler 422', async () => {
    const path = '/v1/fx-good/items/00000000-0000-7000-8000-000000000000/edit';
    const denied = await clients(world.byRole('LAB_CHECKER')).post(path, { body: {} });
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'FORBIDDEN' });
    const allowed = await clients(world.byRole('CUSTOMER_ADMIN')).post(path, { body: {} });
    expect(allowed.status).toBe(422);
    expect(allowed.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    const valid = await clients(world.byRole('CUSTOMER_ADMIN')).post(path, {
      body: { reason: 'because' },
    });
    expect(valid.status).toBe(200);
    const noToken = await clients(world.byRole('CUSTOMER_ADMIN')).post(path, {
      body: { reason: 'x' },
      token: null,
    });
    expect(noToken.status).toBe(401);
  });

  it('a route with a step-up is reached by an allowed role with a fresh MFA', async () => {
    const response = await clients(world.byRole('LAB_CHECKER')).post('/v1/fx-good/publish', {
      body: { reason: 'ok' },
    });
    expect(response.status).toBe(200);
  });

  it('selects only fixture controllers when asked', () => {
    expect(isFixtureController('FixtureGoodController')).toBe(true);
    expect(routes.every((route) => route.controller === 'FixtureGoodController')).toBe(true);
  });
});
