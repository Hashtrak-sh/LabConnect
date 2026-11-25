import {
  type Clock,
  consumeSearchSyncQueue,
  createSqsConsumerFromEnv,
  createSyncIndex,
  type QueueConsumer,
  reindexAll,
  type SearchIndex,
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
import { createSearchReindexJob, createSearchSyncJob, onceSucceeded } from './search-jobs.js';
import { readSearchWorkerConfig, type SearchWorkerConfig } from './search-worker.config.js';

export const SEARCH_WORKER_CONFIG = Symbol('SEARCH_WORKER_CONFIG');
export const SEARCH_SCHEDULER = Symbol('SEARCH_SCHEDULER');
export const SEARCH_QUEUE_CONSUMER = Symbol('SEARCH_QUEUE_CONSUMER');
/** `() => SearchIndex | null`: the OpenSearch index the sync writes to, built at start-up. */
export const SEARCH_SYNC_INDEX = Symbol('SEARCH_SYNC_INDEX');

/**
 * Starts the search jobs: the `lc-search-sync` consumer (SEARCH.md section 2) and, when asked
 * for, the full reindex. Nothing starts without a worker database and `OPENSEARCH_URL`; the
 * consumer needs `QUEUE_URL_LC_SEARCH_SYNC` too. The sync reads current state from the database
 * as an anonymous visitor and writes to OpenSearch: it never opens the system context.
 */
@Injectable()
export class SearchJobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('SearchJobs');
  private runner: PollingRunner | undefined;

  constructor(
    private readonly database: WorkerDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SEARCH_WORKER_CONFIG) private readonly config: SearchWorkerConfig,
    @Inject(SEARCH_SCHEDULER) private readonly scheduler: Scheduler,
    @Inject(SEARCH_QUEUE_CONSUMER) private readonly consumer: QueueConsumer,
    @Inject(SEARCH_SYNC_INDEX) private readonly createIndex: () => SearchIndex | null,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.enabled) {
      this.logger.warn(
        'WORKER_DATABASE_URL or OPENSEARCH_URL is not set: the search jobs are not started.',
      );
      return;
    }
    const index = this.createIndex();
    if (index === null) {
      this.logger.warn('OpenSearch is not configured: the search jobs are not started.');
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
    const deps = { prisma: this.database.client, index, clock: this.clock };
    const ensureIndex = onceSucceeded(() => index.ensureIndex());

    const jobs = [];
    if (this.config.consumeQueue) {
      jobs.push(
        createSearchSyncJob({
          consume: async () => {
            await ensureIndex();
            return consumeSearchSyncQueue(this.consumer, deps, {
              maxMessages: this.config.batchSize,
            });
          },
          intervalMs: this.config.intervalMs,
          logger,
        }),
      );
    }
    if (this.config.reindexIntervalMs !== null || this.config.reindexOnStart) {
      jobs.push(
        createSearchReindexJob({
          reindex: async () => {
            await ensureIndex();
            return reindexAll(deps, { batchSize: this.config.reindexBatchSize });
          },
          // With only `SEARCH_REINDEX_ON_START` the interval is a day: the run at start is the load.
          intervalMs: this.config.reindexIntervalMs ?? 86_400_000,
          runOnStart: this.config.reindexOnStart,
          logger,
        }),
      );
    }
    if (jobs.length === 0) {
      this.logger.warn(
        'No search job is enabled: set QUEUE_URL_LC_SEARCH_SYNC, SEARCH_REINDEX_INTERVAL_MS or SEARCH_REINDEX_ON_START.',
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
    SearchJobsService,
    { provide: SEARCH_WORKER_CONFIG, useFactory: () => readSearchWorkerConfig() },
    { provide: SEARCH_SCHEDULER, useValue: systemScheduler },
    {
      provide: SEARCH_QUEUE_CONSUMER,
      useFactory: (): QueueConsumer => createSqsConsumerFromEnv(),
    },
    {
      provide: SEARCH_SYNC_INDEX,
      useFactory: (): (() => SearchIndex | null) => () => createSyncIndex(),
    },
  ],
})
export class SearchWorkerModule {}
