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
// - contract-final: runs after the others (groupOrder 1) and fails if an implemented operation
//   was not exercised in this run.
//
// `pnpm test` runs unit and http only (no Docker). `pnpm test:contract` runs http, http-db and
// contract-final: an operation that needs the database is exercised there. `pnpm test:integration`
// runs http-db alone.
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
          test: {
            name: 'http-db',
            include: ['test/integration/**/*.spec.ts'],
            globalSetup: ['../../packages/database/test/db/global-setup.ts'],
            hookTimeout: 240_000,
            testTimeout: 60_000,
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
