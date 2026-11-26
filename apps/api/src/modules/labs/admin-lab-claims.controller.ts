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
import { DomainError } from '../../common/domain-error.js';
import { formatEtag, parseIfMatch } from '../../common/etag.js';
import { Authorised } from '../identity/authorised.decorator.js';
import { requestMeta } from '../identity/auth.controller.js';
import { CurrentActor } from '../identity/current-actor.js';
import {
  parseClaimApproval,
  parseClaimListQuery,
  parseClaimRejection,
} from './admin-lab-claims.dto.js';
import {
  type AdminLabClaimBody,
  AdminLabClaimsService,
  toAdminLabClaimBody,
} from './admin-lab-claims.service.js';
import { requireClaimId } from './lab-claims.dto.js';

/**
 * Ops review of lab claims under `/v1/admin/claims` (API_CONTRACTS.md section 10,
 * `paths/admin-onboarding.yaml`, FR-DAT-07). Only `PLATFORM_OPS` (the contract's `x-roles`).
 *
 * The guard declares `kyc.verify` ("Verify KYC and bank, approve claims"), the only permission that
 * names claims. The matrix also gives it to `PLATFORM_FINANCE` for bank verification (note 10), so
 * the core functions refuse every role but `PLATFORM_OPS` themselves (`403 FORBIDDEN`): the three
 * operations are listed in `known-admin-differences.ts` (OQ-112). A lab or customer user, and a
 * user with no membership, do not hold the permission and are refused by the guard (OQ-135).
 *
 * `Idempotency-Key` is required by the contract and not yet honoured, as on the lab side (OQ-87):
 * a repeated approval or rejection of a decided claim is `409` by its own rule.
 */
/**
 * First thing every handler does, before any header, body or query is read: only `PLATFORM_OPS`.
 * (The guard let `PLATFORM_FINANCE` through because it holds `kyc.verify` for banks.) The core
 * functions check the same thing again.
 */
function requireOps(actor: CurrentActor): void {
  if (!actor.isPlatform || !actor.roles.includes('PLATFORM_OPS')) {
    throw new DomainError('FORBIDDEN', { detail: 'Only platform operations may review claims.' });
  }
}

@Controller('admin/claims')
export class AdminLabClaimsController {
  constructor(private readonly claims: AdminLabClaimsService) {}

  /** `listAdminLabClaims`. */
  @Get()
  @Authorised({ permission: 'kyc.verify' })
  async listAdminLabClaims(
    @Query() query: Record<string, unknown>,
    @CurrentActor() actor: CurrentActor,
    @Res({ passthrough: true }) response: Response,
  ) {
    requireOps(actor);
    response.setHeader('Cache-Control', 'no-store');
    return this.claims.list(actor, parseClaimListQuery(query));
  }

  /** `approveAdminLabClaim`. Needs `If-Match`. */
  @Post(':id/approve')
  @HttpCode(200)
  @Authorised({ permission: 'kyc.verify' })
  // TODO(I1-SHR-01): put the shared idempotency decorator here (key, user and route; OQ-87).
  async approveAdminLabClaim(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | string[] | undefined,
    @Body() body: unknown,
    @CurrentActor() actor: CurrentActor,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AdminLabClaimBody> {
    requireOps(actor);
    const claimId = requireClaimId(id);
    const version = parseIfMatch(ifMatch);
    const input = parseClaimApproval(body);
    const claim = await this.claims.approve(
      actor,
      { claimId, ifMatch: version, ...input },
      requestMeta(request),
    );
    response.setHeader('ETag', formatEtag(claim.lockVersion));
    response.setHeader('Cache-Control', 'no-store');
    return toAdminLabClaimBody(claim);
  }

  /** `rejectAdminLabClaim`. Needs `If-Match`. */
  @Post(':id/reject')
  @HttpCode(200)
  @Authorised({ permission: 'kyc.verify' })
  // TODO(I1-SHR-01): put the shared idempotency decorator here (key, user and route; OQ-87).
  async rejectAdminLabClaim(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | string[] | undefined,
    @Body() body: unknown,
    @CurrentActor() actor: CurrentActor,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AdminLabClaimBody> {
    requireOps(actor);
    const claimId = requireClaimId(id);
    const version = parseIfMatch(ifMatch);
    const input = parseClaimRejection(body);
    const claim = await this.claims.reject(
      actor,
      { claimId, ifMatch: version, ...input },
      requestMeta(request),
    );
    response.setHeader('ETag', formatEtag(claim.lockVersion));
    response.setHeader('Cache-Control', 'no-store');
    return toAdminLabClaimBody(claim);
  }
}
