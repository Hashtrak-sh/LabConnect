import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type BookingEngine, type BookingEngineServices, PaymentsRuntime } from '@labconnect/core';
import {
  BOOKING_ENGINE,
  BOOKING_SERVICES,
  BookingWorkerModule,
} from '../booking/booking-worker.module.js';
import { PlatformWorkerModule, WorkerDatabase } from '../platform/platform-worker.module.js';
import { PollingRunner, type Scheduler, systemScheduler } from '../platform/polling-runner.js';
import {
  createPaymentEventsJob,
  type PaymentJobsConfig,
  readPaymentJobsConfig,
} from './payment-jobs.js';

export const PAYMENT_JOBS_CONFIG = Symbol('PAYMENT_JOBS_CONFIG');
/** The environment the payments runtime reads. Replaced in tests. */
export const PAYMENTS_ENV = Symbol('PAYMENTS_ENV');
export const PAYMENT_JOBS_SCHEDULER = Symbol('PAYMENT_JOBS_SCHEDULER');

/**
 * Starts the payments job (processing of stored gateway notifications) when the worker has a
 * database, and stops it, waiting for a run in progress, on shutdown. A misconfigured gateway
 * (anything but `fake`, or the fake in production) stops the worker from starting.
 */
@Injectable()
export class PaymentJobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('PaymentJobs');
  private runner: PollingRunner | undefined;

  constructor(
    private readonly database: WorkerDatabase,
    @Inject(PaymentsRuntime) private readonly payments: PaymentsRuntime,
    @Inject(PAYMENT_JOBS_CONFIG) private readonly config: PaymentJobsConfig,
    @Inject(PAYMENT_JOBS_SCHEDULER) private readonly scheduler: Scheduler,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.enabled) {
      this.logger.warn('WORKER_DATABASE_URL is not set: the payment jobs are not started.');
      return;
    }
    this.payments.validate();
    const logger = {
      info: (message: string) => {
        this.logger.log(message);
      },
      error: (message: string) => {
        this.logger.error(message);
      },
    };
    this.runner = new PollingRunner(
      [
        createPaymentEventsJob({
          process: (skipIds) =>
            this.payments.service.processPending(this.database.client, {
              batchSize: this.config.batchSize,
              skipIds,
            }),
          batchSize: this.config.batchSize,
          intervalMs: this.config.intervalMs,
          logger,
        }),
      ],
      this.scheduler,
      logger,
    );
    this.runner.start();
    this.logger.log('Payment jobs started: gateway notification processing.');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.runner?.stop();
  }
}

@Module({
  imports: [PlatformWorkerModule, BookingWorkerModule],
  providers: [
    PaymentJobsService,
    { provide: PAYMENT_JOBS_CONFIG, useFactory: () => readPaymentJobsConfig() },
    { provide: PAYMENT_JOBS_SCHEDULER, useValue: systemScheduler },
    { provide: PAYMENTS_ENV, useFactory: (): Record<string, string | undefined> => process.env },
    {
      provide: PaymentsRuntime,
      // The worker's one booking engine, so that payments and the booking timers move bookings
      // through the same registry (default effects and the T-09 guard).
      useFactory: (
        env: Record<string, string | undefined>,
        services: BookingEngineServices,
        engine: BookingEngine,
      ) => new PaymentsRuntime(env, services, engine),
      inject: [PAYMENTS_ENV, BOOKING_SERVICES, BOOKING_ENGINE],
    },
  ],
  exports: [PaymentsRuntime],
})
export class PaymentsWorkerModule {}
