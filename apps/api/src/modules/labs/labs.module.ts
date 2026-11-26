import { Module } from '@nestjs/common';
import { type Clock, LabDirectoryService } from '@labconnect/core';
import type { PrismaClient } from '@labconnect/database';
import { FilesModule } from '../files/files.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { PlatformModule } from '../platform/platform.module.js';
import { CLOCK, PRISMA_CLIENT } from '../platform/platform.providers.js';
import { AdminLabClaimsController } from './admin-lab-claims.controller.js';
import { AdminLabClaimsService } from './admin-lab-claims.service.js';
import { LabClaimsController } from './lab-claims.controller.js';
import { LabClaimsService } from './lab-claims.service.js';
import { PublicLabSitesController } from './public-lab-sites.controller.js';

/**
 * Labs (MODULE_BOUNDARIES: owner @Hashtrak-sh). So far only the public read side of the lab
 * directory, built for the customer increment I1 (I1-CUS-02 onwards) and reviewed by the owner:
 * `LabDirectoryService` of `@labconnect/core` and the public lab site controller. Onboarding,
 * pricing and capacity commands come with the lab slices.
 */
@Module({
  imports: [PlatformModule, IdentityModule, FilesModule],
  controllers: [PublicLabSitesController, LabClaimsController, AdminLabClaimsController],
  providers: [
    LabClaimsService,
    AdminLabClaimsService,
    {
      provide: LabDirectoryService,
      useFactory: (clock: Clock, prisma: PrismaClient) =>
        new LabDirectoryService({ clock, prisma }),
      inject: [CLOCK, PRISMA_CLIENT],
    },
  ],
  exports: [LabDirectoryService],
})
export class LabsModule {}
