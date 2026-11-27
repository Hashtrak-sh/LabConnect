import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, type PrismaClient } from '@labconnect/database';
import { seedDemo, seedReference } from '@labconnect/database/test-utils';
import { beforeAll, describe, it } from 'vitest';
import {
  CachedSynonymSource,
  FixedClock,
  PostgresSearchIndex,
  PostgresSynonymSource,
  SearchService,
} from '../../src/index.js';
import { usePlatform } from './support.js';

/**
 * A bench for the search SQL, skipped unless `SEARCH_HARNESS` names a directory. It seeds the demo
 * data once, writes the site query of `pH` and `tensile strength` there (`<name>.json`: values on
 * the first line, SQL after it), then keeps running: whenever `cmd.sql` appears it runs it (same
 * format, as `EXPLAIN (ANALYZE)` when the first line of the SQL starts with `--explain`), writes
 * `cmd.out` and removes `cmd.sql`. `stop` ends it.
 */
const DIR = process.env.SEARCH_HARNESS;
const NOW = new Date('2026-11-25T10:00:00Z');

describe.skipIf(DIR === undefined)('search harness', () => {
  const platform = usePlatform();
  const clock = new FixedClock(new Date(NOW.getTime() + 3_600_000));
  const captured: { text: string; values: unknown[] }[] = [];
  let service: SearchService;
  let api: PrismaClient;

  beforeAll(async () => {
    await platform.owner().$transaction(
      async (tx) => {
        await seedReference(tx, { now: NOW });
        await seedDemo(tx, { now: NOW });
      },
      { maxWait: 60_000, timeout: 600_000 },
    );
    api = platform.api();
    const spy = {
      $transaction: ((fn: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: object) =>
        api.$transaction(
          (tx) => {
            const proxy = new Proxy(tx, {
              get(target, prop, receiver) {
                if (prop === '$queryRaw') {
                  return (strings: TemplateStringsArray, ...values: unknown[]) => {
                    const sql = Prisma.sql(strings, ...(values as never[]));
                    captured.push({ text: sql.text, values: sql.values as unknown[] });
                    return target.$queryRaw(strings, ...values);
                  };
                }
                return Reflect.get(target, prop, receiver) as unknown;
              },
            });
            return fn(proxy);
          },
          { ...options, timeout: 120_000 },
        )) as PrismaClient['$transaction'],
    };
    service = new SearchService({
      primary: null,
      fallback: new PostgresSearchIndex(spy),
      clock,
      synonyms: new CachedSynonymSource(new PostgresSynonymSource(api), clock),
    });
  }, 600_000);

  it('serves commands', async () => {
    const dir = DIR ?? '.';
    for (const [name, q] of [
      ['ph', 'pH'],
      ['tensile', 'tensile strength'],
    ] as const) {
      captured.length = 0;
      await service.search({ q, limit: 25 });
      const sites = captured.find((entry) => entry.text.includes('flagged'));
      if (sites === undefined) throw new Error('no query captured');
      writeFileSync(
        join(dir, `${name}.json`),
        `${JSON.stringify(sites.values, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v))}\n${sites.text}`,
        'utf8',
      );
      const lines = captured.find((entry) => entry.text.includes('pick AS'));
      if (lines !== undefined) {
        writeFileSync(
          join(dir, `${name}-lines.json`),
          `${JSON.stringify(lines.values, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v))}\n${lines.text}`,
          'utf8',
        );
      }
    }
    writeFileSync(join(dir, 'ready'), 'ready', 'utf8');
    for (let i = 0; i < 3000; i++) {
      if (existsSync(join(dir, 'stop'))) break;
      const cmd = join(dir, 'cmd.sql');
      if (existsSync(cmd)) {
        const raw = readFileSync(cmd, 'utf8');
        const newline = raw.indexOf('\n');
        const values = JSON.parse(raw.slice(0, newline)) as unknown[];
        const sql = raw.slice(newline + 1);
        let out = '';
        const started = Date.now();
        try {
          const rows = await api.$transaction(
            (tx) =>
              tx.$queryRawUnsafe<Record<string, unknown>[]>(
                sql.startsWith('--explain') ? `EXPLAIN (ANALYZE, COSTS OFF) ${sql}` : sql,
                ...values,
              ),
            { timeout: 300_000, maxWait: 30_000 },
          );
          out = rows
            .map((row) =>
              sql.startsWith('--explain')
                ? String(row['QUERY PLAN'])
                : JSON.stringify(row, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v)),
            )
            .join('\n');
        } catch (error) {
          out = `ERROR ${String(error)}`;
        }
        writeFileSync(
          join(dir, 'cmd.out'),
          `${out}\n-- ${String(Date.now() - started)} ms`,
          'utf8',
        );
        rmSync(cmd);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }, 1_800_000);
});
