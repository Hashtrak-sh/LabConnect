import { Module } from '@nestjs/common';
import { LabDirectoryService, LeadService } from '@labconnect/core';
import type { PrismaClient } from '@labconnect/database';
import { LabsModule } from '../labs/labs.module.js';
import { PlatformModule } from '../platform/platform.module.js';
import { PRISMA_CLIENT } from '../platform/platform.providers.js';
import { LeadsController } from './leads.controller.js';

/**
 * Customers (MODULE_BOUNDARIES: owner @akshit-anand). So far the public "Request a lab" leads
 * (I1-CUS-07). Organisations, sites, settings and users come with I2.
 */
@Module({
  imports: [PlatformModule, LabsModule],
  controllers: [LeadsController],
  providers: [
    {
      provide: LeadService,
      useFactory: (prisma: PrismaClient, labs: LabDirectoryService) =>
        new LeadService({ prisma, labs }),
      inject: [PRISMA_CLIENT, LabDirectoryService],
    },
  ],
})
export class CustomersModule {}
