import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AuditService,
  claimExpiredError,
  claimOtpFailure,
  type ClaimDeps,
  type Clock,
  type CurrentActor,
  FileService,
  findListedSiteByCertificate,
  isFilesError,
  LabClaimError,
  type LabClaimView,
  type LetterheadDeps,
  type OtpMailer,
  OutboxService,
  type RequestMeta,
  requestClaimLetterheadUpload,
  startLabClaim,
  submitLabClaimLetterhead,
  TenantScope,
  verifyLabClaimOtp,
} from '@labconnect/core';
import type { PrismaClient } from '@labconnect/database';
import { DomainError } from '../../common/domain-error.js';
import { IdentityRuntime } from '../identity/identity.runtime.js';
import { OTP_MAILER } from '../identity/otp-mailer.js';
import { CLOCK, PRISMA_CLIENT } from '../platform/platform.providers.js';

/** `LabClaim` of the contract (`components/schemas/lab-onboarding.yaml`). */
export interface LabClaimBody {
  id: string;
  status: LabClaimView['status'];
  method: LabClaimView['method'];
  labSite: { id: string; siteCode: string; name: string };
  otpSentTo: string | null;
  createdAt: string;
  reviewedAt: string | null;
  decisionNotes: string | null;
}

/** A claim as the response shows it: no lock version in the body (it is the `ETag`). */
export function toLabClaimBody(claim: LabClaimView): LabClaimBody {
  return {
    id: claim.id,
    status: claim.status,
    method: claim.method,
    labSite: claim.labSite,
    otpSentTo: claim.otpSentTo,
    createdAt: claim.createdAt.toISOString(),
    reviewedAt: claim.reviewedAt?.toISOString() ?? null,
    decisionNotes: claim.decisionNotes,
  };
}

export interface ClaimResult {
  claim: LabClaimView;
  /** `true`: 201, a new claim. `false`: 200, a new code for the open claim. */
  created: boolean;
}

/**
 * The lab claim use cases. Each is a short sequence: find the site (anonymous, public data),
 * open one transaction as `system` and call the framework-free functions of `@labconnect/core`,
 * commit, then send the code and map outcomes to catalogued errors.
 *
 * Why `system` (TENANT_ISOLATION section 3): the claimant is a signed-in user who belongs to no
 * organisation, let alone the one they claim, so the policies of `lab_claim_request` and
 * `lab_site_private` (`app_is_org`) hide those rows from them, and `otp_challenge` is readable and
 * writable by the platform or the system only. A tenant context carrying the *claimed*
 * organisation's id would be wider (it opens every table of that organisation) and would put the
 * organisation into the context from a lookup instead of from a membership. The core functions
 * scope every query by hand instead: a claim is always read with `requested_by_user_id` = the
 * caller, and the organisation is only ever the one of the site found by certificate number.
 */
@Injectable()
export class LabClaimsService {
  private readonly logger = new Logger(LabClaimsService.name);

  constructor(
    private readonly scope: TenantScope,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly runtime: IdentityRuntime,
    @Inject(OTP_MAILER) private readonly mailer: OtpMailer,
    private readonly files: FileService,
  ) {}

  private deps(): ClaimDeps {
    return {
      clock: this.clock,
      audit: this.audit,
      outbox: this.outbox,
      hasher: this.runtime.hasher,
      cipher: this.runtime.cipher,
      demoOtp: this.runtime.demoOtp,
    };
  }

  /** `startLabClaim`. */
  async start(
    actor: CurrentActor,
    input: { certificateNo: string },
    meta: RequestMeta,
  ): Promise<ClaimResult> {
    // RR-5, before anything is looked up: platform staff learn nothing about the directory here.
    if (actor.isPlatform) {
      throw new LabClaimError('FORBIDDEN', {
        detail: 'Platform staff cannot claim a lab organisation.',
      });
    }
    const site = await findListedSiteByCertificate(this.prisma, this.clock, input.certificateNo);
    if (site === null) {
      throw new DomainError('VALIDATION_FAILED', {
        detail: 'No listed lab site has this certificate number.',
        errors: [
          {
            path: 'certificateNo',
            code: 'UNKNOWN_CERTIFICATE',
            message: 'No listed lab site has this certificate number.',
          },
        ],
      });
    }

    const result = await this.scope.runAsSystem(
      'Lab claim: the claimant is no member of the organisation they claim, and otp_challenge is system-only',
      (tx) => startLabClaim(tx, this.deps(), { actor, siteId: site.siteId, meta }),
    );

    // A fixed demo code (UAT only) goes to an address that cannot receive mail: nothing to send.
    if (result.delivery !== null && result.delivery.demo !== true) {
      try {
        // After the commit, outside the outbox, the audit log and every log (OQ-65).
        await this.mailer.sendLabClaimOtp(result.delivery);
      } catch (error) {
        // The claim stays open (`PENDING_OTP`) and the caller may call this operation again for a
        // new code (200). Only the kind of failure is logged: a mail error can carry the address.
        this.logger.error(`The lab claim email could not be sent (${errorKind(error)}).`);
        throw new Error('The lab claim email could not be sent.', { cause: error });
      }
    }
    return { claim: result.claim, created: result.created };
  }

  /**
   * `verifyLabClaimOtp`. A rejected code is committed (it counts as an attempt) and then raised.
   * No platform check here: the contract documents no 403 for it, and staff cannot hold a claim
   * (they cannot start one), so the claim is simply not found for them (404).
   */
  async verify(
    actor: CurrentActor,
    input: { claimId: string; ifMatch: number; code: string },
    meta: RequestMeta,
  ): Promise<LabClaimView> {
    const outcome = await this.scope.runAsSystem(
      'Lab claim: the claimant is no member of the organisation they claim, and otp_challenge is system-only',
      (tx) => verifyLabClaimOtp(tx, this.deps(), { actor, ...input, meta }),
    );
    if (!outcome.ok) throw claimOtpFailure(outcome.reason);
    return outcome.claim;
  }

  /**
   * `createLabClaimLetterheadUploadUrl`. The row and its link to the claim commit first; the
   * presigned URL is made after the commit and is never logged or stored (it is a secret for
   * its 15 minutes). A refused type or size is `422 VALIDATION_FAILED` with the field named.
   */
  async createLetterheadUploadUrl(
    actor: CurrentActor,
    input: { claimId: string; contentType: string; sizeBytes: number; fileName?: string },
    meta: RequestMeta,
  ): Promise<FileUploadUrlBody> {
    let outcome;
    try {
      outcome = await this.scope.runAsSystem(LETTERHEAD_REASON, (tx) =>
        requestClaimLetterheadUpload(tx, this.letterheadDeps(), { actor, ...input, meta }),
      );
    } catch (error) {
      throw uploadRefusal(error) ?? error;
    }
    // A claim found stale was set to EXPIRED and that is committed; only now is the refusal raised.
    if (!outcome.ok) throw claimExpiredError();
    const url = await this.files.presignUpload(outcome.ticket);
    return {
      fileId: url.fileId,
      uploadUrl: url.uploadUrl,
      method: url.method,
      headers: url.headers,
      expiresAt: url.expiresAt.toISOString(),
    };
  }

  /** `submitLabClaimLetterhead`. */
  async submitLetterhead(
    actor: CurrentActor,
    input: { claimId: string; ifMatch: number; fileId: string },
    meta: RequestMeta,
  ): Promise<LabClaimView> {
    const outcome = await this.scope.runAsSystem(LETTERHEAD_REASON, (tx) =>
      submitLabClaimLetterhead(tx, this.letterheadDeps(), { actor, ...input, meta }),
    );
    if (!outcome.ok) throw claimExpiredError();
    return outcome.claim;
  }

  private letterheadDeps(): LetterheadDeps {
    return { ...this.deps(), files: this.files };
  }
}

const LETTERHEAD_REASON =
  'Lab claim letterhead: the claimant is no member of the organisation they claim, and the file has no owning organisation';

/** `FileUploadUrl` of the contract (`components/schemas/files.yaml`). */
export interface FileUploadUrlBody {
  fileId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

/** The file service's refusal of a type or size, as the contract's `422` with the field named. */
function uploadRefusal(error: unknown): DomainError | undefined {
  if (!isFilesError(error) || error.code !== 'VALIDATION_FAILED') return undefined;
  const sizeProblem = error.reason === 'SIZE_LIMIT_EXCEEDED';
  const path = sizeProblem ? 'sizeBytes' : 'contentType';
  return new DomainError('VALIDATION_FAILED', {
    detail: error.detail ?? 'The file is not allowed for this upload.',
    errors: [
      {
        path,
        code: sizeProblem ? 'SIZE_LIMIT_EXCEEDED' : 'CONTENT_TYPE_NOT_ALLOWED',
        message: sizeProblem
          ? 'The file is larger than the limit for a claim letterhead (10 MB).'
          : 'A claim letterhead must be a PDF, JPEG or PNG file.',
      },
    ],
  });
}

function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
