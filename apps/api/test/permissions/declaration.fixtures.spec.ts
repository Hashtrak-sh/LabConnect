// Proves the declaration rules (P3-05) over a fixture module: one route per category, correct
// ones that must pass and deliberately wrong ones that must each be reported. No database.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../../src/app.config.js';
import {
  type ContractInfo,
  type ContractInfoOf,
  checkDeclarations,
  formatViolations,
} from '../support/permissions/declaration-rules.js';
import {
  describeRoutes,
  type RouteDeclaration,
  summariseRoutes,
} from '../support/permissions/route-declarations.js';
import {
  isFixtureController,
  PermissionFixtureModule,
} from '../support/fixtures/permission-fixtures.js';

const PLATFORM_FOUR = [
  'PLATFORM_OPS',
  'PLATFORM_DATA_STEWARD',
  'PLATFORM_FINANCE',
  'PLATFORM_ADMIN',
] as const;

/** What the (fake) contract says about the fixture routes. */
const CONTRACT: Record<string, Partial<ContractInfo>> = {
  'GET /v1/fx-good/open': { security: 'none' },
  'POST /v1/fx-good/publish': { stepUp: true },
  'POST /v1/fx-bad/no-step-up': { stepUp: true },
  'POST /v1/fx-bad/step-up-unenforced': { stepUp: true },
  'GET /v1/fx-bad/admin-mismatch': {
    xRoles: ['PLATFORM_FINANCE'],
    operationKey: 'GET /admin/mismatch',
  },
  'GET /v1/fx-bad/admin-open': { xRoles: ['PLATFORM_OPS'], operationKey: 'GET /admin/open' },
  'GET /v1/fx-bad/admin-agrees': { xRoles: PLATFORM_FOUR, operationKey: 'GET /admin/agrees' },
  'GET /v1/fx-bad/admin-known': { xRoles: ['PLATFORM_FINANCE'], operationKey: 'GET /admin/known' },
  'GET /v1/fx-bad/admin-known-resolved': {
    xRoles: PLATFORM_FOUR,
    operationKey: 'GET /admin/known-resolved',
  },
  'GET /v1/fx-bad/public-but-bearer': { security: 'bearer' },
};

const contractInfoOf: ContractInfoOf = (route) => ({
  operationId: route.key,
  security: 'bearer',
  stepUp: false,
  xRoles: undefined,
  operationKey: route.key,
  ...CONTRACT[route.key],
});

describe('declaration rules over fixture routes', () => {
  let app: INestApplication<Server>;
  let good: RouteDeclaration[];
  let bad: RouteDeclaration[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PermissionFixtureModule],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>();
    configureApp(app);
    await app.init();
    const all = describeRoutes(app, { controller: isFixtureController });
    good = all.filter((route) => route.controller === 'FixtureGoodController');
    bad = all.filter((route) => route.controller === 'FixtureBadController');
  });

  afterAll(async () => {
    await app.close();
  });

  it('classifies one route per category', () => {
    const byCategory = Object.fromEntries(good.map((route) => [route.path, route.category]));
    expect(byCategory).toMatchObject({
      '/v1/fx-good/open': 'public',
      '/v1/fx-good/session': 'authenticated',
      '/v1/fx-good/decide': 'authorised-all',
      '/v1/fx-good/pay-and-edit': 'authorised-all',
      '/v1/fx-good/either': 'authorised-any',
      '/v1/fx-good/anyone': 'authorised-none',
    });
    expect(bad.find((r) => r.handler === 'forgotten')?.category).toBe('undeclared');
    const publish = good.find((r) => r.handler === 'publish');
    expect(publish?.stepUp).toEqual({ maxAgeSeconds: undefined });
    expect(publish?.requirement).toEqual({ mode: 'ALL', codes: ['report.publish'] });
    console.info(`Fixture routes: ${summariseRoutes([...good, ...bad])}`);
  });

  it('finds nothing wrong with the correctly declared fixture routes', () => {
    const violations = checkDeclarations(good, {
      publicRoutes: [{ route: 'GET /v1/fx-good/open', reason: 'fixture: public on purpose' }],
      contractInfoOf,
      knownAdminDifferences: [],
      checkStale: true,
    });
    expect(formatViolations(violations)).toEqual([]);
  });

  it('reports every deliberate mistake, and only those', () => {
    const violations = checkDeclarations(bad, {
      publicRoutes: [
        { route: 'GET /v1/fx-bad/public-but-bearer', reason: 'fixture: contradicts the contract' },
        { route: 'GET /v1/fx-bad/listed-but-guarded', reason: 'fixture: has AuthGuard' },
        { route: 'GET /v1/fx-bad/stale-entry', reason: 'fixture: names a route nobody serves' },
      ],
      contractInfoOf,
      knownAdminDifferences: ['GET /admin/known', 'GET /admin/known-resolved'],
      checkStale: true,
    });
    expect(violations.map((v) => `${v.rule} ${v.route}`).sort()).toEqual(
      [
        'A GET /v1/fx-bad/unguarded',
        'A GET /v1/fx-bad/public-but-bearer',
        'A GET /v1/fx-bad/listed-but-guarded',
        'A GET /v1/fx-bad/stale-entry',
        'B GET /v1/fx-bad/forgotten',
        'B POST /v1/fx-bad/unenforced',
        'B GET /v1/fx-bad/wrong-order',
        'D POST /v1/fx-bad/no-step-up',
        'D POST /v1/fx-bad/step-up-unenforced',
        'C GET /v1/fx-bad/admin-mismatch',
        'C GET /v1/fx-bad/admin-open',
        'C GET /v1/fx-bad/admin-known-resolved',
      ].sort(),
    );
    // Each message says what to do, not only what is wrong.
    for (const violation of violations) expect(violation.message.length).toBeGreaterThan(20);
  });

  it('reports a route as unprotected when @Authorised is removed (what break 1 does)', () => {
    // The same route as a correct one, with the declaration stripped, is what the rules see as
    // the `unguarded`/`forgotten` routes above. Here: simulate on the good set directly.
    const stripped: RouteDeclaration[] = good.map((route) =>
      route.handler === 'decide'
        ? { ...route, category: 'public', guards: [], requirement: undefined }
        : route,
    );
    const violations = checkDeclarations(stripped, {
      publicRoutes: [{ route: 'GET /v1/fx-good/open', reason: 'fixture: public on purpose' }],
      contractInfoOf,
      knownAdminDifferences: [],
    });
    expect(violations.map((v) => `${v.rule} ${v.route}`)).toEqual(['A GET /v1/fx-good/decide']);
  });
});
