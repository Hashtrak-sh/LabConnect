import { join } from 'node:path';
import { lint, loadConfig } from '@redocly/openapi-core';
import { describe, expect, it } from 'vitest';
import { packageDir } from './helpers.js';

describe('Redocly lint', () => {
  it('passes redocly.yaml with no unaccepted problem, warnings included', async () => {
    // Same configuration and ignore file as `pnpm lint:openapi`.
    const config = await loadConfig({ configPath: join(packageDir, 'redocly.yaml') });
    const problems = await lint({ ref: join(packageDir, 'openapi', 'openapi.yaml'), config });

    const open = problems
      .filter((p) => p.ignored !== true)
      .map((p) => {
        const where = p.location[0];
        const at = where ? `${where.source.absoluteRef}${where.pointer ?? ''}` : '?';
        return `${p.severity} ${p.ruleId}: ${p.message} (${at})`;
      });
    expect(open).toEqual([]);
  });
});
