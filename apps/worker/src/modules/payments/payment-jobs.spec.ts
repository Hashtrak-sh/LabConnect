import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { ProcessPendingResult } from '@labconnect/core';
import { describe, expect, it, vi } from 'vitest';
import type { Scheduler } from '../platform/polling-runner.js';
import { createPaymentEventsJob, readPaymentJobsConfig } from './payment-jobs.js';
import {
  PAYMENT_JOBS_CONFIG,
  PAYMENT_JOBS_SCHEDULER,
  PAYMENTS_ENV,
  PaymentsWorkerModule,
} from './payments-worker.module.js';

const logger = () => ({ info: vi.fn(), error: vi.fn() });
const result = (over: Partial<ProcessPendingResult> = {}): ProcessPendingResult => ({
  processed: 0,
  ignored: 0,
  exceptions: 0,
  retried: 0,
  ...over,
});

describe('payment events job', () => {
  it('goes again while batches come back full, sharing one skip set, and stops at a short one', async () => {
    const seen: Set<string>[] = [];
    const passes = [
      result({ processed: 5 }),
      result({ processed: 3, ignored: 2 }),
      result({ processed: 1 }),
    ];
    const process = vi.fn((skip: Set<string>) => {
      seen.push(skip);
      return Promise.resolve(passes.shift() ?? result());
    });
    const log = logger();
    await createPaymentEventsJob({ process, batchSize: 5, intervalMs: 1000, logger: log }).run();
    expect(process).toHaveBeenCalledTimes(3);
    expect(new Set(seen).size).toBe(1);
    expect(log.info).toHaveBeenCalledWith(
      'payment events: 9 processed, 2 ignored, 0 for Finance, 0 to retry',
    );
    expect(log.error).not.toHaveBeenCalled();
  });

  it('logs nothing when nothing was waiting', async () => {
    const log = logger();
    await createPaymentEventsJob({
      process: () => Promise.resolve(result()),
      batchSize: 5,
      intervalMs: 1000,
      logger: log,
    }).run();
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('raises an error line for exceptions and for notifications left to retry, with counts only', async () => {
    const log = logger();
    await createPaymentEventsJob({
      process: () => Promise.resolve(result({ exceptions: 2, retried: 1 })),
      batchSize: 5,
      intervalMs: 1000,
      logger: log,
    }).run();
    const lines = log.error.mock.calls.map((call) => String(call[0]));
    expect(lines).toHaveLength(2);
    expect(lines.join('\n')).toMatch(/2 notifications need Finance/);
    expect(lines.join('\n')).toMatch(/1 notifications failed/);
  });
});

describe('payment jobs configuration', () => {
  it('runs only with a worker database, with defaults', () => {
    expect(readPaymentJobsConfig({})).toEqual({ enabled: false, intervalMs: 2000, batchSize: 25 });
    expect(
      readPaymentJobsConfig({
        WORKER_DATABASE_URL: 'postgres://x',
        PAYMENT_EVENTS_POLL_INTERVAL_MS: '500',
        PAYMENT_EVENTS_BATCH_SIZE: '7',
      }),
    ).toEqual({ enabled: true, intervalMs: 500, batchSize: 7 });
    expect(() => readPaymentJobsConfig({ PAYMENT_EVENTS_BATCH_SIZE: '0' })).toThrow(RangeError);
  });
});

describe('PaymentsWorkerModule', () => {
  const build = async (env: Record<string, string | undefined>, enabled: boolean) => {
    const scheduled: number[] = [];
    const scheduler: Scheduler = {
      setInterval: (_callback, milliseconds) => scheduled.push(milliseconds),
      clearInterval: () => undefined,
    };
    const moduleRef = await Test.createTestingModule({ imports: [PaymentsWorkerModule] })
      .overrideProvider(PAYMENTS_ENV)
      .useValue(env)
      .overrideProvider(PAYMENT_JOBS_CONFIG)
      .useValue({ enabled, intervalMs: 10, batchSize: 5 })
      .overrideProvider(PAYMENT_JOBS_SCHEDULER)
      .useValue(scheduler)
      .compile();
    return { moduleRef, scheduled };
  };

  it('builds without a database and starts nothing, whatever the gateway setting', async () => {
    const { moduleRef, scheduled } = await build({ PAYMENT_GATEWAY: 'real' }, false);
    const app = moduleRef.createNestApplication();
    await app.init();
    expect(scheduled).toEqual([]);
    await app.close();
  });

  it('starts the job when enabled and refuses to start for a gateway that does not exist', async () => {
    const ok = await build({ PAYMENT_GATEWAY: 'fake' }, true);
    const app = ok.moduleRef.createNestApplication();
    await app.init();
    expect(ok.scheduled).toEqual([10]);
    await app.close();

    const bad = await build({ PAYMENT_GATEWAY: 'real' }, true);
    const badApp = bad.moduleRef.createNestApplication();
    await expect(badApp.init()).rejects.toThrow(/no adapter for a real payment gateway/);
    const production = await build({ PAYMENT_GATEWAY: 'fake', NODE_ENV: 'production' }, true);
    await expect(production.moduleRef.createNestApplication().init()).rejects.toThrow(
      /not allowed in production/,
    );
  });
});
