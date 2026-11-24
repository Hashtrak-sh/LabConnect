// Runs after every other API test (vitest.config.ts, project contract-final). Fails if an
// operation the app implements was not called through contractRequest() in this run, so an
// endpoint cannot ship without a test that holds its responses to the contract.
import { afterAll, describe, expect, inject, it } from 'vitest';
import {
  clearExercised,
  describeOperation,
  loadContract,
  mapRoutesToContract,
  readExercised,
  registeredRoutes,
} from '../support/contract/index.js';
import { createTestApp } from '../support/test-app.js';

describe('contract coverage of this run', () => {
  const runDir = inject('contractRunDir');

  afterAll(() => {
    if (runDir !== undefined) clearExercised(runDir);
  });

  it('exercised every implemented operation through contractRequest()', async () => {
    if (runDir === undefined) throw new Error('vitest.config.ts must provide contractRunDir');
    const app = await createTestApp();
    const { implemented } = mapRoutesToContract(registeredRoutes(app), loadContract());
    await app.close();
    const exercised = readExercised(runDir);
    const problems = implemented
      .filter((op) => !exercised.has(op.operationId))
      .map(
        (op) =>
          `${describeOperation(op)} is implemented, but no test called it through ` +
          'contractRequest() in this run. Add a test under apps/api/test/.',
      );
    expect(problems).toEqual([]);
  });
});
