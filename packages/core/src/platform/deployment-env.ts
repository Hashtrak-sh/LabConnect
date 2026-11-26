/** The environment the deployment checks read. */
export type DeploymentEnv = Readonly<Record<string, string | undefined>>;

/**
 * Whether this process may run something that must never run in production (the fake payment
 * gateway, demo one-time codes).
 *
 * Never in production: `APP_ENV=production` refuses it, and so does `NODE_ENV=production`
 * unless `APP_ENV=uat` says explicitly that this deployment is UAT (UAT is a deployed
 * environment that runs the production build). `APP_ENV` is the variable the seeds already use
 * (`local`, `test`, `uat`, `production`). With neither set this is a developer machine: allowed.
 */
export function nonProductionDeployment(env: DeploymentEnv): boolean {
  const appEnv = env.APP_ENV?.trim().toLowerCase();
  if (appEnv === 'production') return false;
  if (env.NODE_ENV?.trim().toLowerCase() === 'production') return appEnv === 'uat';
  return true;
}
