import {
  AuditService,
  type Clock,
  consumeFilesQueue,
  createS3StorageFromEnv,
  DevScanRunner,
  FakeMalwareScanner,
  FileScanProcessor,
  FileService,
  LazyObjectStorage,
  type ObjectStorage,
  OutboxService,
  type QueueConsumer,
  readFilesConfig,
  createSqsConsumerFromEnv,
} from '@labconnect/core';
import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { CLOCK, PlatformWorkerModule, WorkerDatabase } from '../platform/platform-worker.module.js';
import { PollingRunner, type Scheduler, systemScheduler } from '../platform/polling-runner.js';
import { createDevScanJob, createFilesConsumerJob } from './files-jobs.js';
import { type FilesWorkerConfig, readFilesWorkerConfig } from './files-worker.config.js';

export const FILES_WORKER_CONFIG = Symbol('FILES_WORKER_CONFIG');
export const FILES_SCHEDULER = Symbol('FILES_SCHEDULER');
export const FILES_STORAGE = Symbol('FILES_STORAGE');
export const FILES_QUEUE_CONSUMER = Symbol('FILES_QUEUE_CONSUMER');

/**
 * Starts the files jobs: the `lc-files` consumer (scan results from the queue) and, in
 * development only, the fake-scanner job. Nothing starts without a worker database and a
 * bucket; the queue consumer needs `QUEUE_URL_LC_FILES`. The dev job cannot be switched on
 * outside development or test (`readFilesWorkerConfig` throws, so the worker does not start).
 */
@Injectable()
export class FilesJobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('FilesJobs');
  private runner: PollingRunner | undefined;

  constructor(
    private readonly database: WorkerDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FILES_WORKER_CONFIG) private readonly config: FilesWorkerConfig,
    @Inject(FILES_SCHEDULER) private readonly scheduler: Scheduler,
    @Inject(FILES_STORAGE) private readonly storage: ObjectStorage,
    @Inject(FILES_QUEUE_CONSUMER) private readonly consumer: QueueConsumer,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.enabled) {
      this.logger.warn(
        'WORKER_DATABASE_URL or FILES_BUCKET is not set: the files jobs are not started.',
      );
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
    const processor = new FileScanProcessor({
      prisma: this.database.client,
      files: new FileService({
        clock: this.clock,
        audit: new AuditService(this.clock),
        outbox: new OutboxService(this.clock),
        storage: this.storage,
        config: () => readFilesConfig(),
      }),
      storage: this.storage,
      config: () => readFilesConfig(),
    });

    const jobs = [];
    if (this.config.consumeQueue) {
      jobs.push(
        createFilesConsumerJob({
          consume: () =>
            consumeFilesQueue(this.consumer, processor, { maxMessages: this.config.batchSize }),
          intervalMs: this.config.intervalMs,
          logger,
        }),
      );
    }
    if (this.config.devScan) {
      const runner = new DevScanRunner({
        prisma: this.database.client,
        storage: this.storage,
        scanner: new FakeMalwareScanner(this.storage),
        processor,
      });
      jobs.push(
        createDevScanJob({
          runOnce: () => runner.runOnce(this.config.batchSize),
          intervalMs: this.config.intervalMs,
          logger,
        }),
      );
      this.logger.warn(
        'FILES_DEV_AUTO_SCAN is on: uploads are scanned by a FAKE scanner. Development only.',
      );
    }
    if (jobs.length === 0) {
      this.logger.warn(
        'No files job is enabled: set QUEUE_URL_LC_FILES (or FILES_DEV_AUTO_SCAN locally).',
      );
      return;
    }
    this.runner = new PollingRunner(jobs, this.scheduler, logger);
    this.runner.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.runner?.stop();
  }
}

@Module({
  imports: [PlatformWorkerModule],
  providers: [
    FilesJobsService,
    { provide: FILES_WORKER_CONFIG, useFactory: () => readFilesWorkerConfig() },
    { provide: FILES_SCHEDULER, useValue: systemScheduler },
    {
      provide: FILES_STORAGE,
      useFactory: (clock: Clock): ObjectStorage =>
        new LazyObjectStorage(() => createS3StorageFromEnv(clock)),
      inject: [CLOCK],
    },
    {
      provide: FILES_QUEUE_CONSUMER,
      useFactory: (): QueueConsumer => createSqsConsumerFromEnv(),
    },
  ],
})
export class FilesWorkerModule {}
