import { defineConfig } from 'vitest/config';

// OpenSearch suite for search (P3-10). Not run by CI or by `pnpm test` / `pnpm test:db`: it starts an
// OpenSearch container (about 1 minute) next to the PostgreSQL one. Run it with
// `pnpm --filter @labconnect/core test:opensearch`. See docs/05-integrations/SEARCH.md.
export default defineConfig({
  test: {
    include: ['test/opensearch/**/*.test.ts'],
    globalSetup: ['../database/test/db/global-setup.ts', './test/opensearch/global-setup.ts'],
    hookTimeout: 360_000,
    testTimeout: 60_000,
  },
});
