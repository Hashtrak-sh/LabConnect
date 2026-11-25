import type { ProcessPendingResult } from '@labconnect/core';
import type { JobLogger, PollingJob } from '../platform/polling-runner.js';

/** A pass that fills its batch means there may be more waiting, so go again, up to this many times. */
const MAX_PASSES_PER_RUN = 10;

export interface PaymentEventsJobDeps {
  /** One pass of `PaymentService.processPending`. The job passes the same `skipIds` to every pass of a run. */
  process: (skipIds: Set<string>) => Promise<ProcessPendingResult>;
  batchSize: number;
  intervalMs: number;
  logger: JobLogger;
}

/**
 * Processes the gateway notifications that the webhook stored (PAYMENTS_AND_LEDGER.md
 * section 2). Goes again while a pass fills its batch, but never retries in the same run a
 * notification that already failed transiently. Logs counts only, never what a notification
 * contains; a notification that needs Finance (the exception path) is logged as an error so
 * the alert has something to match.
 */
export function createPaymentEventsJob(deps: PaymentEventsJobDeps): PollingJob {
  return {
    name: 'payment-events',
    intervalMs: deps.intervalMs,
    async run() {
      const skipIds = new Set<string>();
      const total: ProcessPendingResult = { processed: 0, ignored: 0, exceptions: 0, retried: 0 };
      for (let pass = 0; pass < MAX_PASSES_PER_RUN; pass += 1) {
        const result = await deps.process(skipIds);
        total.processed += result.processed;
        total.ignored += result.ignored;
        total.exceptions += result.exceptions;
        total.retried += result.retried;
        if (
          result.processed + result.ignored + result.exceptions + result.retried <
          deps.batchSize
        ) {
          break;
        }
      }
      if (total.processed + total.ignored + total.exceptions + total.retried > 0) {
        deps.logger.info(
          `payment events: ${String(total.processed)} processed, ${String(total.ignored)} ignored, ` +
            `${String(total.exceptions)} for Finance, ${String(total.retried)} to retry`,
        );
      }
      if (total.exceptions > 0) {
        deps.logger.error(
          `payment events: ${String(total.exceptions)} notifications need Finance (see gateway_webhook_event, status FAILED)`,
        );
      }
      if (total.retried > 0) {
        deps.logger.error(
          `payment events: ${String(total.retried)} notifications failed and stay RECEIVED for the next run`,
        );
      }
    },
  };
}

export interface PaymentJobsConfig {
  enabled: boolean;
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

/** Runs only when `WORKER_DATABASE_URL` is set, like the platform jobs. */
export function readPaymentJobsConfig(
  env: Record<string, string | undefined> = process.env,
): PaymentJobsConfig {
  return {
    enabled: Boolean(env.WORKER_DATABASE_URL),
    intervalMs: positiveInteger(env, 'PAYMENT_EVENTS_POLL_INTERVAL_MS', 2_000),
    batchSize: positiveInteger(env, 'PAYMENT_EVENTS_BATCH_SIZE', 25),
  };
}
