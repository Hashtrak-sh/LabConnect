import 'dotenv/config';
import { defineConfig } from 'prisma/config';

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
