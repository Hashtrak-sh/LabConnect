import { Controller, Get, Inject, Param } from '@nestjs/common';
import { LabDirectoryService } from '@labconnect/core';
import { DomainError } from '../../common/domain-error.js';
import { type PublicLabSite, toPublicLabSite } from './public-lab-site-response.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path id that is not a UUID is `422 VALIDATION_FAILED` (API_CONVENTIONS §2: ids in URLs are UUIDs). */
export function requireSiteId(siteId: string): string {
  if (UUID.test(siteId)) return siteId;
  throw new DomainError('VALIDATION_FAILED', {
    detail: 'The site id is not valid.',
    errors: [{ path: 'siteId', code: 'INVALID_VALUE', message: 'Give a UUID.' }],
  });
}

/**
 * Public lab site pages under `/v1/public/lab-sites` (API_CONTRACTS.md section 2,
 * `paths/public-lab-sites.yaml`). No authentication: the directory reads public reference data
 * as an anonymous visitor. A site that does not exist and a site that is not public get the same
 * 404, so the answer never says whether a hidden site exists.
 */
@Controller('public/lab-sites')
export class PublicLabSitesController {
  constructor(@Inject(LabDirectoryService) private readonly directory: LabDirectoryService) {}

  /** `getPublicLabSite` (FR-DIS-06, I1-CUS-02). Contact details are never part of it. */
  @Get(':siteId')
  async getPublicLabSite(@Param('siteId') siteId: string): Promise<PublicLabSite> {
    const profile = await this.directory.getPublicSite(requireSiteId(siteId));
    if (profile === null) {
      throw new DomainError('NOT_FOUND', { detail: 'No listed lab site has this id.' });
    }
    return toPublicLabSite(profile);
  }
}
