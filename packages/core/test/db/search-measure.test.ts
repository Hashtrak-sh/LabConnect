import { writeFileSync } from 'node:fs';
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
 * A measuring script, not a test: it is skipped unless `SEARCH_MEASURE` names a file. It seeds the
 * demo data into a throwaway database, runs the queries below through the real service, and writes
 * the number of sites and the first three sites (with their first matched line) of each query,
 * then `EXPLAIN (ANALYZE)` of the site query for `pH` and `tensile strength`.
 *
 *   SEARCH_MEASURE=out.md pnpm --filter @labconnect/core exec vitest run --config vitest.db.config.ts test/db/search-measure.test.ts
 */
const OUT = process.env.SEARCH_MEASURE;
const NOW = new Date('2026-11-25T10:00:00Z');
const QUERIES = [
  'pH',
  'LED',
  'TS',
  'TDS',
  'BOD',
  'cement',
  'tensile strength',
  'compressive strength',
  'hardness',
  'chloride',
  'coliform',
  'aflatoxin',
  'ceiling fan',
  'water',
  'tens',
  'chlor',
  'tensil strenght',
  'IS 1786',
  'radioactivity',
  // added after the change, to attack it (not part of the first table)
  ...(process.env.SEARCH_MEASURE_EXTRA === undefined
    ? []
    : ['t', 'te', 'ph', 'led', 'ts', 'nar', 'mad', 'sulph', 'hydrochloric', '(((', '50%', 'a_b', '[x', '.*', '\\']),
];

describe.skipIf(OUT === undefined)('search measurement', () => {
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
        api.$transaction((tx) => {
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
        }, options)) as PrismaClient['$transaction'],
    };
    service = new SearchService({
      primary: null,
      fallback: new PostgresSearchIndex(spy),
      clock,
      synonyms: new CachedSynonymSource(new PostgresSynonymSource(api), clock),
    });
  }, 600_000);

  it('measures', async () => {
    const lines: string[] = [
      '| query | sites | first three sites: site, first matched line |',
      '|---|---|---|',
    ];
    for (const q of QUERIES) {
      const started = Date.now();
      const result = await service.search({ q, limit: 100 }).catch((error: unknown) => {
        lines.push(`| ${q} | ERROR | ${String(error).slice(0, 200)} |`);
        return null;
      });
      if (result === null) continue;
      const ms = Date.now() - started;
      const first = result.items.slice(0, 3).map((item) => {
        const line = item.matchedLines[0];
        const what =
          line === undefined
            ? '(name match)'
            : `${line.parameter.name} / ${line.product?.name ?? '-'}`;
        return `${item.site.name}: ${what}`;
      });
      lines.push(
        `| ${q.replaceAll('|', '/')} | ${String(result.total)} (${String(ms)} ms) | ${first.join(' ; ')} |`,
      );
    }
    writeFileSync(OUT ?? 'search-measure.md', lines.join('\n'), 'utf8');
    const explains: string[] = [];
    for (const q of ['pH', 'tensile strength']) {
      captured.length = 0;
      await service.search({ q, limit: 25 }).catch(() => null);
      const sites = captured.find((entry) => entry.text.includes('flagged'));
      if (sites === undefined) throw new Error('no query captured');
      const rows = await api.$transaction(
        async (tx) => {
          return tx.$queryRawUnsafe<Record<string, string>[]>(
            `EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) ${sites.text}`,
            ...sites.values,
          );
        },
        { timeout: 300_000, maxWait: 30_000 },
      );
      explains.push(
        `### EXPLAIN (ANALYZE) for ${q}`,
        '```',
        ...rows.map((r) => r['QUERY PLAN'] ?? ''),
        '```',
      );
    }
    writeFileSync(OUT ?? 'search-measure.md', [...lines, '', ...explains].join('\n'), 'utf8');
  }, 600_000);
});
