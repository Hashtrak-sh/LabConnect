import { defineConfig } from 'vitest/config';

// Database suite (TESTING_STRATEGY.md section 4). Needs Docker: a PostGIS container is
// started once, every migration is applied to a template database, and each test file
// works in its own copy of it.
export default defineConfig({
  test: {
    include: ['test/db/**/*.test.ts'],
    globalSetup: ['test/db/global-setup.ts'],
    hookTimeout: 240_000,
    testTimeout: 60_000,
  },
});
