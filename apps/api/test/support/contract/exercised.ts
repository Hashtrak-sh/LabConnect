// Records which contract operations the tests of this run exercised through contractRequest().
// Test files run in separate workers, so the record is a directory of small files shared by the
// run (vitest.config.ts provides its path); the final check reads it after every other test.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { threadId } from 'node:worker_threads';
import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Directory shared by the test workers of one run (vitest.config.ts). */
    contractRunDir?: string;
    /** True with `--mode update-not-implemented` (rewrites not-implemented.txt). */
    updateNotImplemented?: boolean;
  }
}

export function recordExercised(operationId: string): void {
  const dir = inject('contractRunDir');
  if (dir === undefined) return;
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${String(process.pid)}-${String(threadId)}.log`), `${operationId}\n`);
}

export function readExercised(dir: string): Set<string> {
  if (!existsSync(dir)) return new Set();
  const ids = readdirSync(dir).flatMap((file) =>
    readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean),
  );
  return new Set(ids);
}

export function clearExercised(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
