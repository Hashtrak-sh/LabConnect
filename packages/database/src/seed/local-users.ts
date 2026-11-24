import type { Tx } from './reference.js';
import { isLocalEnv } from './env.js';

/**
 * Creates the two login users the application connects as on a developer machine: one
 * that inherits `app_rw` (API) and one that inherits `app_worker` (worker). In deployed
 * environments the infrastructure creates them; this is for the local Docker database
 * only, so that local development is subject to row-level security like everywhere else
 * (TENANT_ISOLATION.md section 3).
 */
export async function createLocalLoginUsers(
  tx: Tx,
  env: Record<string, string | undefined> = process.env,
): Promise<string[]> {
  if (!isLocalEnv(env)) {
    throw new Error('Login users are created by this command on local databases only.');
  }
  const created: string[] = [];
  for (const [variable, role] of [
    ['API_DATABASE_URL', 'app_rw'],
    ['WORKER_DATABASE_URL', 'app_worker'],
  ] as const) {
    const value = env[variable];
    if (!value) throw new Error(`${variable} is not set.`);
    const url = new URL(value);
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    // CREATE ROLE takes no parameters, so the name is checked and the password quoted here.
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(user)) {
      throw new Error(`${variable}: the user name must be a plain lower-case identifier.`);
    }
    if (!password) throw new Error(`${variable}: the password is empty.`);
    const exists = await tx.$queryRaw<unknown[]>`SELECT 1 FROM pg_roles WHERE rolname = ${user}`;
    if (exists.length > 0) continue;
    const quoted = `'${password.replaceAll("'", "''")}'`;
    await tx.$executeRawUnsafe(
      `CREATE ROLE ${user} LOGIN PASSWORD ${quoted} INHERIT IN ROLE ${role}`,
    );
    created.push(user);
  }
  return created;
}
