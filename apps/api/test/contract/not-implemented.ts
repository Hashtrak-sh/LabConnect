// Reads and writes not-implemented.txt: the contract operations apps/api does not serve yet.
import { readFileSync, writeFileSync } from 'node:fs';

export const NOT_IMPLEMENTED_FILE = new URL('./not-implemented.txt', import.meta.url);
export const NOT_IMPLEMENTED_PATH = 'apps/api/test/contract/not-implemented.txt';

const HEADER = `# Contract operations that apps/api does not implement yet (task P2-08).
# One operationId per line, sorted. Lines starting with # are comments.
# Rules (enforced by test/contract/endpoints.spec.ts):
# - When you implement an operation, remove its line. The test fails until you do.
# - An operation added to the contract must be listed here until it is implemented.
# - Every line names an operationId that exists in the contract.
# Regenerate: pnpm --filter @labconnect/api contract:update-not-implemented
`;

export interface ListedOperation {
  operationId: string;
  /** 1-based line number in the file. */
  line: number;
}

export function readNotImplemented(): ListedOperation[] {
  return readFileSync(NOT_IMPLEMENTED_FILE, 'utf8')
    .split(/\r?\n/)
    .map((text, i) => ({ operationId: text.trim(), line: i + 1 }))
    .filter((entry) => entry.operationId !== '' && !entry.operationId.startsWith('#'));
}

export function writeNotImplemented(operationIds: readonly string[]): void {
  const sorted = [...new Set(operationIds)].sort();
  writeFileSync(NOT_IMPLEMENTED_FILE, `${HEADER}${sorted.map((id) => `${id}\n`).join('')}`);
}
