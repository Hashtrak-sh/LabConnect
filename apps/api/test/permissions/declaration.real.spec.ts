// Declaration coverage of the REAL app (P3-05): every implemented route says who may call it.
// No database needed (project `http`, so `pnpm test` and the `unit` CI job run it too). The rules
// are in test/support/permissions/declaration-rules.ts; test/permissions/declaration.fixtures.spec.ts
// proves they catch each mistake.
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadContract } from '../support/contract/index.js';
import {
  checkDeclarations,
  contractInfoFrom,
  formatViolations,
} from '../support/permissions/declaration-rules.js';
import {
  assertRoutesFound,
  describeRoutes,
  type RouteDeclaration,
  summariseRoutes,
} from '../support/permissions/route-declarations.js';
import { createTestApp } from '../support/test-app.js';
import { KNOWN_ADMIN_DIFFERENCES } from './known-admin-differences.js';
import { PUBLIC_ROUTES } from './public-routes.js';

describe('route declarations of the real app', () => {
  const contract = loadContract();
  let app: INestApplication<Server>;
  let routes: RouteDeclaration[];

  beforeAll(async () => {
    app = await createTestApp();
    routes = describeRoutes(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('reads the routes the app serves, and prints what they are', () => {
    assertRoutesFound(routes);
    console.info(`Route declarations: ${summariseRoutes(routes)}`);
    // Pins the reader itself: these exist today, in these categories.
    const category = (key: string) => routes.find((route) => route.key === key)?.category;
    expect(category('GET /v1/health')).toBe('public');
    expect(category('POST /v1/auth/otp/verify')).toBe('public');
    expect(category('GET /v1/me')).toBe('authenticated');
    expect(category('POST /v1/auth/mfa/verify')).toBe('authenticated');
    expect(routes.find((route) => route.key === 'POST /v1/auth/mfa/verify')).toMatchObject({
      allowPartialSession: true,
    });
    expect(routes.find((route) => route.key === 'GET /v1/me')).toMatchObject({
      allowPartialSession: false,
    });
  });

  it('fails when the reader finds no routes at all', () => {
    expect(() => {
      assertRoutesFound([]);
    }).toThrow(/no routes at all/);
  });

  it('declares who may call every route (rules A, B, C and D)', () => {
    const violations = checkDeclarations(routes, {
      publicRoutes: PUBLIC_ROUTES,
      contractInfoOf: contractInfoFrom(contract),
      knownAdminDifferences: KNOWN_ADMIN_DIFFERENCES,
      checkStale: true,
    });
    expect(formatViolations(violations)).toEqual([]);
  });

  it('answers 401 UNAUTHENTICATED without a token on every route that is not public', async () => {
    const { default: request } = await import('supertest');
    const protectedRoutes = routes.filter((route) => route.category !== 'public');
    expect(protectedRoutes.length).toBeGreaterThan(0);
    const failures: string[] = [];
    for (const route of protectedRoutes) {
      const path = route.path.replace(/:[A-Za-z0-9_]+/g, '00000000-0000-7000-8000-000000000000');
      const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
      const response = await request(app.getHttpServer())
        [method](path)
        .send(method === 'get' || method === 'delete' ? undefined : {});
      const code = (response.body as { code?: string }).code;
      if (response.status !== 401 || code !== 'UNAUTHENTICATED') {
        failures.push(`${route.key} -> ${String(response.status)} ${String(code)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('lists every public route with a reason, and each is in the contract as public', () => {
    for (const entry of PUBLIC_ROUTES) {
      expect(entry.reason.trim().length, entry.route).toBeGreaterThan(10);
    }
    const info = contractInfoFrom(contract);
    for (const route of routes.filter((r) => r.category === 'public')) {
      expect(info(route)?.security, route.key).toMatch(/^(none|other)$/);
    }
  });

  it('seeds the known /admin differences from the contract (OQ-112)', () => {
    const operations = new Set(contract.operations.map((op) => `${op.method} ${op.pathTemplate}`));
    for (const key of KNOWN_ADMIN_DIFFERENCES) {
      expect(operations.has(key), `${key} is not an operation of the contract`).toBe(true);
      expect(key).toMatch(/^[A-Z]+ \/admin\//);
    }
    expect(new Set(KNOWN_ADMIN_DIFFERENCES).size).toBe(KNOWN_ADMIN_DIFFERENCES.length);
  });

  it('finds the step-up operations in the contract: the seven admin ones, bank accounts and report publish', () => {
    const info = contractInfoFrom(contract);
    const stepUp = contract.operations
      .filter((op) => {
        const found = info({
          method: op.method,
          path: op.servedPath.replace(/\{[^}]+\}/g, ':p'),
        } as RouteDeclaration);
        return found?.stepUp === true;
      })
      .map((op) => `${op.method} ${op.pathTemplate}`)
      .sort();
    expect(stepUp).toEqual(
      [
        'POST /admin/break-glass/report-access/{id}/approve',
        'POST /admin/break-glass/report-access/{id}/download-url',
        'POST /admin/payouts/{id}/release',
        'POST /admin/refunds/{id}/approve',
        'POST /admin/users',
        'PATCH /admin/users/{id}',
        'PUT /admin/users/{id}/platform-roles',
        'POST /lab/bank-accounts',
        'POST /report-versions/{id}/publish',
      ].sort(),
    );
  });
});
