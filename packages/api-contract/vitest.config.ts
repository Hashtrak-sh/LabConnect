import { defineConfig } from 'vitest/config';

// Contract tests. They read the bundled document that `pnpm generate` writes to src/generated.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
