import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Synthesising all the stacks takes a few seconds, more on a slow machine.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
