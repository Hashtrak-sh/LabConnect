import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The fixed demo one-time code is read in one place only: the identity module of the API (through
// `parseDemoOtpSettings`). No other process (the worker above all) reads it, so setting the
// variable anywhere else does nothing, and no other code can start to use it unnoticed.

const root = fileURLToPath(new URL('../../../', import.meta.url));

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === 'node_modules' || name === 'dist' || name === 'generated') return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|mjs|cjs|js)$/.test(name) ? [path] : [];
  });
}

describe('where the demo one-time code setting is read', () => {
  const files = ['apps', 'packages']
    .flatMap((top) => sources(join(root, top)))
    .map((path) => relative(root, path).split(sep).join('/'))
    .filter((path) => !/\.(test|spec)\.ts$/.test(path) && !path.includes('/test/'));
  const mentioning = (pattern: RegExp): string[] =>
    files.filter((path) => pattern.test(readFileSync(join(root, path), 'utf8'))).sort();

  it('names the variables only in core identity (the parser) and the API identity runtime', () => {
    expect(mentioning(/DEMO_OTP/)).toEqual([
      'apps/api/src/modules/identity/identity.runtime.ts',
      'packages/core/src/identity/demo-otp.ts',
    ]);
  });

  it('never reads them in the worker', () => {
    const worker = files.filter((path) => path.startsWith('apps/worker/'));
    expect(worker.length).toBeGreaterThan(0);
    expect(
      mentioning(/DEMO_OTP|parseDemoOtpSettings|demoOtp/).filter((p) => worker.includes(p)),
    ).toEqual([]);
  });

  it('builds the demo setting from the environment only in the identity runtime', () => {
    expect(mentioning(/parseDemoOtpSettings/)).toEqual([
      'apps/api/src/modules/identity/identity.runtime.ts',
      'packages/core/src/identity/demo-otp.ts',
    ]);
  });
});
