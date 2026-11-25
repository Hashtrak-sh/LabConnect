import { describe, expect, it, vi } from 'vitest';
import { createSearchReindexJob, createSearchSyncJob, onceSucceeded } from './search-jobs.js';
import { readSearchWorkerConfig } from './search-worker.config.js';

const logger = () => ({ info: vi.fn(), error: vi.fn() });

describe('createSearchSyncJob', () => {
  it('logs counts only, as info when all is well and nothing for an empty queue', async () => {
    const log = logger();
    await createSearchSyncJob({
      consume: () => Promise.resolve({ received: 3, acknowledged: 3, failed: 0, left: 0 }),
      intervalMs: 10,
      logger: log,
    }).run();
    expect(log.info).toHaveBeenCalledWith('search queue: 3 events processed');
    expect(log.error).not.toHaveBeenCalled();

    const quiet = logger();
    await createSearchSyncJob({
      consume: () => Promise.resolve({ received: 0, acknowledged: 0, failed: 0, left: 0 }),
      intervalMs: 10,
      logger: quiet,
    }).run();
    expect(quiet.info).not.toHaveBeenCalled();
    expect(quiet.error).not.toHaveBeenCalled();
  });

  it('logs an error with counts when messages failed or were left', async () => {
    const log = logger();
    await createSearchSyncJob({
      consume: () => Promise.resolve({ received: 3, acknowledged: 1, failed: 1, left: 1 }),
      intervalMs: 10,
      logger: log,
    }).run();
    expect(log.error).toHaveBeenCalledWith('search queue: 1 messages failed, 1 left, 1 done');
  });

  it('lets a failure of the pass reach the runner, which logs it and runs again', async () => {
    const job = createSearchSyncJob({
      consume: () => Promise.reject(new Error('queue unreachable')),
      intervalMs: 10,
      logger: logger(),
    });
    await expect(job.run()).rejects.toThrow('queue unreachable');
  });
});

describe('createSearchReindexJob', () => {
  it('logs the counts of the run, as an error when documents failed', async () => {
    const log = logger();
    const base = { sitesProcessed: 4, documentsWritten: 20, sitesRemoved: 1, cursor: null };
    await createSearchReindexJob({
      reindex: () => Promise.resolve({ ...base, failed: [] }),
      intervalMs: 10,
      runOnStart: true,
      logger: log,
    }).run();
    expect(log.info).toHaveBeenCalledWith(
      'search reindex: 4 sites, 20 documents written, 1 sites removed',
    );
    await createSearchReindexJob({
      reindex: () => Promise.resolve({ ...base, failed: ['a', 'b'] }),
      intervalMs: 10,
      runOnStart: false,
      logger: log,
    }).run();
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('2 documents failed'));
    // no document id is logged
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('"a"');
  });

  it('runs at start only when asked to', () => {
    const job = (runOnStart: boolean) =>
      createSearchReindexJob({
        reindex: () => Promise.reject(new Error('unused')),
        intervalMs: 10,
        runOnStart,
        logger: logger(),
      });
    expect(job(true).runOnStart).toBe(true);
    expect(job(false).runOnStart).toBe(false);
  });
});

describe('onceSucceeded', () => {
  it('retries a failing step on every call until it works, then never again', async () => {
    let attempts = 0;
    const ensure = onceSucceeded(() => {
      attempts += 1;
      return attempts < 3 ? Promise.reject(new Error('down')) : Promise.resolve();
    });
    await expect(ensure()).rejects.toThrow('down');
    await expect(ensure()).rejects.toThrow('down');
    await ensure();
    await ensure();
    expect(attempts).toBe(3);
  });
});

describe('readSearchWorkerConfig', () => {
  it('starts nothing without a worker database and OpenSearch', () => {
    expect(readSearchWorkerConfig({}).enabled).toBe(false);
    expect(readSearchWorkerConfig({ WORKER_DATABASE_URL: 'postgres://x' }).enabled).toBe(false);
    expect(readSearchWorkerConfig({ OPENSEARCH_URL: 'http://localhost:9200' }).enabled).toBe(false);
    expect(
      readSearchWorkerConfig({
        WORKER_DATABASE_URL: 'postgres://x',
        OPENSEARCH_URL: 'http://localhost:9200',
      }).enabled,
    ).toBe(true);
  });

  it('consumes the queue only when its URL is set, and reindexes only when asked', () => {
    const config = readSearchWorkerConfig({});
    expect(config).toMatchObject({
      consumeQueue: false,
      reindexIntervalMs: null,
      reindexOnStart: false,
      intervalMs: 2000,
      batchSize: 10,
      reindexBatchSize: 100,
    });
    expect(
      readSearchWorkerConfig({ QUEUE_URL_LC_SEARCH_SYNC: 'http://q/lc-search-sync' }).consumeQueue,
    ).toBe(true);
    expect(
      readSearchWorkerConfig({
        SEARCH_REINDEX_INTERVAL_MS: '3600000',
        SEARCH_REINDEX_ON_START: 'true',
        SEARCH_POLL_BATCH_SIZE: '50',
      }),
    ).toMatchObject({ reindexIntervalMs: 3_600_000, reindexOnStart: true, batchSize: 10 });
  });

  it('refuses a bad number', () => {
    expect(() => readSearchWorkerConfig({ SEARCH_POLL_INTERVAL_MS: '0' })).toThrow(RangeError);
    expect(() => readSearchWorkerConfig({ SEARCH_REINDEX_INTERVAL_MS: 'daily' })).toThrow(
      RangeError,
    );
  });
});
