import { describe, expect, it, vi } from 'vitest';
import { createDevScanJob, createFilesConsumerJob } from './files-jobs.js';
import { readFilesWorkerConfig } from './files-worker.config.js';

const logger = () => ({ info: vi.fn(), error: vi.fn() });

describe('createFilesConsumerJob', () => {
  it('logs counts only, as info when all is well', async () => {
    const log = logger();
    const job = createFilesConsumerJob({
      consume: () => Promise.resolve({ received: 2, acknowledged: 2, failed: 0, left: 0 }),
      intervalMs: 10,
      logger: log,
    });
    await job.run();
    expect(log.info).toHaveBeenCalledWith('files queue: 2 scan results processed');
    expect(log.error).not.toHaveBeenCalled();
  });

  it('logs an error with counts when messages failed or were left, and nothing for an empty queue', async () => {
    const log = logger();
    await createFilesConsumerJob({
      consume: () => Promise.resolve({ received: 3, acknowledged: 1, failed: 1, left: 1 }),
      intervalMs: 10,
      logger: log,
    }).run();
    expect(log.error).toHaveBeenCalledWith('files queue: 1 messages failed, 1 left, 1 done');

    const quiet = logger();
    await createFilesConsumerJob({
      consume: () => Promise.resolve({ received: 0, acknowledged: 0, failed: 0, left: 0 }),
      intervalMs: 10,
      logger: quiet,
    }).run();
    expect(quiet.info).not.toHaveBeenCalled();
    expect(quiet.error).not.toHaveBeenCalled();
  });

  it('lets a failure of the pass reach the runner, which logs it and runs again', async () => {
    const job = createFilesConsumerJob({
      consume: () => Promise.reject(new Error('queue unreachable')),
      intervalMs: 10,
      logger: logger(),
    });
    await expect(job.run()).rejects.toThrow('queue unreachable');
  });
});

describe('createDevScanJob', () => {
  it('says that the scanner is a fake', async () => {
    const log = logger();
    await createDevScanJob({
      runOnce: () => Promise.resolve({ scanned: 1, failed: 0 }),
      intervalMs: 10,
      logger: log,
    }).run();
    expect(log.info.mock.calls[0]?.[0]).toContain('fake scanner');
  });
});

describe('readFilesWorkerConfig', () => {
  it('starts nothing without a worker database and a bucket', () => {
    expect(readFilesWorkerConfig({}).enabled).toBe(false);
    expect(readFilesWorkerConfig({ WORKER_DATABASE_URL: 'postgres://x' }).enabled).toBe(false);
    expect(readFilesWorkerConfig({ FILES_BUCKET: 'b' }).enabled).toBe(false);
    expect(
      readFilesWorkerConfig({ WORKER_DATABASE_URL: 'postgres://x', FILES_BUCKET: 'b' }).enabled,
    ).toBe(true);
  });

  it('consumes the queue only when its URL is set', () => {
    expect(readFilesWorkerConfig({}).consumeQueue).toBe(false);
    expect(readFilesWorkerConfig({ QUEUE_URL_LC_FILES: 'http://q/lc-files' }).consumeQueue).toBe(
      true,
    );
  });

  it('refuses the dev scan outside development and test, so the worker does not start', () => {
    expect(
      readFilesWorkerConfig({ NODE_ENV: 'development', FILES_DEV_AUTO_SCAN: 'true' }).devScan,
    ).toBe(true);
    expect(readFilesWorkerConfig({ NODE_ENV: 'production' }).devScan).toBe(false);
    expect(() =>
      readFilesWorkerConfig({ NODE_ENV: 'production', FILES_DEV_AUTO_SCAN: 'true' }),
    ).toThrow('NODE_ENV');
  });

  it('rejects a bad interval', () => {
    expect(() => readFilesWorkerConfig({ FILES_POLL_INTERVAL_MS: '0' })).toThrow(RangeError);
    expect(readFilesWorkerConfig({ FILES_POLL_INTERVAL_MS: '500' }).intervalMs).toBe(500);
  });
});
