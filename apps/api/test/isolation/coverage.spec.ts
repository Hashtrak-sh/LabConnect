// The isolation coverage rule (P3-05), no database: every tenant-scoped route with an id has a
// registered isolation case backed by a real test. Runs over the real app (where no route takes an
// id yet) and over the fixture module (where the rule has something to find and the registry
// has to be complete). Also proves the rule fails when a registry entry is missing.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { existsSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../../src/app.config.js';
import { IsolationFixtureModule } from '../support/fixtures/isolation-fixtures.js';
import {
  callsExpectIsolated,
  checkIsolationCoverage,
  needsIsolationCase,
} from '../support/isolation/coverage.js';
import {
  assertRoutesFound,
  describeRoutes,
  type RouteDeclaration,
} from '../support/permissions/route-declarations.js';
import { createTestApp } from '../support/test-app.js';
import {
  DEMONSTRATION_CASES,
  FIXTURE_CASES,
  ISOLATION_CASES,
  REAL_APP_CASES,
  REAL_APP_EXEMPTIONS,
} from './registry.js';

const API_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const readSpec = (path: string): string | undefined => {
  const file = join(API_ROOT, path);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
};

describe('isolation coverage of the real app', () => {
  let app: INestApplication<Server>;
  let routes: RouteDeclaration[];

  beforeAll(async () => {
    app = await createTestApp();
    routes = describeRoutes(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('has an isolation case for every tenant-scoped route with an id', () => {
    assertRoutesFound(routes);
    const needing = routes.filter(needsIsolationCase);
    console.info(
      `Isolation coverage (real app): ${String(routes.length)} routes, ${String(needing.length)} tenant-scoped with an id, ` +
        `${String(REAL_APP_CASES.length)} cases registered, ${String(REAL_APP_EXEMPTIONS.length)} exemptions`,
    );
    expect(
      checkIsolationCoverage(routes, {
        cases: REAL_APP_CASES,
        exemptions: REAL_APP_EXEMPTIONS,
        readSpec,
      }),
    ).toEqual([]);
  });

  it('keeps every route key of the registry unique and well formed', () => {
    const keys = ISOLATION_CASES.map((entry) => entry.route);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of ISOLATION_CASES) {
      expect(entry.route).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \/v1\//);
      expect(entry.spec).toMatch(/^test\/integration\/isolation\/.+\.spec\.ts$/);
    }
    expect(DEMONSTRATION_CASES.length).toBeGreaterThan(0);
  });

  it('backs every demonstration case with a real expectIsolated call', () => {
    for (const entry of DEMONSTRATION_CASES) {
      const spec = readSpec(entry.spec);
      expect(spec, `${entry.spec} does not exist`).toBeDefined();
      expect(callsExpectIsolated(spec ?? '', entry.route), `${entry.route} in ${entry.spec}`).toBe(
        true,
      );
    }
  });
});

describe('isolation coverage over the fixture module', () => {
  let app: INestApplication<Server>;
  let routes: RouteDeclaration[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [IsolationFixtureModule],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>();
    configureApp(app);
    await app.init();
    routes = describeRoutes(app, { controller: (name) => name === 'FixtureIsolationController' });
  });
  afterAll(async () => {
    await app.close();
  });

  const input = { exemptions: [], readSpec };

  it('finds the three id routes of the fixture, and the registry covers them', () => {
    // The rule first: its message names the route that has no case.
    expect(checkIsolationCoverage(routes, { ...input, cases: FIXTURE_CASES })).toEqual([]);
    const ids = routes.filter(needsIsolationCase).map((route) => route.key);
    expect(ids.sort()).toEqual(FIXTURE_CASES.map((entry) => entry.route).sort());
  });

  it('fails, naming the route, when a registry entry is removed (what break 4 does)', () => {
    const [removed, ...rest] = FIXTURE_CASES;
    expect(removed).toBeDefined();
    const problems = checkIsolationCoverage(routes, { ...input, cases: rest });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(removed?.route);
    expect(problems[0]).toContain('no isolation case');
  });

  it('fails for an entry that no test backs, an entry for a route that is gone, and a missing spec', () => {
    const problems = checkIsolationCoverage(routes, {
      ...input,
      cases: [
        ...FIXTURE_CASES,
        // A real file that never calls expectIsolated for this route.
        { route: 'GET /v1/fx-iso/members/:id', spec: 'test/isolation/registry.ts' },
        { route: 'GET /v1/fx-iso/gone/:id', spec: 'test/integration/isolation/harness.spec.ts' },
        {
          route: 'GET /v1/fx-iso/lab-sites/:id',
          spec: 'test/integration/isolation/nowhere.spec.ts',
        },
      ],
    });
    expect(problems.some((p) => p.includes('registry.ts has no expectIsolated'))).toBe(true);
    expect(
      problems.some((p) => p.includes('/gone/:id is registered but the app does not serve')),
    ).toBe(true);
    expect(problems.some((p) => p.includes('nowhere.spec.ts does not exist'))).toBe(true);
  });

  it('accepts an exemption with a reason, and rejects one without', () => {
    const [first, ...rest] = FIXTURE_CASES;
    const route = first?.route ?? '';
    expect(
      checkIsolationCoverage(routes, {
        cases: rest,
        exemptions: [{ route, reason: 'fixture: public reference lookup by id' }],
        readSpec,
      }),
    ).toEqual([]);
    expect(
      checkIsolationCoverage(routes, {
        cases: rest,
        exemptions: [{ route, reason: '' }],
        readSpec,
      }),
    ).toEqual([`${route}: exemption has no reason.`]);
  });
});
