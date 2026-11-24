import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, expect, inject } from 'vitest';
import { TEMPLATE_DB, withDatabase } from './global-setup.js';

export type Db = pg.Client;
export type Row = Record<string, unknown>;

/** PostgreSQL error codes the suite asserts on. LC codes are raised by our triggers. */
export const PG = {
  check: '23514',
  unique: '23505',
  foreignKey: '23503',
  exclusion: '23P01',
  notNull: '23502',
  privilege: '42501',
  appendOnly: 'LC001',
  illegalTransition: 'LC002',
  frozen: 'LC003',
  rule: 'LC004',
} as const;

/**
 * Gives a test file its own database, cloned from the migrated template, and a
 * connection as the owner (the container's superuser, which is not subject to RLS).
 */
export function useDatabase(): { db: () => Db; url: () => string } {
  let client: Db | undefined;
  let url = '';
  const name = `t_${randomUUID().replaceAll('-', '')}`;

  beforeAll(async () => {
    const adminUrl = inject('adminUrl');
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB}`);
    await admin.end();
    url = withDatabase(adminUrl, name);
    client = new pg.Client({ connectionString: url });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  return {
    db: () => {
      if (!client) throw new Error('database is not ready');
      return client;
    },
    url: () => url,
  };
}

/** Runs the body in a transaction that is always rolled back, so tests do not see each other's rows. */
export async function rollback<T>(db: Db, body: () => Promise<T>): Promise<T> {
  await db.query('BEGIN');
  try {
    return await body();
  } finally {
    await db.query('ROLLBACK');
  }
}

/**
 * Asserts that the body fails with the given SQLSTATE. Runs inside a savepoint so the
 * surrounding transaction stays usable afterwards.
 */
export async function expectPgError(
  db: Db,
  code: string,
  body: () => Promise<unknown>,
): Promise<void> {
  await db.query('SAVEPOINT expect_error');
  let failure: unknown;
  try {
    await body();
  } catch (error) {
    failure = error;
  }
  await db.query('ROLLBACK TO SAVEPOINT expect_error');
  if (failure === undefined) {
    expect.fail(`expected the statement to fail with SQLSTATE ${code}, but it succeeded`);
  }
  const actual = (failure as { code?: string }).code;
  if (actual !== code) {
    expect.fail(`expected SQLSTATE ${code}, got ${String(actual)}: ${(failure as Error).message}`);
  }
}

/** INSERT helper. Adds a random id unless one is given (or `id: null` to omit it). Returns the id. */
export async function insert(db: Db, table: string, values: Row): Promise<string> {
  const row: Row = { id: randomUUID(), ...values };
  if (row.id === null) delete row.id;
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `$${String(index + 1)}`);
  await db.query(
    `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${placeholders.join(', ')})`,
    columns.map((column) => toParam(row[column])),
  );
  return row.id as string;
}

export async function update(db: Db, table: string, id: string, values: Row): Promise<void> {
  const columns = Object.keys(values);
  const assignments = columns.map((column, index) => `"${column}" = $${String(index + 2)}`);
  await db.query(`UPDATE "${table}" SET ${assignments.join(', ')} WHERE id = $1`, [
    id,
    ...columns.map((column) => toParam(values[column])),
  ]);
}

function toParam(value: unknown): unknown {
  // Plain objects are JSON columns; arrays, dates and buffers are passed through to pg.
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !Buffer.isBuffer(value)
  ) {
    return JSON.stringify(value);
  }
  return value;
}

/** Sets a transaction-local setting, as the application does with SET LOCAL. */
export async function setLocal(db: Db, name: string, value: string): Promise<void> {
  await db.query('SELECT set_config($1, $2, true)', [name, value]);
}

export async function count(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  const result = await db.query<{ n: string }>(`SELECT count(*) AS n FROM (${sql}) q`, params);
  return Number(result.rows[0]?.n ?? 0);
}

export const uuid = randomUUID;
