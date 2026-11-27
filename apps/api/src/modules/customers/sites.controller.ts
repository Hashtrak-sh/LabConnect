import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { formatEtag, parseIfMatch } from '../../common/etag.js';
import { Authorised } from '../identity/authorised.decorator.js';
import { requestMeta } from '../identity/auth.controller.js';
import { CurrentActor } from '../identity/current-actor.js';
import {
  parseCustomerSiteCreate,
  parseCustomerSiteListQuery,
  parseCustomerSiteUpdate,
  requireSiteId,
} from './sites.dto.js';
import {
  type CustomerSiteBody,
  CustomerSitesService,
  toCustomerSiteBody,
} from './sites.service.js';

/**
 * Customer sites under `/v1/customer/sites` (API_CONTRACTS.md §3, `paths/customer.yaml`,
 * FR-ONB-03). Every member of a customer organisation may read them (session-only declaration;
 * the service refuses a lab or platform membership with 403). Changes need `org_user.manage` and
 * `CUSTOMER_ADMIN` of a customer organisation: `LAB_CHECKER` and platform staff hold the
 * permission for their own users, and the service refuses them with 403. The request is checked
 * before the role, so a malformed one is 422 for everybody.
 *
 * `Idempotency-Key` is required by the contract on create and not yet honoured (OQ-87).
 */
@Controller('customer/sites')
export class CustomerSitesController {
  constructor(private readonly sites: CustomerSitesService) {}

  /** `listCustomerSites`: by name, a page at a time. */
  @Get()
  @Authorised({ noPermissionRequired: true })
  async listCustomerSites(
    @Query() query: Record<string, unknown>,
    @CurrentActor() actor: CurrentActor,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ data: CustomerSiteBody[]; page: { nextCursor: string | null; limit: number } }> {
    const input = parseCustomerSiteListQuery(query);
    const result = await this.sites.list(actor, input);
    response.setHeader('Cache-Control', 'no-store');
    return { data: result.data.map(toCustomerSiteBody), page: result.page };
  }

  /** `createCustomerSite`: 201 with the site and its `ETag`. */
  @Post()
  @HttpCode(201)
  @Authorised({ permission: 'org_user.manage' })
  // TODO(I1-SHR-01): put the shared idempotency decorator here (OQ-87).
  async createCustomerSite(
    @Body() body: unknown,
    @CurrentActor() actor: CurrentActor,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CustomerSiteBody> {
    const input = parseCustomerSiteCreate(body);
    const site = await this.sites.create(actor, input, requestMeta(request));
    response.setHeader('ETag', formatEtag(site.lockVersion));
    response.setHeader('Cache-Control', 'no-store');
    return toCustomerSiteBody(site);
  }

  /** `getCustomerSite`: one site with its `ETag`; another organisation's is `404`. */
  @Get(':id')
  @Authorised({ noPermissionRequired: true })
  async getCustomerSite(
    @Param('id') id: string,
    @CurrentActor() actor: CurrentActor,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CustomerSiteBody> {
    const site = await this.sites.get(actor, requireSiteId(id));
    response.setHeader('ETag', formatEtag(site.lockVersion));
    response.setHeader('Cache-Control', 'no-store');
    return toCustomerSiteBody(site);
  }

  /** `updateCustomerSite`: needs `If-Match`; `status: INACTIVE` retires the site. */
  @Patch(':id')
  @Authorised({ permission: 'org_user.manage' })
  async updateCustomerSite(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | string[] | undefined,
    @Body() body: unknown,
    @CurrentActor() actor: CurrentActor,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CustomerSiteBody> {
    const siteId = requireSiteId(id);
    const version = parseIfMatch(ifMatch);
    const changes = parseCustomerSiteUpdate(body);
    const site = await this.sites.update(
      actor,
      { siteId, ifMatch: version, changes },
      requestMeta(request),
    );
    response.setHeader('ETag', formatEtag(site.lockVersion));
    response.setHeader('Cache-Control', 'no-store');
    return toCustomerSiteBody(site);
  }
}
