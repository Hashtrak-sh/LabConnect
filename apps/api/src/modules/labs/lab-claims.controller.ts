import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
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
  parseLabClaimCreate,
  parseLabClaimManual,
  parseLabClaimOtpVerify,
  parseLetterheadUploadRequest,
  parsePageQuery,
  requireClaimId,
} from './lab-claims.dto.js';
import {
  type FileUploadUrlBody,
  type LabClaimBody,
  LabClaimsService,
  toLabClaimBody,
} from './lab-claims.service.js';

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

  /** `listMyLabClaims`: the caller's own claims, newest first. Never cached. */
  @Get()
  @Authorised({ noPermissionRequired: true })
  async listMyLabClaims(
    @Query() query: Record<string, unknown>,
    @CurrentActor() actor: CurrentActor,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ data: LabClaimBody[]; page: { nextCursor: string | null; limit: number } }> {
    const input = parsePageQuery(query);
    response.setHeader('Cache-Control', 'no-store');
    const result = await this.claims.list(actor, input);
    return { data: result.data.map(toLabClaimBody), page: result.page };
  }

  /** `getLabClaim`: one claim of the caller with its `ETag`. Another user's claim is `404`. */
  @Get(':id')
  @Authorised({ noPermissionRequired: true })
  async getLabClaim(
    @Param('id') id: string,
    @CurrentActor() actor: CurrentActor,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LabClaimBody> {
    const claimId = requireClaimId(id);
    const claim = await this.claims.get(actor, claimId);
    response.setHeader('ETag', formatEtag(claim.lockVersion));
    response.setHeader('Cache-Control', 'no-store');
    return toLabClaimBody(claim);
  }

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

  /** `createLabClaimLetterheadUploadUrl`: 201 with the pre-signed upload. Own claim, `PENDING_OTP` only. */
  @Post(':id/manual/upload-url')
  @Authorised({ noPermissionRequired: true })
  // TODO(I1-SHR-01): put the shared idempotency decorator here (key, user and route; OQ-87).
  async createLabClaimLetterheadUploadUrl(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentActor() actor: CurrentActor,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FileUploadUrlBody> {
    const claimId = requireClaimId(id);
    const input = parseLetterheadUploadRequest(body);
    const upload = await this.claims.createLetterheadUploadUrl(
      actor,
      { claimId, ...input },
      requestMeta(request),
    );
    // The URL is a secret for its lifetime: nothing may cache the answer.
    response.setHeader('Cache-Control', 'no-store');
    return upload;
  }

  /** `submitLabClaimLetterhead`: `PENDING_OTP` to `PENDING_REVIEW` with method `MANUAL`. Needs `If-Match`. */
  @Post(':id/manual')
  @HttpCode(200)
  @Authorised({ noPermissionRequired: true })
  // TODO(I1-SHR-01): put the shared idempotency decorator here (key, user and route; OQ-87).
  async submitLabClaimLetterhead(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | string[] | undefined,
    @Body() body: unknown,
    @CurrentActor() actor: CurrentActor,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LabClaimBody> {
    const claimId = requireClaimId(id);
    const version = parseIfMatch(ifMatch);
    const { fileId } = parseLabClaimManual(body);
    const claim = await this.claims.submitLetterhead(
      actor,
      { claimId, ifMatch: version, fileId },
      requestMeta(request),
    );
    response.setHeader('ETag', formatEtag(claim.lockVersion));
    response.setHeader('Cache-Control', 'no-store');
    return toLabClaimBody(claim);
  }
}
