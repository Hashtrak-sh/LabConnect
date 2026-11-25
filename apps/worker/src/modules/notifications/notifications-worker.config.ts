import { isDeployedEnvironment, QUEUES, queueUrlsFromEnv } from '@labconnect/core';

export interface NotificationsWorkerConfig {
  /** A worker database is configured. Otherwise no notifications job starts. */
  enabled: boolean;
  /** `QUEUE_URL_LC_NOTIFICATIONS_FIFO` is set: events are consumed from the queue. */
  consumeQueue: boolean;
  /** Base URL of the web app, no trailing slash. Links in emails are this plus a path of ids. */
  webBaseUrl: string;
  consumerIntervalMs: number;
  consumerBatchSize: number;
  emailIntervalMs: number;
  emailBatchSize: number;
  emailMaxAttempts: number;
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
 * `WEB_BASE_URL` is where email links point. On a developer machine it defaults to the Next.js
 * dev server; in a deployed environment it is required, so a message never carries a link to
 * localhost. It must be an http(s) URL.
 */
export function readNotificationsWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): NotificationsWorkerConfig {
  const enabled = Boolean(env.WORKER_DATABASE_URL);
  const raw = env.WEB_BASE_URL?.trim();
  if ((raw === undefined || raw === '') && enabled && isDeployedEnvironment(env)) {
    throw new Error('WEB_BASE_URL is not set. Links in emails need it (see .env.example).');
  }
  const base = raw === undefined || raw === '' ? 'http://localhost:3000' : raw;
  if (!/^https?:\/\/[^\s/]+/.test(base)) {
    throw new RangeError('WEB_BASE_URL must be an http(s) URL.');
  }
  return {
    enabled,
    consumeQueue: queueUrlsFromEnv(env)[QUEUES.notifications] !== undefined,
    webBaseUrl: base.replace(/\/+$/, ''),
    consumerIntervalMs: positiveInteger(env, 'NOTIFICATIONS_POLL_INTERVAL_MS', 2_000),
    consumerBatchSize: Math.min(positiveInteger(env, 'NOTIFICATIONS_POLL_BATCH_SIZE', 10), 10),
    emailIntervalMs: positiveInteger(env, 'EMAIL_POLL_INTERVAL_MS', 5_000),
    emailBatchSize: positiveInteger(env, 'EMAIL_BATCH_SIZE', 25),
    emailMaxAttempts: positiveInteger(env, 'EMAIL_MAX_ATTEMPTS', 5),
  };
}
