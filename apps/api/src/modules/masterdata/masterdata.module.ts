import { Module } from '@nestjs/common';
import { type Clock, TaxonomyDirectory } from '@labconnect/core';
import type { PrismaClient } from '@labconnect/database';
import { PlatformModule } from '../platform/platform.module.js';
import { CLOCK, PRISMA_CLIENT } from '../platform/platform.providers.js';
import { PublicTaxonomiesController } from './public-taxonomies.controller.js';

/**
 * Master data (shared module). So far only the public read side of the taxonomies, for the
 * search filters (I1-CUS-06). Change sets, imports and the admin taxonomy screens come with the
 * admin slice of I1.
 */
@Module({
  imports: [PlatformModule],
  controllers: [PublicTaxonomiesController],
  providers: [
    {
      provide: TaxonomyDirectory,
      useFactory: (clock: Clock, prisma: PrismaClient) => new TaxonomyDirectory({ clock, prisma }),
      inject: [CLOCK, PRISMA_CLIENT],
    },
  ],
  exports: [TaxonomyDirectory],
})
export class MasterdataModule {}
