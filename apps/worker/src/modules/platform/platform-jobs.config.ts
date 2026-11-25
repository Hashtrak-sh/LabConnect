export interface PlatformJobsConfig {
  /** False when no worker database is configured: the runner then starts nothing. */
  enabled: boolean;
  relayIntervalMs: number;
  relayBatchSize: number;
  sealIntervalMs: number;
  sealBatchSize: number;
  verifyIntervalMs: number;
}

function positiveInteger(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}

/**
 * Intervals and batch sizes, from the environment, with the defaults the architecture
 * implies: the relay polls every second, sealing every 10 seconds, verification once a day.
 * Jobs run only when `WORKER_DATABASE_URL` is set.
 */
export function readPlatformJobsConfig(
  env: Record<string, string | undefined> = process.env,
): PlatformJobsConfig {
  return {
    enabled: Boolean(env.WORKER_DATABASE_URL),
    relayIntervalMs: positiveInteger(env, 'OUTBOX_RELAY_INTERVAL_MS', 1_000),
    relayBatchSize: positiveInteger(env, 'OUTBOX_RELAY_BATCH_SIZE', 100),
    sealIntervalMs: positiveInteger(env, 'AUDIT_SEAL_INTERVAL_MS', 10_000),
    sealBatchSize: positiveInteger(env, 'AUDIT_SEAL_BATCH_SIZE', 500),
    verifyIntervalMs: positiveInteger(env, 'AUDIT_VERIFY_INTERVAL_MS', 24 * 60 * 60 * 1000),
  };
}
