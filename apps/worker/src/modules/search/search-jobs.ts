import type { ConsumeResult, ReindexResult } from '@labconnect/core';
import type { JobLogger, PollingJob } from '../platform/polling-runner.js';

export interface SearchSyncJobDeps {
  /** Makes sure the index exists (retried until it does), then one pass over `lc-search-sync`. */
  consume: () => Promise<ConsumeResult>;
  intervalMs: number;
  logger: JobLogger;
}

/**
 * Consumes search events from the `lc-search-sync` queue. Logs counts only: a message names a
 * site, and nothing about a site or a search is logged. A message that failed stays on the queue
 * and comes back (at-least-once); the queue's redrive policy moves a message that keeps failing
 * to the dead-letter queue.
 */
export function createSearchSyncJob(deps: SearchSyncJobDeps): PollingJob {
  return {
    name: 'search-sync-consumer',
    intervalMs: deps.intervalMs,
    async run() {
      const result = await deps.consume();
      if (result.failed > 0 || result.left > 0) {
        deps.logger.error(
          `search queue: ${String(result.failed)} messages failed, ${String(result.left)} left, ${String(result.acknowledged)} done`,
        );
      } else if (result.received > 0) {
        deps.logger.info(`search queue: ${String(result.acknowledged)} events processed`);
      }
    },
  };
}

export interface SearchReindexJobDeps {
  reindex: () => Promise<ReindexResult>;
  intervalMs: number;
  runOnStart: boolean;
  logger: JobLogger;
}

/** The full reindex (SEARCH.md section 2: the backstop and the first load). Logs counts only. */
export function createSearchReindexJob(deps: SearchReindexJobDeps): PollingJob {
  return {
    name: 'search-reindex',
    intervalMs: deps.intervalMs,
    runOnStart: deps.runOnStart,
    async run() {
      const result = await deps.reindex();
      const summary = `${String(result.sitesProcessed)} sites, ${String(result.documentsWritten)} documents written, ${String(result.sitesRemoved)} sites removed`;
      if (result.failed.length > 0) {
        deps.logger.error(
          `search reindex: ${summary}, ${String(result.failed.length)} documents failed`,
        );
      } else {
        deps.logger.info(`search reindex: ${summary}`);
      }
    },
  };
}

/**
 * Wraps an async set-up step so it runs until it has worked once. The consumer calls it before
 * every pass: if OpenSearch is down at start-up the index is created on the first pass after it
 * comes back, and the worker never fails to start because of it.
 */
export function onceSucceeded(step: () => Promise<void>): () => Promise<void> {
  let done = false;
  return async () => {
    if (done) return;
    await step();
    done = true;
  };
}
