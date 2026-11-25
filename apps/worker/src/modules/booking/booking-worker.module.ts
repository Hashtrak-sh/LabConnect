import {
  AuditService,
  BookingEngine,
  type BookingEngineServices,
  type Clock,
  ConfigParameters,
  createBookingTimerHandlers,
  createHasPendingPayment,
  OutboxService,
  registerBookingTimerHandlers,
  registerDefaultBookingEffects,
  registerPaymentBookingGuards,
  TimerHandlerRegistry,
  TimerService,
  TransitionRegistry,
} from '@labconnect/core';
import { Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { CLOCK, PlatformWorkerModule, TIMER_HANDLERS } from '../platform/platform-worker.module.js';

/** The platform services every booking transition in this process uses. */
export const BOOKING_SERVICES = Symbol('BOOKING_SERVICES');
/** The one `BookingEngine` of the worker: payments and the booking timers both move bookings with it. */
export const BOOKING_ENGINE = Symbol('BOOKING_ENGINE');

/**
 * The worker's single booking engine. One `TransitionRegistry` holds the default booking
 * effects (they schedule and cancel the booking timers) and the T-09 payment guard (the booking
 * module cannot import payments, so the app adds it, as `PaymentsRuntime` does for the API).
 */
export function createWorkerBookingEngine(services: BookingEngineServices): BookingEngine {
  return new BookingEngine(
    services,
    registerPaymentBookingGuards(registerDefaultBookingEffects(new TransitionRegistry())),
  );
}

/**
 * Registers the booking timer handlers in the worker's `TIMER_HANDLERS` once, in `onModuleInit`.
 * The registry comes from `PlatformWorkerModule`, which this module imports, so the order does
 * not depend on how Nest happens to load the modules. Every `onModuleInit` runs before any
 * `onApplicationBootstrap`, so the timer job never starts with an empty registry.
 *
 * `PAYMENT_DUE` gets its handler only because `hasPendingPayment` is passed (BR-032, OQ-100).
 */
@Injectable()
export class BookingTimersRegistrar implements OnModuleInit {
  private registered = false;

  constructor(
    @Inject(TIMER_HANDLERS) private readonly registry: TimerHandlerRegistry,
    @Inject(BOOKING_ENGINE) private readonly engine: BookingEngine,
    @Inject(BOOKING_SERVICES) private readonly services: BookingEngineServices,
  ) {}

  onModuleInit(): void {
    if (this.registered) return;
    this.registered = true;
    registerBookingTimerHandlers(
      this.registry,
      createBookingTimerHandlers({
        engine: this.engine,
        outbox: this.services.outbox,
        hasPendingPayment: createHasPendingPayment({
          clock: this.services.clock,
          timers: this.services.timers,
        }),
      }),
    );
  }
}

@Module({
  imports: [PlatformWorkerModule],
  providers: [
    {
      provide: BOOKING_SERVICES,
      useFactory: (clock: Clock): BookingEngineServices => {
        const audit = new AuditService(clock);
        return {
          clock,
          audit,
          outbox: new OutboxService(clock),
          timers: new TimerService(clock),
          config: new ConfigParameters(clock, audit),
        };
      },
      inject: [CLOCK],
    },
    {
      provide: BOOKING_ENGINE,
      useFactory: createWorkerBookingEngine,
      inject: [BOOKING_SERVICES],
    },
    BookingTimersRegistrar,
  ],
  exports: [BOOKING_SERVICES, BOOKING_ENGINE],
})
export class BookingWorkerModule {}
