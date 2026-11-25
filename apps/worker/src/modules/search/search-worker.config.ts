import { QUEUES, queueUrlsFromEnv } from '@labconnect/core';

export interface SearchWorkerConfig {
  /** A worker database and `OPENSEARCH_URL` are both configured. Otherwise no search job starts. */
  enabled: boolean;
  /** `QUEUE_URL_LC_SEARCH_SYNC` is set: search events are consumed from the queue. */
  consumeQueue: boolean;
  /** `SEARCH_REINDEX_INTERVAL_MS` is set: a full reindex (the nightly backstop) runs at this interval. */
  reindexIntervalMs: number | null;
  /** `SEARCH_REINDEX_ON_START=true`: one full reindex when the worker starts (first load). */
  reindexOnStart: boolean;
  /** Poll interval of the consumer. */
  intervalMs: number;
  /** Messages per consumer pass (at most 10, the SQS limit). */
  batchSize: number;
  /** Sites per batch of a reindex. */
  reindexBatchSize: number;
}

function positiveInteger(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number | null,
): number | null {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}

/**
 * The search jobs start only when the worker has a database and OpenSearch is configured: with
 * no `OPENSEARCH_URL` the public search runs on Postgres alone and there is nothing to sync
 * (SEARCH.md section 3). The queue consumer also needs `QUEUE_URL_LC_SEARCH_SYNC`.
 */
export function readSearchWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): SearchWorkerConfig {
  const batch = positiveInteger(env, 'SEARCH_POLL_BATCH_SIZE', 10) ?? 10;
  return {
    enabled: Boolean(env.WORKER_DATABASE_URL) && Boolean(env.OPENSEARCH_URL?.trim()),
    consumeQueue: queueUrlsFromEnv(env)[QUEUES.searchSync] !== undefined,
    reindexIntervalMs: positiveInteger(env, 'SEARCH_REINDEX_INTERVAL_MS', null),
    reindexOnStart: env.SEARCH_REINDEX_ON_START === 'true',
    intervalMs: positiveInteger(env, 'SEARCH_POLL_INTERVAL_MS', 2_000) ?? 2_000,
    batchSize: Math.min(batch, 10),
    reindexBatchSize: positiveInteger(env, 'SEARCH_REINDEX_BATCH_SIZE', 100) ?? 100,
  };
}
