import 'reflect-metadata';
import {
  BookingNotificationContext,
  EmailConfigError,
  InMemoryEmailSender,
  InMemoryNotificationContext,
  InMemoryQueueConsumer,
  selectEmailTransport,
} from '@labconnect/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import type { Scheduler } from '../platform/polling-runner.js';
import { createEmailDeliveryJob, createNotificationsConsumerJob } from './notifications-jobs.js';
import {
  NOTIFICATIONS_CONTEXT_SOURCE,
  NOTIFICATIONS_EMAIL_SENDER,
  NOTIFICATIONS_QUEUE_CONSUMER,
  NOTIFICATIONS_SCHEDULER,
  NOTIFICATIONS_WORKER_CONFIG,
  NotificationsWorkerModule,
  createNotificationsContextSource,
  type NotificationsContextSource,
} from './notifications-worker.module.js';
import {
  type NotificationsWorkerConfig,
  readNotificationsContextSource,
  readNotificationsWorkerConfig,
} from './notifications-worker.config.js';

const logger = () => ({ info: vi.fn(), error: vi.fn() });

describe('createNotificationsConsumerJob', () => {
  it('logs counts only', async () => {
    const log = logger();
    await createNotificationsConsumerJob({
      consume: () => Promise.resolve({ received: 2, acknowledged: 2, failed: 0, left: 0 }),
      intervalMs: 10,
      logger: log,
    }).run();
    expect(log.info).toHaveBeenCalledWith('notifications queue: 2 events processed');

    const failing = logger();
    await createNotificationsConsumerJob({
      consume: () => Promise.resolve({ received: 4, acknowledged: 1, failed: 1, left: 2 }),
      intervalMs: 10,
      logger: failing,
    }).run();
    expect(failing.error).toHaveBeenCalledWith(
      'notifications queue: 1 messages failed, 2 left, 1 done',
    );

    const quiet = logger();
    await createNotificationsConsumerJob({
      consume: () => Promise.resolve({ received: 0, acknowledged: 0, failed: 0, left: 0 }),
      intervalMs: 10,
      logger: quiet,
    }).run();
    expect(quiet.info).not.toHaveBeenCalled();
    expect(quiet.error).not.toHaveBeenCalled();
  });

  it('lets a failure of the pass reach the runner', async () => {
    await expect(
      createNotificationsConsumerJob({
        consume: () => Promise.reject(new Error('queue unreachable')),
        intervalMs: 10,
        logger: logger(),
      }).run(),
    ).rejects.toThrow('queue unreachable');
  });
});

describe('createEmailDeliveryJob', () => {
  it('logs counts, never an address or a subject, and an error when an email failed for good', async () => {
    const log = logger();
    await createEmailDeliveryJob({
      deliver: () => Promise.resolve({ sent: 3, retried: 1, failed: 0, suppressed: 1 }),
      intervalMs: 10,
      logger: log,
    }).run();
    expect(log.info).toHaveBeenCalledWith('email delivery: 3 sent, 1 to retry, 1 not sent');

    const failing = logger();
    await createEmailDeliveryJob({
      deliver: () => Promise.resolve({ sent: 1, retried: 0, failed: 2, suppressed: 0 }),
      intervalMs: 10,
      logger: failing,
    }).run();
    expect(failing.error).toHaveBeenCalledWith(
      'email delivery: 2 failed for good, 0 to retry, 1 sent',
    );
    const text = JSON.stringify([log.info.mock.calls, failing.error.mock.calls]);
    expect(text).not.toMatch(/@|subject|booking/i);

    const quiet = logger();
    await createEmailDeliveryJob({
      deliver: () => Promise.resolve({ sent: 0, retried: 0, failed: 0, suppressed: 0 }),
      intervalMs: 10,
      logger: quiet,
    }).run();
    expect(quiet.info).not.toHaveBeenCalled();
  });
});

describe('the notification context source', () => {
  it('is unset by default (the queue is not consumed) and `booking` selects the booking adapter', () => {
    expect(readNotificationsContextSource({})).toBeUndefined();
    expect(readNotificationsContextSource({ NOTIFICATIONS_CONTEXT_SOURCE: ' ' })).toBeUndefined();
    expect(readNotificationsContextSource({ NOTIFICATIONS_CONTEXT_SOURCE: 'booking' })).toBe(
      'booking',
    );
    expect(() => readNotificationsContextSource({ NOTIFICATIONS_CONTEXT_SOURCE: 'x' })).toThrow(
      /NOTIFICATIONS_CONTEXT_SOURCE/,
    );
    const database = { client: {} as never };
    expect(createNotificationsContextSource(undefined, database)).toEqual({});
    expect(createNotificationsContextSource('booking', database).port).toBeInstanceOf(
      BookingNotificationContext,
    );
  });
});

describe('readNotificationsWorkerConfig', () => {
  it('has defaults for a developer machine', () => {
    expect(readNotificationsWorkerConfig({})).toEqual({
      enabled: false,
      consumeQueue: false,
      webBaseUrl: 'http://localhost:3000',
      consumerIntervalMs: 2000,
      consumerBatchSize: 10,
      emailIntervalMs: 5000,
      emailBatchSize: 25,
      emailMaxAttempts: 5,
    });
  });

  it('reads the queue, the base URL and the intervals', () => {
    const config = readNotificationsWorkerConfig({
      WORKER_DATABASE_URL: 'postgresql://x',
      QUEUE_URL_LC_NOTIFICATIONS_FIFO: 'http://localhost:4566/000000000000/lc-notifications.fifo',
      WEB_BASE_URL: 'https://app.labconnect.example/',
      EMAIL_POLL_INTERVAL_MS: '1000',
      NOTIFICATIONS_POLL_BATCH_SIZE: '50',
    });
    expect(config).toMatchObject({
      enabled: true,
      consumeQueue: true,
      webBaseUrl: 'https://app.labconnect.example',
      emailIntervalMs: 1000,
      consumerBatchSize: 10, // SQS hands out at most ten
    });
  });

  it('requires the base URL in a deployed environment, and a valid one everywhere', () => {
    expect(() =>
      readNotificationsWorkerConfig({
        WORKER_DATABASE_URL: 'postgresql://x',
        NODE_ENV: 'production',
      }),
    ).toThrow(/WEB_BASE_URL/);
    expect(() => readNotificationsWorkerConfig({ WEB_BASE_URL: 'ftp://x' })).toThrow(/http/);
    expect(() => readNotificationsWorkerConfig({ EMAIL_BATCH_SIZE: '0' })).toThrow(/positive/);
  });
});

const config = (overrides: Partial<NotificationsWorkerConfig>): NotificationsWorkerConfig => ({
  enabled: false,
  consumeQueue: false,
  webBaseUrl: 'http://localhost:3000',
  consumerIntervalMs: 11,
  consumerBatchSize: 5,
  emailIntervalMs: 22,
  emailBatchSize: 5,
  emailMaxAttempts: 5,
  ...overrides,
});

async function boot(
  overrides: Partial<NotificationsWorkerConfig>,
  options: {
    source?: NotificationsContextSource;
    sender?: () => InMemoryEmailSender;
    /** Keep the module's own provider (it reads `NOTIFICATIONS_CONTEXT_SOURCE`). */
    environmentSource?: boolean;
  } = {},
): Promise<number[]> {
  const scheduled: number[] = [];
  const scheduler: Scheduler = {
    setInterval: (_callback, milliseconds) => scheduled.push(milliseconds),
    clearInterval: () => undefined,
  };
  const builder = Test.createTestingModule({ imports: [NotificationsWorkerModule] })
    .overrideProvider(NOTIFICATIONS_WORKER_CONFIG)
    .useValue(config(overrides))
    .overrideProvider(NOTIFICATIONS_SCHEDULER)
    .useValue(scheduler)
    .overrideProvider(NOTIFICATIONS_QUEUE_CONSUMER)
    .useValue(new InMemoryQueueConsumer())
    .overrideProvider(NOTIFICATIONS_EMAIL_SENDER)
    .useValue(options.sender ?? (() => new InMemoryEmailSender()));
  const moduleRef = await (
    options.environmentSource === true
      ? builder
      : builder.overrideProvider(NOTIFICATIONS_CONTEXT_SOURCE).useValue(options.source ?? {})
  ).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  await app.close();
  return scheduled;
}

describe('NotificationsWorkerModule', () => {
  it('builds with no database, queue or mail configuration and starts nothing', async () => {
    expect(await boot({ enabled: false })).toEqual([]);
  });

  it('delivers email with a database, and does not consume the queue without a context adapter', async () => {
    expect(await boot({ enabled: true })).toEqual([22]);
    expect(await boot({ enabled: true, consumeQueue: true })).toEqual([22]);
  });

  it('consumes the queue once a context adapter is registered and a queue is configured', async () => {
    const source = { port: new InMemoryNotificationContext() };
    expect(await boot({ enabled: true, consumeQueue: true }, { source })).toEqual([22, 11]);
    expect(await boot({ enabled: true }, { source })).toEqual([22]);
  });

  it('consumes the queue only when NOTIFICATIONS_CONTEXT_SOURCE=booking and a queue are both set', async () => {
    const consuming = { enabled: true, consumeQueue: true };
    vi.stubEnv('NOTIFICATIONS_CONTEXT_SOURCE', '');
    expect(await boot(consuming, { environmentSource: true })).toEqual([22]);
    vi.stubEnv('NOTIFICATIONS_CONTEXT_SOURCE', 'booking');
    expect(await boot(consuming, { environmentSource: true })).toEqual([22, 11]);
    expect(await boot({ enabled: true }, { environmentSource: true })).toEqual([22]);
    vi.unstubAllEnvs();
  });

  it('refuses to start with an unknown context source', async () => {
    vi.stubEnv('NOTIFICATIONS_CONTEXT_SOURCE', 'disputes');
    await expect(
      boot({ enabled: true, consumeQueue: true }, { environmentSource: true }),
    ).rejects.toThrow(/NOTIFICATIONS_CONTEXT_SOURCE/);
    vi.unstubAllEnvs();
  });

  it('refuses to start in production without a real mail sender', async () => {
    const throwing = () => {
      selectEmailTransport({ NODE_ENV: 'production' });
      return new InMemoryEmailSender();
    };
    await expect(boot({ enabled: true }, { sender: throwing })).rejects.toBeInstanceOf(
      EmailConfigError,
    );
  });
});
