import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';
import { CLOCK, platformProviders, PRISMA_CLIENT } from './platform.providers.js';
import {
  AuditService,
  BusinessCalendarLoader,
  ConfigParameters,
  OutboxService,
  TimerService,
} from '@labconnect/core';

@Module({
  controllers: [HealthController],
  providers: [HealthService, ...platformProviders],
  exports: [
    CLOCK,
    PRISMA_CLIENT,
    AuditService,
    OutboxService,
    ConfigParameters,
    TimerService,
    BusinessCalendarLoader,
  ],
})
export class PlatformModule {}
