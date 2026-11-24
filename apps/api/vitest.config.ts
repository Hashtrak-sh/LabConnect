import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// Projects (docs/06-engineering/TESTING_STRATEGY.md §8):
// - unit: pure logic next to the source.
// - http: the app in-process over HTTP. Every call goes through contractRequest(), which holds
//   it to the OpenAPI contract and records the operation it exercised.
// - contract-final: runs after the others (groupOrder 1) and fails if an implemented operation
//   was not exercised in this run.
export default defineConfig(({ mode }) => {
  // One directory per run, shared by the workers. Stable within this process even if the
  // config is evaluated again.
  const contractRunDir = join(
    tmpdir(),
    'labconnect-contract-runs',
    `${String(process.pid)}-${String(Math.round(performance.timeOrigin))}`,
  );
  return {
    test: {
      provide: { contractRunDir, updateNotImplemented: mode === 'update-not-implemented' },
      projects: [
        { extends: true, test: { name: 'unit', include: ['src/**/*.spec.ts'] } },
        { extends: true, test: { name: 'http', include: ['test/**/*.spec.ts'] } },
        {
          extends: true,
          test: {
            name: 'contract-final',
            include: ['test/**/*.final.ts'],
            sequence: { groupOrder: 1 },
          },
        },
      ],
    },
  };
});
