import { PrismaClient } from '@labconnect/database';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, expect } from 'vitest';
import { type Db, useDatabase, uuid } from '../../../database/test/db/helpers.js';

export { PG, uuid } from '../../../database/test/db/helpers.js';
export type { Db } from '../../../database/test/db/helpers.js';

const PASSWORD = 'test';

/** SQLSTATE of a database error that Prisma wrapped. */
export function sqlState(error: unknown): string | undefined {
  const meta = (error as { meta?: { driverAdapterError?: { cause?: { originalCode?: string } } } })
    .meta;
  return meta?.driverAdapterError?.cause?.originalCode;
}

export async function failure(body: () => Promise<unknown>): Promise<{ state?: string }> {
  try {
    await body();
  } catch (error) {
    return { state: sqlState(error) };
  }
  return expect.fail('expected the operation to fail, but it succeeded');
}

export interface Platform {
  /** Connected as the database owner: not subject to row-level security, may tamper. */
  owner: () => PrismaClient;
  /** Connected as a login user that inherits `app_rw`, as the API does. */
  api: () => PrismaClient;
  /** Connected as a login user that inherits `app_worker`, as the worker does (pool of 3). */
  worker: () => PrismaClient;
  /** A raw owner connection, for assertions and tampering. */
  db: () => Db;
}

/**
 * A database of its own for the test file (cloned from the migrated template) and Prisma
 * clients for the three ways the platform code meets it: the API role, the worker role
 * and the owner. The login users are created the way each environment's infrastructure
 * creates them: no privileges of their own, membership of `app_rw` or `app_worker`.
 */
export function usePlatform(): Platform {
  const { db, url } = useDatabase();
  const clients: PrismaClient[] = [];
  let owner: PrismaClient | undefined;
  let api: PrismaClient | undefined;
  let worker: PrismaClient | undefined;

  const connect = (connectionString: string, max: number): PrismaClient => {
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString, max }),
      // Many test files share one database server. Prisma's default wait for a transaction to
      // start is two seconds, which a loaded machine exceeds now and then ("Unable to start a
      // transaction in the given time"). Waiting longer changes no behaviour under test.
      transactionOptions: { maxWait: 30_000 },
    });
    clients.push(client);
    return client;
  };
  const loginUrl = (role: string): string => {
    const parsed = new URL(url());
    parsed.username = role;
    parsed.password = PASSWORD;
    return parsed.toString();
  };

  beforeAll(async () => {
    const suffix = uuid().slice(0, 8);
    const apiRole = `lc_api_${suffix}`;
    const workerRole = `lc_worker_${suffix}`;
    await db().query(`CREATE ROLE ${apiRole} LOGIN PASSWORD '${PASSWORD}' INHERIT IN ROLE app_rw`);
    await db().query(
      `CREATE ROLE ${workerRole} LOGIN PASSWORD '${PASSWORD}' INHERIT IN ROLE app_worker`,
    );
    owner = connect(url(), 4);
    api = connect(loginUrl(apiRole), 4);
    worker = connect(loginUrl(workerRole), 3);
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.$disconnect()));
  });

  const need = (client: PrismaClient | undefined): PrismaClient => {
    if (!client) throw new Error('the Prisma client is not ready');
    return client;
  };
  return { owner: () => need(owner), api: () => need(api), worker: () => need(worker), db };
}

/** Lets a test hold a unit of work open until it decides to continue. */
export function gate(): { wait: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}
