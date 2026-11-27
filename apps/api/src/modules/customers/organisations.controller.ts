import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { formatEtag } from '../../common/etag.js';
import { Idempotent } from '../../common/idempotency.interceptor.js';
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
 * `Idempotency-Key` is honoured (`@Idempotent()`, API_CONVENTIONS section 5): a repeat with the
 * same key, user and route gets the stored 201 and creates nothing, so a double submit of the
 * sign-up form (which sends one key per form) is one organisation. A replayed answer has the body
 * but not the headers this handler sets (`ETag`, `Cache-Control`; OQ-200); the body carries
 * `lockVersion`, the value the `ETag` holds.
 */
@Controller('customer')
export class CustomerOrganisationsController {
  constructor(private readonly organisations: CustomerOrganisationsService) {}

  /** `createCustomerOrganisation`: 201 with the organisation and its `ETag`. */
  @Post('organisations')
  @HttpCode(201)
  @Authorised({ noPermissionRequired: true })
  @Idempotent()
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
