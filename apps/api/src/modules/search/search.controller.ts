import { Controller, Get, Inject, Query } from '@nestjs/common';
import { LazySearchService, type SearchRequest } from '@labconnect/core';
import { DomainError } from '../../common/domain-error.js';
import { PincodeLocator } from './pincode-locator.js';
import { parseSearchLabsQuery } from './search.dto.js';
import { type LabSearchResultList, toLabSearchResultList } from './search-response.js';

/**
 * Public discovery under `/v1/public/search` (API_CONTRACTS.md section 2,
 * `paths/public-search.yaml`). No authentication, membership or tenant: the search reads only
 * public reference data in an anonymous read-only transaction (SEARCH.md section 4).
 *
 * Nothing here logs the query text, the location or the cursor (OQ-40). The 60 per minute per
 * IP limit of the contract is not enforced yet (OQ-88, task I1-CUS-09).
 */
@Controller('public/search')
export class SearchController {
  constructor(
    @Inject(LazySearchService) private readonly search: LazySearchService,
    @Inject(PincodeLocator) private readonly pincodes: PincodeLocator,
  ) {}

  /**
   * `searchLabs` (FR-DIS-01..05). The order is the contract's: by distance with a location,
   * otherwise by relevance (the core default; no `sort` parameter, OQ-151). An empty page is the
   * no-result state (FR-DIS-07).
   */
  @Get('labs')
  async searchLabs(@Query() query: Record<string, unknown>): Promise<LabSearchResultList> {
    const { pincode, limit, ...rest } = parseSearchLabsQuery(query);
    const request: SearchRequest = { ...rest, limit };

    if (pincode !== undefined) {
      const point = await this.pincodes.locate(pincode);
      if (point === null) {
        throw new DomainError('VALIDATION_FAILED', {
          detail: 'The query is not valid.',
          errors: [
            { path: 'pincode', code: 'INVALID_VALUE', message: 'This pincode is not known.' },
          ],
        });
      }
      request.lat = point.lat;
      request.lng = point.lng;
    }

    return toLabSearchResultList(await this.search.search(request), limit);
  }
}
