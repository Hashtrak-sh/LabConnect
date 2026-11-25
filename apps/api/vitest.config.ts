import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// Projects (docs/06-engineering/TESTING_STRATEGY.md §8):
// - unit: pure logic next to the source.
// - http: the app in-process over HTTP, without a database. Every call goes through
//   contractRequest(), which holds it to the OpenAPI contract and records the operation it
//   exercised.
// - http-db: the same, against a real PostgreSQL (Testcontainers, so Docker is needed): the
//   migrated template database of packages/database, one clone per test file, the API
//   connecting as the app_rw role under row-level security. Lives in test/integration.
// - permissions-db, isolation-db: the permission-matrix and tenant-isolation suites (P3-05), the
//   same kind of test as http-db and in their own projects so the CI jobs `permissions` and
//   `isolation` run them without `pnpm test:contract` running them a second time.
//   Their declaration and coverage rules need no database and live in the `http` project
//   (test/permissions, test/isolation), so `pnpm test` runs those too.
// - contract-final: runs after the others (groupOrder 1) and fails if an implemented operation
//   was not exercised in this run.
//
// `pnpm test` runs unit and http only (no Docker). `pnpm test:contract` runs http, http-db and
// contract-final: an operation that needs the database is exercised there. `pnpm test:integration`
// runs http-db alone.
// What the database-backed projects share.
const database = {
  globalSetup: ['../../packages/database/test/db/global-setup.ts'],
  hookTimeout: 240_000,
  testTimeout: 60_000,
};

export default defineConfig(({ mode }) => {
  // One directory per run, shared by the workers. Stable within this process even if the
  // config is evaluated again.
  const contractRunDir = join(
    tmpdir(),
    'labconnect-contract-runs',
    `${String(process.pid)}-${String(Math.round(performance.timeOrigin))}`,
  );
  return {
    test: {
      provide: { contractRunDir, updateNotImplemented: mode === 'update-not-implemented' },
      projects: [
        { extends: true, test: { name: 'unit', include: ['src/**/*.spec.ts'] } },
        {
          extends: true,
          test: {
            name: 'http',
            include: ['test/**/*.spec.ts'],
            exclude: ['test/integration/**'],
          },
        },
        {
          extends: true,
          test: { name: 'http-db', include: ['test/integration/*.spec.ts'], ...database },
        },
        {
          extends: true,
          test: {
            name: 'permissions-db',
            include: ['test/integration/permissions/**/*.spec.ts'],
            ...database,
          },
        },
        {
          extends: true,
          test: {
            name: 'isolation-db',
            include: ['test/integration/isolation/**/*.spec.ts'],
            ...database,
          },
        },
        {
          extends: true,
          test: {
            name: 'contract-final',
            include: ['test/**/*.final.ts'],
            sequence: { groupOrder: 1 },
          },
        },
      ],
    },
  };
});
