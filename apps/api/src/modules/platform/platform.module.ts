import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';
import { CLOCK, platformProviders, PRISMA_CLIENT } from './platform.providers.js';
import { AuditService, ConfigParameters, OutboxService } from '@labconnect/core';

@Module({
  controllers: [HealthController],
  providers: [HealthService, ...platformProviders],
  exports: [CLOCK, PRISMA_CLIENT, AuditService, OutboxService, ConfigParameters],
})
export class PlatformModule {}
