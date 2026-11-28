import { Module } from '@nestjs/common';
import {
  AuditService,
  type BookingEngine,
  type Clock,
  ConfigParameters,
  createBookingEngine,
  OutboxService,
  TimerService,
} from '@labconnect/core';
import { IdentityModule } from '../identity/identity.module.js';
import { CLOCK } from '../platform/platform.providers.js';
import { PlatformModule } from '../platform/platform.module.js';
import { BookingsController } from './bookings.controller.js';
import { LabInboxController } from './lab-inbox.controller.js';
import { BookingsService } from './bookings.service.js';

import { BOOKING_ENGINE } from './booking-engine.token.js';

export { BOOKING_ENGINE };

/**
 * Bookings, HTTP side (ADR-020, I3-SHR-01). It owns the process's booking engine, built with the
 * same registry as the worker's (`createBookingEngine`), so a transition runs the same guards and
 * effects whichever process fires it; payments takes it from here. The routes are the
 * reads (`listBookings`, `getBooking`), the lab's decisions (`BookingsController`) and the lab
 * inbox (`LabInboxController`).
 */
@Module({
  // IdentityModule exports TenantScope, the API's only door to the database (P3-04).
  imports: [PlatformModule, IdentityModule],
  controllers: [BookingsController, LabInboxController],
  providers: [
    {
      provide: BOOKING_ENGINE,
      useFactory: (
        clock: Clock,
        audit: AuditService,
        outbox: OutboxService,
        timers: TimerService,
        config: ConfigParameters,
      ): BookingEngine => createBookingEngine({ clock, audit, outbox, timers, config }),
      inject: [CLOCK, AuditService, OutboxService, TimerService, ConfigParameters],
    },
    BookingsService,
  ],
  exports: [BOOKING_ENGINE],
})
export class BookingModule {}
