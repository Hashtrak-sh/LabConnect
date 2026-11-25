// The permission matrix over the REAL app (P3-05): every implemented route that declares
// permissions, as every role of the shared permission map. The app declares none yet (the routes
// today are public or session-only), so the matrix has no cells and the run says so; the first
// `@Authorised` route turns this suite on with no change to it. test/permissions/declaration.real.spec.ts
// guarantees no route escapes the matrix by being left undeclared.
import { ROLE_CODES } from '@labconnect/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from '../../support/identity-app.js';
import { buildWorld, clientFactory, type World } from '../../support/isolation/world.js';
import { formatFindings, isMatrixRoute, runMatrix } from '../../support/permissions/matrix.js';
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

  it('allows exactly the roles the permission map allows on every route that declares permissions', async () => {
    const matrixRoutes = routes.filter(isMatrixRoute);
    if (matrixRoutes.length === 0) return; // nothing declares permissions yet
    const world: World = await buildWorld(t);
    const clients = clientFactory(t, { withMfa: true });
    const run = await runMatrix({ routes, clientOf: (role) => clients(world.byRole(role)) });
    expect(formatFindings(run.findings)).toEqual([]);
  });
});
