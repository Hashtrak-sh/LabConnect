// Creates, or updates the password of, the two database login users the application connects
// as: one that inherits `app_rw` (the API) and one that inherits `app_worker` (the worker).
// The first migration creates those two roles without LOGIN and without a password and says
// "each environment's infrastructure creates the login users" (MIGRATION_AND_SEED_STRATEGY.md
// section 1). This is that step for UAT. It runs in the `migrate` task, after
// `prisma migrate deploy`, as the schema owner (DATABASE_URL), and is safe to repeat: a
// repeat sets the password again, which is how a rotated secret takes effect.
//
// Input, all from the environment (the task definition injects them from Secrets Manager):
//   DATABASE_URL                      the owner's connection URL
//   API_DB_USER / API_DB_PASSWORD     for the API login
//   WORKER_DB_USER / WORKER_DB_PASSWORD  for the worker login
// It prints the names of the users it touched and never a password or a URL.
import { pathToFileURL } from 'node:url';

/** Which login user inherits which role (packages/database/src/seed/local-users.ts does the same locally). */
export const LOGIN_SPECS = [
  {
    login: 'API',
    userVariable: 'API_DB_USER',
    passwordVariable: 'API_DB_PASSWORD',
    role: 'app_rw',
  },
  {
    login: 'WORKER',
    userVariable: 'WORKER_DB_USER',
    passwordVariable: 'WORKER_DB_PASSWORD',
    role: 'app_worker',
  },
];

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * An error whose message this script wrote itself: it names a variable or a role and never a
 * value. Only these messages are printed; anything else (a database error, for instance)
 * is reported by its error code alone.
 */
export class LoginUserError extends Error {}

/** Reads and checks the users and passwords. Error messages name the variable, never a value. */
export function readLoginUsers(env) {
  return LOGIN_SPECS.map(({ login, userVariable, passwordVariable, role }) => {
    const user = env[userVariable];
    const password = env[passwordVariable];
    if (!user || !IDENTIFIER.test(user)) {
      throw new LoginUserError(`${userVariable} must be a plain lower-case identifier.`);
    }
    if (!password) throw new LoginUserError(`${login}_DB_PASSWORD is not set.`);
    return { user, password, role };
  });
}

/** What may be printed about a failure: this script's own message, or a database error code. */
export function describeFailure(error) {
  if (error instanceof LoginUserError) return error.message;
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code);
  return code ? `create-login-users failed (${error.code})` : 'create-login-users failed';
}

/**
 * Runs inside one transaction on a connected client. `format` with %I and %L quotes the
 * identifiers and the password on the server, so nothing is concatenated here.
 */
export async function createLoginUsers(client, users) {
  const touched = [];
  await client.query('BEGIN');
  try {
    for (const { user, password, role } of users) {
      const roleExists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
      if (roleExists.rows.length === 0) {
        throw new LoginUserError(`The role ${role} does not exist. Run the migrations first.`);
      }
      const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user]);
      const template =
        exists.rows.length === 0
          ? "SELECT format('CREATE ROLE %I LOGIN INHERIT PASSWORD %L IN ROLE %I', $1::text, $2::text, $3::text) AS sql"
          : "SELECT format('ALTER ROLE %I WITH LOGIN INHERIT PASSWORD %L', $1::text, $2::text) AS sql";
      const parameters = exists.rows.length === 0 ? [user, password, role] : [user, password];
      const statement = await client.query(template, parameters);
      await client.query(statement.rows[0].sql);
      if (exists.rows.length > 0) {
        // A user that existed may have lost its membership.
        const grant = await client.query(
          "SELECT format('GRANT %I TO %I', $1::text, $2::text) AS sql",
          [role, user],
        );
        await client.query(grant.rows[0].sql);
      }
      touched.push(user);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return touched;
}

async function main() {
  const users = readLoginUsers(process.env);
  if (!process.env.DATABASE_URL) throw new LoginUserError('DATABASE_URL is not set.');
  // Loaded here, not at the top: the script is copied next to packages/database in the image,
  // where `pg` resolves; the tests import this file without it.
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const touched = await createLoginUsers(client, users);
    console.log(`Database login users ready: ${touched.join(', ')}`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Only this script's own messages (variable and role names) are printed. A database
    // error is reduced to its code: its text could quote part of a statement, and the
    // statements here carry passwords. The connection URL is never printed.
    console.error(describeFailure(error));
    process.exit(1);
  });
}
