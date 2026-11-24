import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { type Db, useDatabase } from './helpers.js';

/** Long enough for the demo seed on a slow machine. */
export const PATIENT = { maxWait: 60_000, timeout: 10 * 60_000 };

/**
 * A database of its own for the test file, plus a Prisma client connected as the owner
 * (not subject to row-level security), the way seeds and migrations connect.
 */
export function usePrisma(): { prisma: () => PrismaClient; db: () => Db; url: () => string } {
  const { db, url } = useDatabase();
  let client: PrismaClient | undefined;

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url(), max: 4 }) });
  });
  afterAll(async () => {
    await client?.$disconnect();
  });

  return {
    prisma: () => {
      if (!client) throw new Error('the Prisma client is not ready');
      return client;
    },
    db,
    url,
  };
}
