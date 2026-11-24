import { defineConfig } from 'vitest/config';

// Unit tests only. The database suite has its own config (vitest.db.config.ts) because it needs Docker.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/generated/**'],
  },
});
