import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// The repository's .env, if there is one. Variables that are already set win.
const dotenv = new URL('../../.env', import.meta.url);
if (existsSync(dotenv)) process.loadEnvFile(dotenv);

// DATABASE_URL must point at a role that may run DDL (app_owner in deployed environments).
export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
