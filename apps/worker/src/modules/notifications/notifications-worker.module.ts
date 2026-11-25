import {
  BookingNotificationContext,
  type Clock,
  consumeNotificationsQueue,
  createEmailSender,
  createSqsConsumerFromEnv,
  type EmailSender,
  type NotificationContextPort,
  type QueueConsumer,
  runEmailDeliveries,
} from '@labconnect/core';
import type { PrismaClient } from '@labconnect/database';
import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { CLOCK, PlatformWorkerModule, WorkerDatabase } from '../platform/platform-worker.module.js';
import {
  type PollingJob,
  PollingRunner,
  type Scheduler,
  systemScheduler,
} from '../platform/polling-runner.js';
import { createEmailDeliveryJob, createNotificationsConsumerJob } from './notifications-jobs.js';
import {
  type NotificationContextSourceName,
  type NotificationsWorkerConfig,
  readNotificationsContextSource,
  readNotificationsWorkerConfig,
} from './notifications-worker.config.js';

export const NOTIFICATIONS_WORKER_CONFIG = Symbol('NOTIFICATIONS_WORKER_CONFIG');
export const NOTIFICATIONS_SCHEDULER = Symbol('NOTIFICATIONS_SCHEDULER');
export const NOTIFICATIONS_QUEUE_CONSUMER = Symbol('NOTIFICATIONS_QUEUE_CONSUMER');
/** Builds the email sender when the jobs start. Throws in production without a real sender. */
export const NOTIFICATIONS_EMAIL_SENDER = Symbol('NOTIFICATIONS_EMAIL_SENDER');
/**
 * Where the consumer learns who is involved in an event that does not say (the booking number,
 * the parties, the lab's name). The environment variable `NOTIFICATIONS_CONTEXT_SOURCE=booking`
 * selects the booking adapter; until one is selected the consumer does not start, so no event is
 * taken off the queue and lost (OQ-140). Override this provider in tests.
 */
export const NOTIFICATIONS_CONTEXT_SOURCE = Symbol('NOTIFICATIONS_CONTEXT_SOURCE');

export interface NotificationsContextSource {
  port?: NotificationContextPort;
}

/**
 * The context source the environment selects (`NOTIFICATIONS_CONTEXT_SOURCE`): `booking` is the
 * adapter for events of a booking; nothing is the safe default (the queue is not consumed). The
 * adapter reaches the database through the worker's lazy client, so building it needs no database.
 */
export function createNotificationsContextSource(
  name: NotificationContextSourceName | undefined,
  database: { readonly client: PrismaClient },
): NotificationsContextSource {
  if (name === 'booking') {
    return { port: new BookingNotificationContext(database.client) };
  }
  return {};
}

/**
 * Starts the notification jobs: the consumer of `lc-notifications.fifo` (when a queue URL is
 * configured and a context adapter is registered) and the email delivery pass (always, with a
 * worker database). The sender is chosen from the environment when the jobs start; in production
 * a missing or in-memory sender stops the worker from starting, by design.
 */
@Injectable()
export class NotificationsJobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('NotificationsJobs');
  private runner: PollingRunner | undefined;

  constructor(
    private readonly database: WorkerDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NOTIFICATIONS_WORKER_CONFIG) private readonly config: NotificationsWorkerConfig,
    @Inject(NOTIFICATIONS_SCHEDULER) private readonly scheduler: Scheduler,
    @Inject(NOTIFICATIONS_QUEUE_CONSUMER) private readonly consumer: QueueConsumer,
    @Inject(NOTIFICATIONS_EMAIL_SENDER) private readonly createSender: () => EmailSender,
    @Inject(NOTIFICATIONS_CONTEXT_SOURCE)
    private readonly contextSource: NotificationsContextSource,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.enabled) {
      this.logger.warn('WORKER_DATABASE_URL is not set: the notification jobs are not started.');
      return;
    }
    const logger = {
      info: (message: string) => {
        this.logger.log(message);
      },
      error: (message: string) => {
        this.logger.error(message);
      },
    };
    const prisma = this.database.client;
    const jobs: PollingJob[] = [];

    // Throws when the environment asks for something that must not run (EmailConfigError).
    const sender = this.createSender();
    jobs.push(
      createEmailDeliveryJob({
        deliver: () =>
          runEmailDeliveries(
            { prisma, clock: this.clock, sender, webBaseUrl: this.config.webBaseUrl },
            { batchSize: this.config.emailBatchSize, maxAttempts: this.config.emailMaxAttempts },
          ),
        intervalMs: this.config.emailIntervalMs,
        logger,
      }),
    );

    const context = this.contextSource.port;
    if (this.config.consumeQueue && context) {
      const deps = { prisma, clock: this.clock, context };
      jobs.push(
        createNotificationsConsumerJob({
          consume: () =>
            consumeNotificationsQueue(this.consumer, deps, {
              maxMessages: this.config.consumerBatchSize,
            }),
          intervalMs: this.config.consumerIntervalMs,
          logger,
        }),
      );
    } else if (this.config.consumeQueue) {
      this.logger.warn(
        'No notification context adapter is registered: the notifications queue is not consumed (OQ-140).',
      );
    }
    this.runner = new PollingRunner(jobs, this.scheduler, logger);
    this.runner.start();
    this.logger.log(`Notification jobs started: ${jobs.map((job) => job.name).join(', ')}.`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.runner?.stop();
  }
}

@Module({
  imports: [PlatformWorkerModule],
  providers: [
    NotificationsJobsService,
    { provide: NOTIFICATIONS_WORKER_CONFIG, useFactory: () => readNotificationsWorkerConfig() },
    { provide: NOTIFICATIONS_SCHEDULER, useValue: systemScheduler },
    {
      provide: NOTIFICATIONS_QUEUE_CONSUMER,
      useFactory: (): QueueConsumer => createSqsConsumerFromEnv(),
    },
    {
      provide: NOTIFICATIONS_EMAIL_SENDER,
      useFactory: (): (() => EmailSender) => () => createEmailSender({ env: process.env }).sender,
    },
    {
      provide: NOTIFICATIONS_CONTEXT_SOURCE,
      useFactory: (database: WorkerDatabase): NotificationsContextSource =>
        createNotificationsContextSource(readNotificationsContextSource(), database),
      inject: [WorkerDatabase],
    },
  ],
})
export class NotificationsWorkerModule {}
