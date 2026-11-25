import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import {
  AuditService,
  ConfigParameters,
  OutboxService,
  PaymentsRuntime,
  TimerService,
  type Clock,
} from '@labconnect/core';
import { CLOCK } from '../platform/platform.providers.js';
import { PlatformModule } from '../platform/platform.module.js';
import { PaymentWebhookController } from './payment-webhook.controller.js';

/** The environment the payments module reads. Replaced in tests. */
export const PAYMENTS_ENV = Symbol('PAYMENTS_ENV');
export type PaymentsEnv = Record<string, string | undefined>;

/**
 * Payments, HTTP side (ADR-020): the gateway webhook intake. The logic is in
 * `@labconnect/core` (`payments/`); this module wires it. The customer-facing operations
 * (`createPaymentOrder`, `listPaymentOrders`, `getPaymentReturnStatus`) are not here: they
 * need the membership and permission guards of P3-04.
 *
 * It fails to start for a misconfigured gateway (anything but `fake`, or the fake in
 * production), and reads its secrets only when first used.
 */
@Module({
  imports: [PlatformModule],
  controllers: [PaymentWebhookController],
  providers: [
    { provide: PAYMENTS_ENV, useFactory: (): PaymentsEnv => process.env },
    {
      provide: PaymentsRuntime,
      useFactory: (
        env: PaymentsEnv,
        clock: Clock,
        audit: AuditService,
        outbox: OutboxService,
        timers: TimerService,
        config: ConfigParameters,
      ) => new PaymentsRuntime(env, { clock, audit, outbox, timers, config }),
      inject: [PAYMENTS_ENV, CLOCK, AuditService, OutboxService, TimerService, ConfigParameters],
    },
  ],
  exports: [PaymentsRuntime],
})
export class PaymentsModule implements OnModuleInit {
  constructor(@Inject(PaymentsRuntime) private readonly runtime: PaymentsRuntime) {}

  onModuleInit(): void {
    this.runtime.validate();
  }
}
