import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { useDatabase } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..', '..');
const docs = join(packageRoot, '..', '..', 'docs');
const read = (relative: string): string => readFileSync(join(docs, relative), 'utf8');

describe('migrations applied to an empty database', () => {
  const { db, url } = useDatabase();

  it('creates every table in SCHEMA_SPECIFICATION.md and nothing else', async () => {
    const specified = [
      ...read('03-database/SCHEMA_SPECIFICATION.md').matchAll(/^### \d+\.\d+ `([a-z_]+)`/gm),
    ]
      .map((match) => match[1])
      .sort();
    const result = await db().query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
          AND c.relname NOT IN ('spatial_ref_sys', '_prisma_migrations')
        ORDER BY 1`,
    );
    expect(result.rows.map((row) => row.relname)).toEqual(specified);
    expect(specified).toHaveLength(101);
  });

  it('booking_transition equals the transition table in BOOKING_STATE_MACHINE.md', async () => {
    const documented = [
      ...read('02-architecture/BOOKING_STATE_MACHINE.md').matchAll(
        /^\| (T-\d\d) \| ([^|]+) \| ([A-Z_]+) \|/gm,
      ),
    ]
      .flatMap((match) => {
        const [, id = '', from = '', to = ''] = match;
        return from
          .split(',')
          .map((state) => state.trim())
          .map((state) => `${id}:${state === '—' ? '' : state}>${to}`);
      })
      .sort();
    const result = await db().query<{ row: string }>(
      `SELECT transition_id || ':' || COALESCE(from_status::text, '') || '>' || to_status AS row FROM booking_transition`,
    );
    expect(result.rows.map((row) => row.row).sort()).toEqual(documented);
    expect(documented).toHaveLength(33);
  });

  it('gives app_rw a privilege on every table except the ones only the worker or migrations may use', async () => {
    const result = await db().query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
          AND c.relname <> '_prisma_migrations'
          AND NOT has_table_privilege('app_rw', c.oid, 'SELECT')
          AND NOT has_table_privilege('app_rw', c.oid, 'INSERT')`,
    );
    expect(result.rows.map((row) => row.relname)).toEqual([]);
  });

  it('gives app_ro no privilege on any application table yet', async () => {
    const result = await db().query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND c.relname NOT IN ('spatial_ref_sys')
          AND has_table_privilege('app_ro', c.oid, 'SELECT')`,
    );
    expect(result.rows).toEqual([]);
  });

  it('leaves no drift between the migrations and the Prisma schema', () => {
    const require = createRequire(import.meta.url);
    const prismaCli = join(dirname(require.resolve('prisma/package.json')), 'build', 'index.js');
    // Exit code 2 means the database and the schema differ.
    const output = execFileSync(
      process.execPath,
      [
        prismaCli,
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema',
        '--exit-code',
        '--script',
      ],
      { cwd: packageRoot, env: { ...process.env, DATABASE_URL: url() }, encoding: 'utf8' },
    );
    expect(output).toContain('This is an empty migration');
  });
});

describe('the constraint register', () => {
  // Constraints in INDEXES_AND_CONSTRAINTS.md that have no violation test yet.
  // Shrinking this list is the remaining part of task P1-09. Adding to it needs a reason.
  const notYetTested: string[] = [];

  it('has a test for every registered constraint, apart from the listed exceptions', () => {
    const registered = [
      ...new Set(
        [...read('03-database/INDEXES_AND_CONSTRAINTS.md').matchAll(/^\| (C-\d\d) \|/gm)].map(
          (match) => match[1] ?? '',
        ),
      ),
    ].sort();
    const testSources = readdirSync(here)
      .filter((file) => file.endsWith('.test.ts') && file !== 'migrations.test.ts')
      .map((file) => readFileSync(join(here, file), 'utf8'))
      .join('\n');
    const tested = new Set([...testSources.matchAll(/\bC-\d\d\b/g)].map((match) => match[0]));
    const missing = registered.filter((id) => !tested.has(id));
    expect(missing).toEqual([...notYetTested].sort());
    expect(registered).toHaveLength(81);
  });
});
