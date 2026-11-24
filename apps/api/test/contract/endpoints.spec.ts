// "Every documented endpoint exists" (TESTING_STRATEGY.md §1), staged: an operation is either
// served by the app or listed in not-implemented.txt, never both and never neither.
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  type ContractOperation,
  type RegisteredRoute,
  describeOperation,
  loadContract,
  mapRoutesToContract,
  registeredRoutes,
} from '../support/contract/index.js';
import { createTestApp } from '../support/test-app.js';
import {
  type ListedOperation,
  NOT_IMPLEMENTED_PATH,
  readNotImplemented,
  writeNotImplemented,
} from './not-implemented.js';

const contract = loadContract();

describe('contract endpoints', () => {
  let app: INestApplication<Server>;
  let routes: RegisteredRoute[];
  let implemented: ContractOperation[];
  let undocumented: RegisteredRoute[];
  let listed: ListedOperation[];

  beforeAll(async () => {
    app = await createTestApp();
    routes = registeredRoutes(app);
    ({ implemented, undocumented } = mapRoutesToContract(routes, contract));
    if (inject('updateNotImplemented') === true) {
      if (process.env.CI) throw new Error('Do not regenerate not-implemented.txt in CI');
      const served = new Set(implemented.map((op) => op.operationId));
      writeNotImplemented(
        contract.operations.map((op) => op.operationId).filter((id) => !served.has(id)),
      );
    }
    listed = readNotImplemented();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reads the routes from the app', () => {
    // Guards the reader itself: health is always served.
    expect(routes).toContainEqual({ method: 'GET', path: '/v1/health' });
  });

  it('registers no route that the contract does not document', () => {
    const problems = undocumented.map(
      (r) =>
        `${r.method} ${r.path} is served by the app but is not in the contract. Add it to ` +
        'packages/api-contract/openapi first (contract-first), or remove the route.',
    );
    expect(problems).toEqual([]);
  });

  it(`keeps ${NOT_IMPLEMENTED_PATH} sorted, without duplicates`, () => {
    const problems: string[] = [];
    listed.forEach((entry, i) => {
      const previous = listed[i - 1];
      if (previous === undefined) return;
      if (previous.operationId === entry.operationId) {
        problems.push(
          `line ${String(entry.line)}: ${entry.operationId} is a duplicate. Remove line ${String(entry.line)}.`,
        );
      } else if (previous.operationId > entry.operationId) {
        problems.push(
          `line ${String(entry.line)}: ${entry.operationId} is out of order (after ${previous.operationId}).`,
        );
      }
    });
    expect(problems).toEqual([]);
  });

  it(`lists only operations that exist in the contract`, () => {
    const problems = listed
      .filter((entry) => !contract.byOperationId(entry.operationId))
      .map(
        (entry) =>
          `${NOT_IMPLEMENTED_PATH} line ${String(entry.line)}: ${entry.operationId} is not an ` +
          `operationId in the contract. Remove line ${String(entry.line)}.`,
      );
    expect(problems).toEqual([]);
  });

  it('lists no operation that the app implements (the list only shrinks)', () => {
    const served = new Map(implemented.map((op) => [op.operationId, op]));
    const problems = listed.flatMap((entry) => {
      const op = served.get(entry.operationId);
      return op
        ? [
            `${describeOperation(op)} is implemented, but still listed as not implemented. ` +
              `Remove line ${String(entry.line)} of ${NOT_IMPLEMENTED_PATH}.`,
          ]
        : [];
    });
    expect(problems).toEqual([]);
  });

  it('accounts for every contract operation: implemented or listed', () => {
    const served = new Set(implemented.map((op) => op.operationId));
    const onList = new Set(listed.map((entry) => entry.operationId));
    const problems = contract.operations
      .filter((op) => !served.has(op.operationId) && !onList.has(op.operationId))
      .map(
        (op) =>
          `${describeOperation(op)} is in the contract but neither implemented nor listed. ` +
          `Add "${op.operationId}" to ${NOT_IMPLEMENTED_PATH} (sorted), or run ` +
          '`pnpm --filter @labconnect/api contract:update-not-implemented`.',
      );
    expect(problems).toEqual([]);
  });
});
