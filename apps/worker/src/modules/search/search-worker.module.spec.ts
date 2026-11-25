import 'reflect-metadata';
import {
  InMemoryQueueConsumer,
  InMemorySearchIndex,
  QUEUES,
  type SearchIndex,
} from '@labconnect/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import type { Scheduler } from '../platform/polling-runner.js';
import {
  SEARCH_QUEUE_CONSUMER,
  SEARCH_SCHEDULER,
  SEARCH_SYNC_INDEX,
  SEARCH_WORKER_CONFIG,
  SearchWorkerModule,
} from './search-worker.module.js';
import type { SearchWorkerConfig } from './search-worker.config.js';

const config = (overrides: Partial<SearchWorkerConfig>): SearchWorkerConfig => ({
  enabled: false,
  consumeQueue: false,
  reindexIntervalMs: null,
  reindexOnStart: false,
  intervalMs: 10,
  batchSize: 5,
  reindexBatchSize: 100,
  ...overrides,
});

async function boot(
  overrides: Partial<SearchWorkerConfig>,
  index: SearchIndex | null = new InMemorySearchIndex(),
): Promise<number[]> {
  const scheduled: number[] = [];
  const scheduler: Scheduler = {
    setInterval: (_callback, milliseconds) => scheduled.push(milliseconds),
    clearInterval: () => undefined,
  };
  const queue = new InMemoryQueueConsumer();
  queue.send(QUEUES.searchSync, '{}');
  const moduleRef = await Test.createTestingModule({ imports: [SearchWorkerModule] })
    .overrideProvider(SEARCH_WORKER_CONFIG)
    .useValue(config(overrides))
    .overrideProvider(SEARCH_SCHEDULER)
    .useValue(scheduler)
    .overrideProvider(SEARCH_QUEUE_CONSUMER)
    .useValue(queue)
    .overrideProvider(SEARCH_SYNC_INDEX)
    .useValue(() => index)
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  await app.close();
  return scheduled;
}

describe('SearchWorkerModule', () => {
  it('builds with no OpenSearch, queue or database configuration and starts no jobs', async () => {
    expect(await boot({ enabled: false })).toEqual([]);
  });

  it('starts the queue consumer when enabled with a queue', async () => {
    expect(await boot({ enabled: true, consumeQueue: true })).toEqual([10]);
  });

  it('starts the reindex job when asked for, in addition to the consumer', async () => {
    expect(await boot({ enabled: true, reindexIntervalMs: 3_600_000 })).toEqual([3_600_000]);
    expect(await boot({ enabled: true, consumeQueue: true, reindexIntervalMs: 3_600_000 })).toEqual(
      [10, 3_600_000],
    );
  });

  it('starts nothing when enabled but neither source is configured, or OpenSearch is not built', async () => {
    expect(await boot({ enabled: true })).toEqual([]);
    expect(await boot({ enabled: true, consumeQueue: true }, null)).toEqual([]);
  });
});
