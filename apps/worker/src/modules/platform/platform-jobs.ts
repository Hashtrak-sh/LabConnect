import type {
  AuditChainVerification,
  RelayResult,
  RunDueResult,
  SealResult,
} from '@labconnect/core';
import type { JobLogger, PollingJob } from './polling-runner.js';

/** A pass that fills its batch means there may be more waiting, so go again, up to this many times. */
const MAX_PASSES_PER_RUN = 10;

/** Repeats `pass` while it reports a full batch. Returns the totals. */
async function drain(pass: () => Promise<{ handled: number }>, batchSize: number): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_PASSES_PER_RUN; i += 1) {
    const { handled } = await pass();
    total += handled;
    if (handled < batchSize) break;
  }
  return total;
}

export interface RelayJobDeps {
  relay: () => Promise<RelayResult>;
  batchSize: number;
  intervalMs: number;
  logger: JobLogger;
}

/** Publishes outbox events. Logs counts only, never what the events contain. */
export function createRelayJob(deps: RelayJobDeps): PollingJob {
  return {
    name: 'outbox-relay',
    intervalMs: deps.intervalMs,
    async run() {
      let failed = 0;
      const published = await drain(async () => {
        const result = await deps.relay();
        failed += result.failed;
        return { handled: result.published };
      }, deps.batchSize);
      if (published > 0 || failed > 0) {
        deps.logger.info(`outbox relay: ${String(published)} published, ${String(failed)} failed`);
      }
    },
  };
}

export interface SealJobDeps {
  seal: () => Promise<SealResult>;
  batchSize: number;
  intervalMs: number;
  logger: JobLogger;
}

/** Seals audit rows into the hash chain. */
export function createSealJob(deps: SealJobDeps): PollingJob {
  return {
    name: 'audit-seal',
    intervalMs: deps.intervalMs,
    async run() {
      const sealed = await drain(
        async () => ({ handled: (await deps.seal()).sealed }),
        deps.batchSize,
      );
      if (sealed > 0) deps.logger.info(`audit seal: ${String(sealed)} rows sealed`);
    },
  };
}

/** Thrown by the nightly verification when a chain does not match its audit rows. */
export class AuditChainBrokenError extends Error {
  constructor(readonly breaks: AuditChainVerification[]) {
    super(
      `Audit chain verification failed for ${breaks.map((result) => result.month).join(', ')}.`,
    );
    this.name = 'AuditChainBrokenError';
  }
}

export interface VerifyJobDeps {
  verifyAll: () => Promise<AuditChainVerification[]>;
  intervalMs: number;
  logger: JobLogger;
}

/**
 * Verifies every audit chain (AUDIT_AND_EVENT_ARCHITECTURE.md section 2). Logs each break
 * and each row that has stayed unsealed for more than an hour, then throws
 * `AuditChainBrokenError` if any chain is broken. Raising an alert from the log line or
 * the error is the operations setup's job.
 */
export function createVerifyJob(deps: VerifyJobDeps): PollingJob {
  return {
    name: 'audit-verify',
    intervalMs: deps.intervalMs,
    async run() {
      await runAuditVerification(deps.verifyAll, deps.logger);
    },
  };
}

export async function runAuditVerification(
  verifyAll: () => Promise<AuditChainVerification[]>,
  logger: JobLogger,
): Promise<AuditChainVerification[]> {
  const results = await verifyAll();
  for (const result of results) {
    if (result.staleUnsealedCount > 0) {
      logger.error(
        `audit chain ${result.month}: ${String(result.staleUnsealedCount)} rows unsealed for over an hour`,
      );
    }
    if (!result.ok && result.break) {
      logger.error(
        `audit chain ${result.month} BROKEN at seq ${result.break.seq} (${result.break.kind}), audit row ${result.break.auditLogId}`,
      );
    }
  }
  const broken = results.filter((result) => !result.ok);
  if (broken.length > 0) throw new AuditChainBrokenError(broken);
  logger.info(`audit verification: ${String(results.length)} chains match their audit rows`);
  return results;
}

export interface TimerJobDeps {
  /** One pass of `runDueTimers`. The job passes the same `skipIds` set to every pass of a run. */
  runDue: (skipIds: Set<string>) => Promise<RunDueResult>;
  batchSize: number;
  intervalMs: number;
  logger: JobLogger;
}

/**
 * Fires due timers (AUDIT_AND_EVENT_ARCHITECTURE.md section 4). Goes again while a pass
 * fires a full batch, but never retries in the same run a timer that already failed, so a
 * backlog cannot use up a failing timer's attempts. Logs counts and timer types only,
 * never payloads. A timer that gave up (FAILED) is logged as an error. Timers without a
 * handler are logged when the counts change, not on every tick.
 */
export function createTimerJob(deps: TimerJobDeps): PollingJob {
  let lastUnhandled = '';
  return {
    name: 'timers',
    intervalMs: deps.intervalMs,
    async run() {
      const skipIds = new Set<string>();
      let retried = 0;
      let failed = 0;
      let unhandled: RunDueResult['unhandled'] = {};
      const fired = await drain(async () => {
        const result = await deps.runDue(skipIds);
        retried += result.retried;
        failed += result.failed;
        unhandled = result.unhandled;
        return { handled: result.fired };
      }, deps.batchSize);
      if (fired > 0 || retried > 0 || failed > 0) {
        deps.logger.info(
          `timers: ${String(fired)} fired, ${String(retried)} to retry, ${String(failed)} failed`,
        );
      }
      if (failed > 0) deps.logger.error(`timers: ${String(failed)} timers gave up (FAILED)`);
      const summary = Object.entries(unhandled)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([type, count]) => `${type}=${String(count)}`)
        .join(', ');
      if (summary !== lastUnhandled) {
        lastUnhandled = summary;
        if (summary !== '') deps.logger.info(`timers: due but without a handler: ${summary}`);
      }
    },
  };
}
