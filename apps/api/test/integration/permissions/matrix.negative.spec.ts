// Negative control of the permission matrix (P3-05): the same generator over the same fixture
// routes, with a PermissionGuard that wrongly lets one role through everywhere. The matrix must
// report exactly the cells where that role should have been refused. If this ever passes with no
// findings, the matrix has stopped checking.
import { ROLE_CODES } from '@labconnect/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { LeakyPermissionGuard } from '../../support/fixtures/leaky-permission-guard.js';
import { PermissionFixtureModule } from '../../support/fixtures/permission-fixtures.js';
import { useIdentityApp } from '../../support/identity-app.js';
import { buildWorld, clientFactory, type World } from '../../support/isolation/world.js';
import { matrixCells, runMatrix } from '../../support/permissions/matrix.js';
import {
  describeRoutes,
  type RouteDeclaration,
} from '../../support/permissions/route-declarations.js';
import { PermissionGuard } from '../../../src/modules/identity/permission.guard.js';

/** The role the map does not allow on most fixture routes, registered as allowed by the leak. */
const LEAKED = 'CUSTOMER_ADMIN' as const;

describe('permission matrix with a guard that allows a role the map does not', () => {
  const t = useIdentityApp({
    imports: [PermissionFixtureModule],
    configure: (builder) =>
      builder.overrideGuard(PermissionGuard).useValue(new LeakyPermissionGuard([LEAKED])),
  });
  let world: World;
  let routes: RouteDeclaration[];
  const clients = clientFactory(t, { withMfa: true });

  beforeAll(async () => {
    world = await buildWorld(t);
    routes = describeRoutes(t.app(), { controller: (n) => n === 'FixtureGoodController' });
  });

  it('reports every route where the leaked role should be denied', async () => {
    const run = await runMatrix({
      routes,
      clientOf: (role) => clients(world.byRole(role)),
      noToken: false,
    });
    const shouldBeDenied = matrixCells(routes)
      .filter((cell) => cell.role === LEAKED && cell.expected === 'deny')
      .map((cell) => cell.route.key)
      .sort();
    expect(shouldBeDenied.length).toBeGreaterThan(0);
    // Exactly those cells differ, all for the leaked role, all because it was let through.
    expect(run.findings.map((finding) => finding.route).sort()).toEqual(shouldBeDenied);
    for (const finding of run.findings) {
      expect(finding.role).toBe(LEAKED);
      expect(finding.expected).toBe('403 FORBIDDEN');
      expect(finding.actual).not.toMatch(/^403/);
    }
    expect(ROLE_CODES).toContain(LEAKED);
  });
});
