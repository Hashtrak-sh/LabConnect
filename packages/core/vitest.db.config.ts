import { defineConfig } from 'vitest/config';

// Database suite for the platform services (TESTING_STRATEGY.md section 4). It reuses the
// container, migrated template database and helpers of packages/database, so the services
// are tested against the real migrations, grants, triggers and row-level security.
export default defineConfig({
  test: {
    include: ['test/db/**/*.test.ts'],
    globalSetup: ['../database/test/db/global-setup.ts'],
    hookTimeout: 240_000,
    testTimeout: 60_000,
  },
});
