import 'reflect-metadata';
import { InMemoryQueueConsumer } from '@labconnect/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import type { Scheduler } from '../platform/polling-runner.js';
import type { FilesWorkerConfig } from './files-worker.config.js';
import {
  FILES_QUEUE_CONSUMER,
  FILES_SCHEDULER,
  FILES_WORKER_CONFIG,
  FilesWorkerModule,
} from './files-worker.module.js';

const config = (overrides: Partial<FilesWorkerConfig>): FilesWorkerConfig => ({
  enabled: false,
  consumeQueue: false,
  devScan: false,
  intervalMs: 10,
  batchSize: 5,
  ...overrides,
});

async function boot(overrides: Partial<FilesWorkerConfig>): Promise<number[]> {
  const scheduled: number[] = [];
  const scheduler: Scheduler = {
    setInterval: (_callback, milliseconds) => scheduled.push(milliseconds),
    clearInterval: () => undefined,
  };
  const moduleRef = await Test.createTestingModule({ imports: [FilesWorkerModule] })
    .overrideProvider(FILES_WORKER_CONFIG)
    .useValue(config(overrides))
    .overrideProvider(FILES_SCHEDULER)
    .useValue(scheduler)
    .overrideProvider(FILES_QUEUE_CONSUMER)
    .useValue(new InMemoryQueueConsumer())
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  await app.close();
  return scheduled;
}

describe('FilesWorkerModule', () => {
  it('builds with no AWS, bucket or database configuration and starts no jobs', async () => {
    expect(await boot({ enabled: false })).toEqual([]);
  });

  it('starts the queue consumer when enabled with a queue', async () => {
    expect(await boot({ enabled: true, consumeQueue: true })).toEqual([10]);
  });

  it('starts the dev scan only when asked for, in addition to the consumer', async () => {
    expect(await boot({ enabled: true, devScan: true })).toEqual([10]);
    expect(await boot({ enabled: true, consumeQueue: true, devScan: true })).toEqual([10, 10]);
  });

  it('starts nothing when enabled but neither source is configured', async () => {
    expect(await boot({ enabled: true })).toEqual([]);
  });
});
