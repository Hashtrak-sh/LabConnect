import type { AuditChainVerification, RunDueResult } from '@labconnect/core';
import { describe, expect, it, vi } from 'vitest';
import {
  AuditChainBrokenError,
  createIdempotencyPurgeJob,
  createRelayJob,
  createSealJob,
  createTimerJob,
  createVerifyJob,
  runAuditVerification,
} from './platform-jobs.js';
import { readPlatformJobsConfig } from './platform-jobs.config.js';

const logger = () => ({ info: vi.fn(), error: vi.fn() });

const ok = (month: string): AuditChainVerification => ({
  month,
  ok: true,
  checked: 3,
  staleUnsealed: [],
  staleUnsealedCount: 0,
});

describe('relay job', () => {
  it('goes again while batches come back full, and stops at the first short one', async () => {
    const results = [
      { published: 5, failed: 0, deferred: 0, busy: false },
      { published: 5, failed: 0, deferred: 0, busy: false },
      { published: 2, failed: 1, deferred: 0, busy: false },
    ];
    const relay = vi.fn(() =>
      Promise.resolve(results.shift() ?? { published: 0, failed: 0, deferred: 0, busy: false }),
    );
    const log = logger();
    await createRelayJob({ relay, batchSize: 5, intervalMs: 1000, logger: log }).run();
    expect(relay).toHaveBeenCalledTimes(3);
    expect(log.info).toHaveBeenCalledWith('outbox relay: 12 published, 1 failed');
  });

  it('does not hammer failing rows: a pass that publishes nothing ends the run', async () => {
    const relay = vi.fn(() =>
      Promise.resolve({ published: 0, failed: 5, deferred: 0, busy: false }),
    );
    await createRelayJob({ relay, batchSize: 5, intervalMs: 1000, logger: logger() }).run();
    expect(relay).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when there is nothing to do', async () => {
    const log = logger();
    await createRelayJob({
      relay: () => Promise.resolve({ published: 0, failed: 0, deferred: 0, busy: false }),
      batchSize: 5,
      intervalMs: 1000,
      logger: log,
    }).run();
    expect(log.info).not.toHaveBeenCalled();
  });

  it('is capped, so one run cannot loop forever on a busy outbox', async () => {
    const relay = vi.fn(() =>
      Promise.resolve({ published: 5, failed: 0, deferred: 0, busy: false }),
    );
    await createRelayJob({ relay, batchSize: 5, intervalMs: 1000, logger: logger() }).run();
    expect(relay).toHaveBeenCalledTimes(10);
  });
});

describe('seal job', () => {
  it('seals until a short batch', async () => {
    const batches = [
      { sealed: 3, months: [] },
      { sealed: 1, months: [] },
    ];
    const seal = vi.fn(() => Promise.resolve(batches.shift() ?? { sealed: 0, months: [] }));
    const log = logger();
    await createSealJob({ seal, batchSize: 3, intervalMs: 10, logger: log }).run();
    expect(seal).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledWith('audit seal: 4 rows sealed');
  });
});

describe('nightly verification', () => {
  it('logs and returns when every chain matches', async () => {
    const log = logger();
    const results = await runAuditVerification(() => Promise.resolve([ok('2026-11-01')]), log);
    expect(results).toHaveLength(1);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('logs each break and throws', async () => {
    const log = logger();
    const broken: AuditChainVerification = {
      ...ok('2026-12-01'),
      ok: false,
      break: { kind: 'HASH_MISMATCH', seq: '4', auditLogId: 'row-1', detail: 'x' },
    };
    const rejected = runAuditVerification(() => Promise.resolve([ok('2026-11-01'), broken]), log);
    await expect(rejected).rejects.toBeInstanceOf(AuditChainBrokenError);
    await expect(rejected).rejects.toThrow('2026-12-01');
    expect(log.error).toHaveBeenCalledWith(
      'audit chain 2026-12-01 BROKEN at seq 4 (HASH_MISMATCH), audit row row-1',
    );
  });

  it('reports rows left unsealed for over an hour even when the chain is intact', async () => {
    const log = logger();
    await runAuditVerification(
      () => Promise.resolve([{ ...ok('2026-11-01'), staleUnsealedCount: 3 }]),
      log,
    );
    expect(log.error).toHaveBeenCalledWith(
      'audit chain 2026-11-01: 3 rows unsealed for over an hour',
    );
  });

  it('is a polling job that runs the verification', async () => {
    const verifyAll = vi.fn(() => Promise.resolve([ok('2026-11-01')]));
    const job = createVerifyJob({ verifyAll, intervalMs: 86_400_000, logger: logger() });
    expect(job.name).toBe('audit-verify');
    await job.run();
    expect(verifyAll).toHaveBeenCalledOnce();
  });
});

describe('readPlatformJobsConfig', () => {
  it('has defaults and is disabled without a worker database', () => {
    expect(readPlatformJobsConfig({})).toEqual({
      enabled: false,
      relayIntervalMs: 1000,
      relayBatchSize: 100,
      sealIntervalMs: 10_000,
      sealBatchSize: 500,
      verifyIntervalMs: 86_400_000,
      timerIntervalMs: 15_000,
      timerBatchSize: 50,
      purgeIntervalMs: 3_600_000,
      purgeBatchSize: 500,
    });
    expect(readPlatformJobsConfig({ WORKER_DATABASE_URL: 'postgresql://x' }).enabled).toBe(true);
  });

  it('reads overrides and rejects nonsense', () => {
    expect(readPlatformJobsConfig({ OUTBOX_RELAY_INTERVAL_MS: '250' }).relayIntervalMs).toBe(250);
    expect(readPlatformJobsConfig({ TIMER_POLL_INTERVAL_MS: '5000' }).timerIntervalMs).toBe(5000);
    expect(() => readPlatformJobsConfig({ TIMER_BATCH_SIZE: '0' })).toThrow(RangeError);
    expect(() => readPlatformJobsConfig({ AUDIT_SEAL_BATCH_SIZE: '0' })).toThrow(RangeError);
    expect(() => readPlatformJobsConfig({ AUDIT_SEAL_INTERVAL_MS: 'soon' })).toThrow(RangeError);
  });
});

describe('timer job', () => {
  const result = (partial: Partial<RunDueResult> = {}): RunDueResult => ({
    fired: 0,
    retried: 0,
    failed: 0,
    unhandled: {},
    ...partial,
  });
  const job = (runDue: (skipIds: Set<string>) => Promise<RunDueResult>, log = logger()) =>
    createTimerJob({ runDue, batchSize: 5, intervalMs: 15_000, logger: log });

  it('is named for its work and polls every 15 seconds by default', () => {
    const created = createTimerJob({
      runDue: () => Promise.resolve(result()),
      batchSize: 50,
      intervalMs: readPlatformJobsConfig({}).timerIntervalMs,
      logger: logger(),
    });
    expect(created.name).toBe('timers');
    expect(created.intervalMs).toBe(15_000);
  });

  it('goes again while passes fire a full batch, shares one skip set, and logs counts only', async () => {
    const passes = [result({ fired: 5 }), result({ fired: 5 }), result({ fired: 2, retried: 1 })];
    const sets: Set<string>[] = [];
    const runDue = vi.fn((skipIds: Set<string>) => {
      sets.push(skipIds);
      return Promise.resolve(passes.shift() ?? result());
    });
    const log = logger();
    await job(runDue, log).run();
    expect(runDue).toHaveBeenCalledTimes(3);
    expect(new Set(sets).size).toBe(1);
    expect(log.info).toHaveBeenCalledWith('timers: 12 fired, 1 to retry, 0 failed');
    expect(log.error).not.toHaveBeenCalled();
  });

  it('does not loop on failing timers: a pass that fires nothing ends the run', async () => {
    const runDue = vi.fn(() => Promise.resolve(result({ retried: 5 })));
    await job(runDue).run();
    expect(runDue).toHaveBeenCalledTimes(1);
  });

  it('is capped, so one run cannot loop forever on a busy table', async () => {
    const runDue = vi.fn(() => Promise.resolve(result({ fired: 5 })));
    await job(runDue).run();
    expect(runDue).toHaveBeenCalledTimes(10);
  });

  it('stays quiet when there is nothing to do', async () => {
    const log = logger();
    await job(() => Promise.resolve(result()), log).run();
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('reports timers that gave up as an error', async () => {
    const log = logger();
    await job(() => Promise.resolve(result({ failed: 2 })), log).run();
    expect(log.error).toHaveBeenCalledWith('timers: 2 timers gave up (FAILED)');
  });

  it('reports timers without a handler once per change, by type and count', async () => {
    const log = logger();
    const unhandled: RunDueResult['unhandled'][] = [
      { NO_SHOW_DUE: 2 },
      { NO_SHOW_DUE: 2 },
      { NO_SHOW_DUE: 3, PAYMENT_DUE: 1 },
      {},
    ];
    const created = job(() => Promise.resolve(result({ unhandled: unhandled.shift() ?? {} })), log);
    await created.run();
    await created.run();
    await created.run();
    await created.run();
    expect(log.info.mock.calls).toEqual([
      ['timers: due but without a handler: NO_SHOW_DUE=2'],
      ['timers: due but without a handler: NO_SHOW_DUE=3, PAYMENT_DUE=1'],
    ]);
  });
});

describe('idempotency purge job', () => {
  it('is named for its work, purges until a short batch and logs a count only', async () => {
    const batches = [{ deleted: 3 }, { deleted: 1 }];
    const purge = vi.fn(() => Promise.resolve(batches.shift() ?? { deleted: 0 }));
    const log = logger();
    const job = createIdempotencyPurgeJob({ purge, batchSize: 3, intervalMs: 60_000, logger: log });
    expect(job.name).toBe('idempotency-purge');
    await job.run();
    expect(purge).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledWith('idempotency purge: 4 expired records deleted');
  });

  it('stays quiet when nothing has expired', async () => {
    const log = logger();
    await createIdempotencyPurgeJob({
      purge: () => Promise.resolve({ deleted: 0 }),
      batchSize: 3,
      intervalMs: 60_000,
      logger: log,
    }).run();
    expect(log.info).not.toHaveBeenCalled();
  });
});
