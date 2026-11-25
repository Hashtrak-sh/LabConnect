import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import {
  JOBS_CONFIG,
  JOBS_SCHEDULER,
  PlatformJobsService,
  PlatformWorkerModule,
  WorkerDatabase,
} from './platform-worker.module.js';
import type { PlatformJobsConfig } from './platform-jobs.config.js';
import type { Scheduler } from './polling-runner.js';

const config = (enabled: boolean): PlatformJobsConfig => ({
  enabled,
  relayIntervalMs: 10,
  relayBatchSize: 5,
  sealIntervalMs: 20,
  sealBatchSize: 5,
  verifyIntervalMs: 30,
  timerIntervalMs: 25,
  timerBatchSize: 5,
});

describe('PlatformWorkerModule', () => {
  it('builds without a database and starts no jobs', async () => {
    const scheduled: number[] = [];
    const scheduler: Scheduler = {
      setInterval: (_callback, milliseconds) => scheduled.push(milliseconds),
      clearInterval: () => undefined,
    };
    const moduleRef = await Test.createTestingModule({ imports: [PlatformWorkerModule] })
      .overrideProvider(JOBS_CONFIG)
      .useValue(config(false))
      .overrideProvider(JOBS_SCHEDULER)
      .useValue(scheduler)
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    expect(moduleRef.get(WorkerDatabase).client).toBeDefined();
    expect(scheduled).toEqual([]);
    await app.close();
  });

  it('starts the four jobs when enabled and stops them on shutdown', async () => {
    const scheduled: number[] = [];
    const cleared: unknown[] = [];
    const scheduler: Scheduler = {
      setInterval: (_callback, milliseconds) => scheduled.push(milliseconds),
      clearInterval: (handle) => cleared.push(handle),
    };
    const moduleRef = await Test.createTestingModule({ imports: [PlatformWorkerModule] })
      .overrideProvider(JOBS_CONFIG)
      .useValue(config(true))
      .overrideProvider(JOBS_SCHEDULER)
      .useValue(scheduler)
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    expect(moduleRef.get(PlatformJobsService)).toBeDefined();
    expect(scheduled).toEqual([10, 20, 25, 30]);
    await app.close();
    expect(cleared).toHaveLength(4);
  });
});
