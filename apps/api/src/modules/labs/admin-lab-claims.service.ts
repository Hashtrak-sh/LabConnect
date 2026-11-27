import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminLabClaimView,
  approveLabClaim,
  AuditService,
  type ClaimReviewDeps,
  type Clock,
  createLetterheadDownloadTicket,
  type CurrentActor,
  FileService,
  getLabClaimForReview,
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
  labSite: AdminLabClaimView['labSite'];
  claimant: AdminLabClaimView['claimant'];
}

/**
 * The claim as the response shows it. Exactly the contract's fields: the site (public data), the
 * claimant (name, MASKED e-mail, other organisation types), the letterhead an id (no link).
 * `lockVersion` is also the `ETag` of a single claim.
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
    labSite: {
      id: claim.labSite.id,
      siteCode: claim.labSite.siteCode,
      name: claim.labSite.name,
      city: claim.labSite.city,
      stateCode: claim.labSite.stateCode,
      certificateNos: claim.labSite.certificateNos,
    },
    claimant: {
      id: claim.claimant.id,
      fullName: claim.claimant.fullName,
      emailMasked: claim.claimant.emailMasked,
      organisationTypes: claim.claimant.organisationTypes,
    },
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

  /** `getAdminLabClaim`: one claim, in the `platform` context like the list. */
  async get(actor: CurrentActor, claimId: string): Promise<AdminLabClaimView> {
    return this.scope.run(actor, (tx) => getLabClaimForReview(tx, this.deps(), { actor, claimId }));
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

  /**
   * `createAdminLabClaimLetterheadDownloadUrl`: the checks and the audit run in one transaction;
   * the URL is made by the file service after it has committed, and is returned and nothing else:
   * never logged, stored or audited.
   */
  async letterheadDownloadUrl(
    actor: CurrentActor,
    claimId: string,
    meta: RequestMeta,
  ): Promise<{ downloadUrl: string; expiresAt: string }> {
    const { ticket } = await this.scope.run(actor, (tx) =>
      createLetterheadDownloadTicket(tx, this.deps(), { actor, claimId, meta }),
    );
    const url = await this.files.presignDownload(ticket);
    return { downloadUrl: url.downloadUrl, expiresAt: url.expiresAt.toISOString() };
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
