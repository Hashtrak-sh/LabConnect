import { Module } from '@nestjs/common';
import { LabDirectoryService, LeadService } from '@labconnect/core';
import type { PrismaClient } from '@labconnect/database';
import { IdentityModule } from '../identity/identity.module.js';
import { LabsModule } from '../labs/labs.module.js';
import { PlatformModule } from '../platform/platform.module.js';
import { PRISMA_CLIENT } from '../platform/platform.providers.js';
import { LeadsController } from './leads.controller.js';
import { CustomerOrganisationsController } from './organisations.controller.js';
import { CustomerOrganisationsService } from './organisations.service.js';
import { CustomerSitesController } from './sites.controller.js';
import { CustomerSitesService } from './sites.service.js';

/**
 * Customers (MODULE_BOUNDARIES: owner @akshit-anand). So far the public "Request a lab" leads
 * (I1-CUS-07), customer sign-up (I2-CUS-02) and sites (I2-CUS-03). Settings and users come with I2.
 */
@Module({
  imports: [PlatformModule, IdentityModule, LabsModule],
  controllers: [LeadsController, CustomerOrganisationsController, CustomerSitesController],
  providers: [
    CustomerOrganisationsService,
    CustomerSitesService,
    {
      provide: LeadService,
      useFactory: (prisma: PrismaClient, labs: LabDirectoryService) =>
        new LeadService({ prisma, labs }),
      inject: [PRISMA_CLIENT, LabDirectoryService],
    },
  ],
})
export class CustomersModule {}
