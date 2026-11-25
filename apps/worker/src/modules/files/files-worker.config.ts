import { isDevScanEnabled, QUEUES, queueUrlsFromEnv } from '@labconnect/core';

export interface FilesWorkerConfig {
  /** Both a worker database and a bucket are configured. Otherwise no files job starts. */
  enabled: boolean;
  /** `QUEUE_URL_LC_FILES` is set: scan results are consumed from the queue. */
  consumeQueue: boolean;
  /** `FILES_DEV_AUTO_SCAN=true` in development or test: uploads are scanned by the fake scanner. */
  devScan: boolean;
  intervalMs: number;
  batchSize: number;
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
 * Throws `DevScanForbiddenError` when `FILES_DEV_AUTO_SCAN=true` is set outside development
 * and test, so a misconfigured deployment refuses to start instead of running a fake scanner.
 */
export function readFilesWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): FilesWorkerConfig {
  return {
    enabled: Boolean(env.WORKER_DATABASE_URL) && Boolean(env.FILES_BUCKET),
    consumeQueue: queueUrlsFromEnv(env)[QUEUES.files] !== undefined,
    devScan: isDevScanEnabled(env),
    intervalMs: positiveInteger(env, 'FILES_POLL_INTERVAL_MS', 2_000),
    batchSize: positiveInteger(env, 'FILES_POLL_BATCH_SIZE', 10),
  };
}
