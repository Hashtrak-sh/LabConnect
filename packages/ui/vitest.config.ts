import { defineConfig } from 'vitest/config';

// Component tests run in jsdom with Testing Library. MapLibre needs WebGL, which jsdom lacks, so
// MapView is tested for its no-WebGL fallback only; the real map is checked in the browser.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
