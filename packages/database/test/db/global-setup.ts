import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

export const TEMPLATE_DB = 'lc_template';
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'prisma',
  'migrations',
);

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection string of the maintenance database, as the container's superuser. */
    adminUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

export function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8'),
    }));
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer('postgis/postgis:16-3.5').start();
  const adminUrl = container.getConnectionUri();

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  await admin.end();

  // Apply every migration, in order, exactly as written. A failure here fails the whole suite.
  const template = new pg.Client({ connectionString: withDatabase(adminUrl, TEMPLATE_DB) });
  await template.connect();
  for (const migration of migrationFiles()) {
    try {
      await template.query(migration.sql);
    } catch (error) {
      throw new Error(`migration ${migration.name} failed: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }
  await template.end();

  project.provide('adminUrl', adminUrl);
  return async () => {
    await container?.stop();
  };
}

export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}
