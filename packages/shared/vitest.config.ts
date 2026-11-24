import { defineConfig } from 'vitest/config';

// Unit tests and doc-equality tests. Coverage (`pnpm test:coverage`) is reported, not enforced;
// the target for this package is ≥ 90% line and ≥ 85% branch (TESTING_STRATEGY.md).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'text-summary'],
    },
  },
});
