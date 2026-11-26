import { Controller, Get, Inject, Query } from '@nestjs/common';
import { LazySearchService, type SearchRequest } from '@labconnect/core';
import type { components } from '@labconnect/api-contract';
import { DomainError, type ProblemIssue } from '../../common/domain-error.js';
import { PincodeLocator } from './pincode-locator.js';
import { parseSearchLabsQuery } from './search.dto.js';
import { type LabSearchResultList, toLabSearchResultList } from './search-response.js';

type SearchSuggestionList = components['schemas']['SearchSuggestionList'];

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

  /**
   * `suggestSearch` (FR-DIS-01, I1-CUS-08): up to 10 suggestions while typing, with the search's
   * synonyms and typo tolerance. `q` is required; any other parameter is 422.
   */
  @Get('suggest')
  async suggestSearch(@Query() query: Record<string, unknown>): Promise<SearchSuggestionList> {
    const issues: ProblemIssue[] = [];
    for (const name of Object.keys(query)) {
      if (name !== 'q') {
        issues.push({
          path: name,
          code: 'UNKNOWN_FIELD',
          message: 'This parameter is not allowed.',
        });
      }
    }
    const q = query.q;
    if (typeof q !== 'string' || q.trim().length === 0) {
      issues.push({
        path: 'q',
        code: q === undefined ? 'REQUIRED' : 'INVALID_VALUE',
        message: 'Give the text typed so far, once.',
      });
    }
    if (issues.length > 0 || typeof q !== 'string') {
      throw new DomainError('VALIDATION_FAILED', {
        detail: 'The query is not valid.',
        errors: issues,
      });
    }
    const suggestions = await this.search.suggest(q);
    return { suggestions };
  }
}
