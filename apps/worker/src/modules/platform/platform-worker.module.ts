import {
  type Clock,
  createWorkerPrisma,
  type LazyPrisma,
  type QueuePublisher,
  createSqsPublisherFromEnv,
  SystemClock,
  verifyAllAuditChains,
  relayOutbox,
  runDueTimers,
  TimerHandlerRegistry,
  sealAuditLog,
  purgeExpiredIdempotencyRecords,
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
import {
  createIdempotencyPurgeJob,
  createRelayJob,
  createSealJob,
  createTimerJob,
  createVerifyJob,
} from './platform-jobs.js';
import { type PlatformJobsConfig, readPlatformJobsConfig } from './platform-jobs.config.js';
import { PollingRunner, systemScheduler, type Scheduler } from './polling-runner.js';

export const CLOCK = Symbol('CLOCK');
export const QUEUE_PUBLISHER = Symbol('QUEUE_PUBLISHER');
export const JOBS_CONFIG = Symbol('JOBS_CONFIG');
export const JOBS_SCHEDULER = Symbol('JOBS_SCHEDULER');
/** The registry modules add their timer handlers to in `onModuleInit` (the booking module does, see BookingTimersRegistrar). */
export const TIMER_HANDLERS = Symbol('TIMER_HANDLERS');

/**
 * The worker's database connection: the `app_worker` login user in `WORKER_DATABASE_URL`.
 * It connects on first use, so the module can be built without a database.
 */
@Injectable()
export class WorkerDatabase implements OnApplicationShutdown {
  private readonly lazy: LazyPrisma = createWorkerPrisma();

  get client(): PrismaClient {
    return this.lazy.client;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.lazy.disconnect();
  }
}

/**
 * Starts the platform jobs (outbox relay, audit sealing, nightly audit verification) when
 * the application starts and stops them, waiting for runs in progress, when it shuts down.
 */
@Injectable()
export class PlatformJobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('PlatformJobs');
  private runner: PollingRunner | undefined;

  constructor(
    private readonly database: WorkerDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(QUEUE_PUBLISHER) private readonly publisher: QueuePublisher,
    @Inject(JOBS_CONFIG) private readonly config: PlatformJobsConfig,
    @Inject(JOBS_SCHEDULER) private readonly scheduler: Scheduler,
    @Inject(TIMER_HANDLERS) private readonly timerHandlers: TimerHandlerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.enabled) {
      this.logger.warn('WORKER_DATABASE_URL is not set: the platform jobs are not started.');
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
    this.runner = new PollingRunner(
      [
        createRelayJob({
          relay: () =>
            relayOutbox(prisma, this.publisher, this.clock, {
              batchSize: this.config.relayBatchSize,
            }),
          batchSize: this.config.relayBatchSize,
          intervalMs: this.config.relayIntervalMs,
          logger,
        }),
        createSealJob({
          seal: () => sealAuditLog(prisma, this.clock, { batchSize: this.config.sealBatchSize }),
          batchSize: this.config.sealBatchSize,
          intervalMs: this.config.sealIntervalMs,
          logger,
        }),
        createTimerJob({
          runDue: (skipIds) =>
            runDueTimers(prisma, this.clock, this.timerHandlers, {
              batchSize: this.config.timerBatchSize,
              skipIds,
            }),
          batchSize: this.config.timerBatchSize,
          intervalMs: this.config.timerIntervalMs,
          logger,
        }),
        createIdempotencyPurgeJob({
          purge: () =>
            purgeExpiredIdempotencyRecords(prisma, this.clock, {
              batchSize: this.config.purgeBatchSize,
            }),
          batchSize: this.config.purgeBatchSize,
          intervalMs: this.config.purgeIntervalMs,
          logger,
        }),
        createVerifyJob({
          verifyAll: () => verifyAllAuditChains(prisma, { clock: this.clock }),
          intervalMs: this.config.verifyIntervalMs,
          logger,
        }),
      ],
      this.scheduler,
      logger,
    );
    this.runner.start();
    this.logger.log(
      'Platform jobs started: outbox relay, audit sealing, timers, idempotency purge, audit verification.',
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.runner?.stop();
  }
}

@Module({
  providers: [
    WorkerDatabase,
    PlatformJobsService,
    { provide: CLOCK, useFactory: (): Clock => new SystemClock() },
    { provide: JOBS_CONFIG, useFactory: () => readPlatformJobsConfig() },
    { provide: JOBS_SCHEDULER, useValue: systemScheduler },
    { provide: TIMER_HANDLERS, useFactory: (): TimerHandlerRegistry => new TimerHandlerRegistry() },
    {
      provide: QUEUE_PUBLISHER,
      useFactory: (): QueuePublisher => createSqsPublisherFromEnv(),
    },
  ],
  exports: [WorkerDatabase, CLOCK, QUEUE_PUBLISHER, TIMER_HANDLERS],
})
export class PlatformWorkerModule {}
