import { Module, type Provider } from '@nestjs/common';
import { type Clock, LazySearchService } from '@labconnect/core';
import type { PrismaClient } from '@labconnect/database';
import { PlatformModule } from '../platform/platform.module.js';
import { CLOCK, PRISMA_CLIENT } from '../platform/platform.providers.js';
import { PincodeLocator, UnavailablePincodeLocator } from './pincode-locator.js';
import { SearchController } from './search.controller.js';

export const searchProviders: Provider[] = [
  {
    provide: LazySearchService,
    // Built at the first search: the API boots without a database or OpenSearch (tests, first
    // deployment), and a bad OPENSEARCH_* setting shows at the first search, not at start.
    useFactory: (clock: Clock, prisma: PrismaClient) => new LazySearchService({ clock, prisma }),
    inject: [CLOCK, PRISMA_CLIENT],
  },
  // No pincode dataset yet (OQ-153): every pincode is unknown until a real locator is provided.
  { provide: PincodeLocator, useClass: UnavailablePincodeLocator },
];

/**
 * Search (P3-10): `SearchService` of `@labconnect/core` as the `LazySearchService` provider, plus
 * the mapper to the contract's response (`search-response.ts`), and the public controller of the
 * customer search increment (I1-CUS-01 `searchLabs`; `suggestSearch` follows in I1-CUS-08).
 *
 * Search is an event consumer (MODULE_BOUNDARIES rule 5): its index is kept current by the
 * worker from `lc-search-sync`, never by a call during a business write. Public search runs in
 * an anonymous read-only database transaction, not in a tenant or system context.
 */
@Module({
  imports: [PlatformModule],
  controllers: [SearchController],
  providers: searchProviders,
  exports: [LazySearchService],
})
export class SearchModule {}
