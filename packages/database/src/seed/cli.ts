import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { seedDemo } from './demo.js';
import { requireEnv } from './env.js';
import { createLocalLoginUsers } from './local-users.js';
import { seedPlatformAdmin } from './platform-admin.js';
import { seedReference } from './reference.js';

// Usage: node dist/seed/cli.js <reference | platform-admin | demo | local-users>
// Connects with DATABASE_URL, which must be the role that owns the schema (the one that
// runs migrations). Each command runs in one transaction: all of it or none.

const COMMANDS = ['reference', 'platform-admin', 'demo', 'local-users'] as const;
type Command = (typeof COMMANDS)[number];

async function main(): Promise<void> {
  // The repository's .env, if there is one. Variables already set win.
  const dotenv = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '.env');
  if (existsSync(dotenv)) process.loadEnvFile(dotenv);

  const command = process.argv[2] as Command | undefined;
  if (!command || !COMMANDS.includes(command)) {
    throw new Error(`Usage: seed <${COMMANDS.join(' | ')}>`);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_URL') }),
  });
  const patient = { maxWait: 30_000, timeout: 15 * 60_000 };
  try {
    switch (command) {
      case 'reference': {
        const counts = await prisma.$transaction((tx) => seedReference(tx), patient);
        const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
        console.log(total === 0 ? 'Reference data is up to date.' : 'Reference data added:');
        for (const [table, n] of Object.entries(counts)) console.log(`  ${table}: ${String(n)}`);
        break;
      }
      case 'platform-admin': {
        const result = await prisma.$transaction(
          (tx) =>
            seedPlatformAdmin(tx, {
              email: requireEnv('PLATFORM_ADMIN_EMAIL'),
              fullName: requireEnv('PLATFORM_ADMIN_NAME'),
              ...(process.env.PLATFORM_ORG_NAME
                ? { organisationName: process.env.PLATFORM_ORG_NAME }
                : {}),
            }),
          patient,
        );
        // The email address is personal data and is not printed.
        console.log(
          result.created
            ? 'Platform administrator created. MFA enrolment is required at first sign-in.'
            : 'The platform administrator already exists. Nothing changed.',
        );
        break;
      }
      case 'demo': {
        const result = await prisma.$transaction(async (tx) => {
          await seedReference(tx);
          return seedDemo(tx, {
            ...(process.env.DEMO_EMAIL_DOMAIN
              ? { emailDomain: process.env.DEMO_EMAIL_DOMAIN }
              : {}),
          });
        }, patient);
        console.log(
          result.skipped
            ? 'Demo data is already there. Nothing changed.'
            : `Demo data created: ${String(result.labSites)} lab sites, ${String(result.scopeLines)} scope lines, ${String(result.bookings)} bookings, ${String(result.tests)} tests in ${String(result.products)} products, ${String(result.labOwners)} lab owner accounts.`,
        );
        break;
      }
      case 'local-users': {
        const created = await prisma.$transaction((tx) => createLocalLoginUsers(tx), patient);
        console.log(
          created.length > 0
            ? `Local login users created: ${created.join(', ')}.`
            : 'The local login users already exist.',
        );
        break;
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
