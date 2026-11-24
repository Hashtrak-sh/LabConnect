import { defineConfig } from 'vitest/config';

// Contract tests (test/) and unit tests of the package's own code (src/, next to the source).
// They read the bundled document that `pnpm generate` writes to src/generated.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
