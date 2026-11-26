import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests of the web app's plain modules (helpers, parameter mapping). `@/` is the app's
// `src/` folder, as in tsconfig.json.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
