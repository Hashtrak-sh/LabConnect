import type { ConsumeResult, DevScanRunResult } from '@labconnect/core';
import type { JobLogger, PollingJob } from '../platform/polling-runner.js';

export interface FilesConsumerJobDeps {
  /** One pass over the `lc-files` queue. */
  consume: () => Promise<ConsumeResult>;
  intervalMs: number;
  logger: JobLogger;
}

/**
 * Consumes scan results from the `lc-files` queue. Logs counts only: a message names a file
 * and a verdict, and nothing about a file is logged. A message that failed stays on the queue
 * and comes back (at-least-once); the queue's redrive policy moves a message that keeps failing
 * to the dead-letter queue.
 */
export function createFilesConsumerJob(deps: FilesConsumerJobDeps): PollingJob {
  return {
    name: 'files-scan-consumer',
    intervalMs: deps.intervalMs,
    async run() {
      const result = await deps.consume();
      if (result.failed > 0 || result.left > 0) {
        deps.logger.error(
          `files queue: ${String(result.failed)} messages failed, ${String(result.left)} left, ${String(result.acknowledged)} done`,
        );
      } else if (result.received > 0) {
        deps.logger.info(`files queue: ${String(result.acknowledged)} scan results processed`);
      }
    },
  };
}

export interface DevScanJobDeps {
  runOnce: () => Promise<DevScanRunResult>;
  intervalMs: number;
  logger: JobLogger;
}

/** Local development only (`FILES_DEV_AUTO_SCAN`, refused outside development and test). */
export function createDevScanJob(deps: DevScanJobDeps): PollingJob {
  return {
    name: 'files-dev-scan',
    intervalMs: deps.intervalMs,
    async run() {
      const result = await deps.runOnce();
      if (result.scanned > 0 || result.failed > 0) {
        deps.logger.info(
          `dev file scan: ${String(result.scanned)} scanned, ${String(result.failed)} failed (fake scanner, development only)`,
        );
      }
    },
  };
}
