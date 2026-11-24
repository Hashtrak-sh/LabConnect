type Env = Record<string, string | undefined>;

/** A developer machine or a test run. APP_ENV is unset there, or `local` or `test`. */
export function isLocalEnv(env: Env = process.env): boolean {
  const value = env.APP_ENV;
  return value === undefined || value === '' || value === 'local' || value === 'test';
}

/** Demo data never runs in production (MIGRATION_AND_SEED_STRATEGY.md section 3). */
export function assertNotProduction(what: string, env: Env = process.env): void {
  if (env.APP_ENV === 'production') {
    throw new Error(`${what} refuses to run when APP_ENV=production.`);
  }
}

export function requireEnv(name: string, env: Env = process.env): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}
