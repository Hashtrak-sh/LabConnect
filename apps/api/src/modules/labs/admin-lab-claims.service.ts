import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminLabClaimView,
  approveLabClaim,
  AuditService,
  type ClaimReviewDeps,
  type Clock,
  type CurrentActor,
  FileService,
  listLabClaimsForReview,
  OutboxService,
  type RequestMeta,
  rejectLabClaim,
  TenantScope,
} from '@labconnect/core';
import { CLOCK } from '../platform/platform.providers.js';
import type { ClaimListQuery } from './admin-lab-claims.dto.js';

/** `AdminLabClaim` of the contract (`components/schemas/admin-onboarding.yaml`). */
export interface AdminLabClaimBody {
  id: string;
  organisationId: string;
  labSiteId: string;
  requestedByUserId: string;
  method: AdminLabClaimView['method'];
  status: AdminLabClaimView['status'];
  authorisationFileId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  decisionNotes: string | null;
  createdAt: string;
  lockVersion: number;
}

/**
 * The claim as the response shows it. Exactly the contract's fields: the claimant is an id (no name
 * or address), the letterhead an id (no link). `lockVersion` is also the `ETag` of a single claim.
 */
export function toAdminLabClaimBody(claim: AdminLabClaimView): AdminLabClaimBody {
  return {
    id: claim.id,
    organisationId: claim.organisationId,
    labSiteId: claim.labSiteId,
    requestedByUserId: claim.requestedByUserId,
    method: claim.method,
    status: claim.status,
    authorisationFileId: claim.authorisationFileId,
    reviewedByUserId: claim.reviewedByUserId,
    reviewedAt: claim.reviewedAt?.toISOString() ?? null,
    decisionNotes: claim.decisionNotes,
    createdAt: claim.createdAt.toISOString(),
    lockVersion: claim.lockVersion,
  };
}

/**
 * The Ops claim use cases. Each opens ONE transaction as the actor (`TenantScope.run`: the
 * `platform` context for platform staff, which the policies of every table touched allow) and calls
 * the framework-free functions of `@labconnect/core`, which check that the actor is `PLATFORM_OPS`.
 * The `system` context is not used. The claim id comes from the path; the organisation, site and
 * claimant come from the claim row.
 */
@Injectable()
export class AdminLabClaimsService {
  constructor(
    private readonly scope: TenantScope,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly files: FileService,
  ) {}

  private deps(): ClaimReviewDeps {
    return { clock: this.clock, audit: this.audit, outbox: this.outbox, files: this.files };
  }

  /** `listAdminLabClaims`. */
  async list(actor: CurrentActor, query: ClaimListQuery) {
    const page = await this.scope.run(actor, (tx) =>
      listLabClaimsForReview(tx, this.deps(), { actor, ...query }),
    );
    return { data: page.data.map(toAdminLabClaimBody), page: page.page };
  }

  /** `approveAdminLabClaim`. */
  async approve(
    actor: CurrentActor,
    input: { claimId: string; ifMatch: number; decisionNotes?: string },
    meta: RequestMeta,
  ): Promise<AdminLabClaimView> {
    return this.scope.run(actor, (tx) =>
      approveLabClaim(tx, this.deps(), { actor, ...input, meta }),
    );
  }

  /** `rejectAdminLabClaim`. */
  async reject(
    actor: CurrentActor,
    input: { claimId: string; ifMatch: number; decisionNotes: string },
    meta: RequestMeta,
  ): Promise<AdminLabClaimView> {
    return this.scope.run(actor, (tx) =>
      rejectLabClaim(tx, this.deps(), { actor, ...input, meta }),
    );
  }
}
