// The permission matrix over the REAL app (P3-05): every implemented route that declares
// permissions, as every role of the shared permission map. The app declares none yet (the routes
// today are public or session-only), so the matrix has no cells and the run says so; the first
// `@Authorised` route turns this suite on with no change to it. test/permissions/declaration.real.spec.ts
// guarantees no route escapes the matrix by being left undeclared.
import { grantOf, type PermissionCode, ROLE_CODES } from '@labconnect/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { HANDLER_REFUSALS, SESSION_ONLY_REFUSALS } from '../../permissions/handler-refusals.js';
import { useIdentityApp } from '../../support/identity-app.js';
import { buildWorld, clientFactory, type World } from '../../support/isolation/world.js';
import {
  formatFindings,
  isMatrixRoute,
  matrixCells,
  runMatrix,
} from '../../support/permissions/matrix.js';
import {
  assertRoutesFound,
  describeRoutes,
  type RouteDeclaration,
  summariseRoutes,
} from '../../support/permissions/route-declarations.js';

describe('permission matrix of the real app', () => {
  const t = useIdentityApp();
  let routes: RouteDeclaration[];

  beforeAll(() => {
    routes = describeRoutes(t.app());
  });

  it('reads the routes, prints what they are, and fails if it finds none', () => {
    assertRoutesFound(routes);
    const matrixRoutes = routes.filter(isMatrixRoute);
    console.info(
      `Permission matrix (real app): ${summariseRoutes(routes)}; ` +
        `${String(matrixRoutes.length)} routes x ${String(ROLE_CODES.length)} roles = ${String(matrixRoutes.length * ROLE_CODES.length)} cells`,
    );
  });

  it('lists each handler refusal as a served route and a conditional grant, with a reason', () => {
    const served = new Set(routes.map((route) => route.key));
    for (const entry of HANDLER_REFUSALS) {
      expect(served.has(entry.route), `${entry.route} is not served`).toBe(true);
      expect(entry.reason.trim().length, entry.route).toBeGreaterThan(30);
      // Only a conditional grant may be refused by the handler: a plain grant is a guard matter.
      expect(grantOf(entry.role, entry.permission as PermissionCode)).toMatchObject({
        access: 'CONDITIONAL',
      });
      const declared = routes.find((route) => route.key === entry.route)?.requirement;
      expect(declared?.codes, entry.route).toContain(entry.permission);
    }
  });

  it('lists each session-only refusal as a served session-only route, with a reason', () => {
    for (const entry of SESSION_ONLY_REFUSALS) {
      const route = routes.find((candidate) => candidate.key === entry.route);
      expect(route, `${entry.route} is not served`).toBeDefined();
      expect(route?.category, entry.route).toBe('authorised-none');
      expect(entry.reason.trim().length, entry.route).toBeGreaterThan(30);
      expect(entry.roles.length, entry.route).toBeGreaterThan(0);
    }
  });

  it('expects the lab claim operations of Ops to be open to PLATFORM_OPS alone, as the contract says', () => {
    const claimRoutes = routes.filter((route) => route.path.startsWith('/v1/admin/claims'));
    expect(claimRoutes.map((route) => route.key).sort()).toEqual([
      'GET /v1/admin/claims',
      'GET /v1/admin/claims/:id',
      'POST /v1/admin/claims/:id/approve',
      'POST /v1/admin/claims/:id/letterhead/download-url',
      'POST /v1/admin/claims/:id/reject',
    ]);
    for (const cell of matrixCells(claimRoutes)) {
      expect(cell.expected, `${cell.route.key} as ${cell.role}`).toBe(
        cell.role === 'PLATFORM_OPS' ? 'allow' : 'deny',
      );
    }
  });

  it('allows exactly the roles the permission map allows on every route that declares permissions', async () => {
    const matrixRoutes = routes.filter(isMatrixRoute);
    if (matrixRoutes.length === 0) return; // nothing declares permissions yet
    const world: World = await buildWorld(t);
    const clients = clientFactory(t, { withMfa: true });
    const run = await runMatrix({ routes, clientOf: (role) => clients(world.byRole(role)) });
    expect(formatFindings(run.findings)).toEqual([]);
  });
});
