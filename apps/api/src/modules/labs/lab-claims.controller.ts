import { Body, Controller, Headers, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { formatEtag, parseIfMatch } from '../../common/etag.js';
import { Authorised } from '../identity/authorised.decorator.js';
import { requestMeta } from '../identity/auth.controller.js';
import { CurrentActor } from '../identity/current-actor.js';
import { parseLabClaimCreate, parseLabClaimOtpVerify, requireClaimId } from './lab-claims.dto.js';
import { type LabClaimBody, LabClaimsService, toLabClaimBody } from './lab-claims.service.js';

/**
 * Lab claims under `/v1/lab/claims` (API_CONTRACTS.md section 6, `paths/lab-onboarding.yaml`,
 * FR-DAT-07). Any signed-in user may call them, with or without a membership: a lab user has
 * none until Ops approves the claim, so `noPermissionRequired` is the declaration, and the
 * service refuses platform staff (RR-5). No value of the request names an organisation: it comes
 * from the certificate number, and a claim is only ever read as its requester.
 *
 * `Idempotency-Key` is required by the contract and not yet honoured, as on the identity routes
 * (OQ-87): a repeated start sends a new code for the same open claim (200), a repeated verify of
 * a verified claim is `409`.
 */
@Controller('lab/claims')
export class LabClaimsController {
  constructor(private readonly claims: LabClaimsService) {}

  /** `startLabClaim`: 201 for a new claim, 200 when a new code was sent for the caller's open one. */
  @Post()
  @Authorised({ noPermissionRequired: true })
  // TODO(I1-SHR-01): put the shared idempotency decorator here (key, user and route; OQ-87).
  async startLabClaim(
    @Body() body: unknown,
    @CurrentActor() actor: CurrentActor,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LabClaimBody> {
    const input = parseLabClaimCreate(body);
    const { claim, created } = await this.claims.start(actor, input, requestMeta(request));
    response.status(created ? 201 : 200);
    response.setHeader('ETag', formatEtag(claim.lockVersion));
    response.setHeader('Cache-Control', 'no-store');
    return toLabClaimBody(claim);
  }

  /** `verifyLabClaimOtp`: `PENDING_OTP` to `PENDING_REVIEW`. Needs `If-Match`. */
  @Post(':id/verify-otp')
  @HttpCode(200)
  @Authorised({ noPermissionRequired: true })
  // TODO(I1-SHR-01): put the shared idempotency decorator here (key, user and route; OQ-87).
  async verifyLabClaimOtp(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | string[] | undefined,
    @Body() body: unknown,
    @CurrentActor() actor: CurrentActor,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LabClaimBody> {
    const claimId = requireClaimId(id);
    const version = parseIfMatch(ifMatch);
    const { code } = parseLabClaimOtpVerify(body);
    const claim = await this.claims.verify(
      actor,
      { claimId, ifMatch: version, code },
      requestMeta(request),
    );
    response.setHeader('ETag', formatEtag(claim.lockVersion));
    response.setHeader('Cache-Control', 'no-store');
    return toLabClaimBody(claim);
  }
}
