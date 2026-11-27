import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { formatEtag } from '../../common/etag.js';
import { Authorised } from '../identity/authorised.decorator.js';
import { requestMeta } from '../identity/auth.controller.js';
import { CurrentActor } from '../identity/current-actor.js';
import { parseCustomerOrganisationCreate } from './organisations.dto.js';
import {
  type CustomerOrganisationBody,
  CustomerOrganisationsService,
  toCustomerOrganisationBody,
} from './organisations.service.js';

/**
 * Customer organisations under `/v1/customer` (API_CONTRACTS.md section 3, `paths/customer.yaml`,
 * FR-ONB-01). Sign-up is open to any signed-in user, with or without a membership, so
 * `noPermissionRequired` is the declaration; the service refuses platform staff (RR-5). The caller
 * becomes the first `CUSTOMER_ADMIN` and switches to the new membership with
 * `POST /me/active-membership`.
 *
 * `Idempotency-Key` is required by the contract and not yet honoured here (OQ-87): a repeated
 * sign-up with a GSTIN is refused by the GSTIN rule, one without a GSTIN (an individual) creates
 * a second organisation. The web form submits once.
 */
@Controller('customer')
export class CustomerOrganisationsController {
  constructor(private readonly organisations: CustomerOrganisationsService) {}

  /** `createCustomerOrganisation`: 201 with the organisation and its `ETag`. */
  @Post('organisations')
  @HttpCode(201)
  @Authorised({ noPermissionRequired: true })
  // TODO(I1-SHR-01): put the shared idempotency decorator here (key, user and route; OQ-87).
  async createCustomerOrganisation(
    @Body() body: unknown,
    @CurrentActor() actor: CurrentActor,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CustomerOrganisationBody> {
    const input = parseCustomerOrganisationCreate(body);
    const organisation = await this.organisations.create(actor, input, requestMeta(request));
    response.setHeader('ETag', formatEtag(organisation.lockVersion));
    response.setHeader('Cache-Control', 'no-store');
    return toCustomerOrganisationBody(organisation);
  }
}
