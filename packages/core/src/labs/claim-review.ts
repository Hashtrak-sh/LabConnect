import {
  type ClaimMethod,
  type ClaimRequestStatus,
  type OrgType,
  Prisma,
} from '@labconnect/database';
import type { CurrentActor } from '../identity/actor.js';
import type { RequestMeta } from '../identity/errors.js';
import { auditMeta } from '../identity/errors.js';
import { grantLabMembership, type LabMembershipRefusal } from '../identity/memberships.js';
import { isUuid } from '../identity/repository.js';
import type { DownloadTicket, FileService } from '../files/file-service.js';
import type { AuditActor, AuditService } from '../platform/audit.js';
import type { Clock } from '../platform/clock.js';
import type { OutboxService } from '../platform/outbox.js';
import { LabClaimError } from './claim-errors.js';
import { isStale, LETTERHEAD_LINK, LETTERHEAD_PURPOSE, maskEmail, staleCutoff } from './claims.js';

/*
 * The Ops side of the lab claim flow (FR-DAT-07): `listLabClaimsForReview`, `approveLabClaim` and
 * `rejectLabClaim` (I2-ADM-01 to I2-ADM-03). The lab side is `claims.ts`.
 *
 * Who may call: only `PLATFORM_OPS` (the contract's `x-roles`). The API guards with the permission
 * `kyc.verify` ("Verify KYC and bank, approve claims"), which the matrix also gives to
 * `PLATFORM_FINANCE` for bank verification only (note 10, OQ-112); every function here therefore
 * checks the role itself and refuses anyone else with `403 FORBIDDEN` before it reads a row.
 *
 * Database context: ONE transaction per operation in the `platform` context (`TenantScope.run`
 * for a platform actor). The policies of every table touched allow it: `lab_claim_request`
 * (`app_is_org`), `file_object` and `file_link` (`app_is_privileged`), `membership`,
 * `membership_role` and `membership_site` (`WITH CHECK` allows the platform), `app_user`
 * (privileged), and `organisation` has no policy. The `system` context is not needed. Ops acts on
 * a claim id; the organisation, site and claimant always come from the claim row, never from the
 * request.
 *
 * What the list, the one-claim read and the responses show: exactly the contract's `AdminLabClaim`.
 * It carries the claimant's user id and the letterhead's file id, the site (public data: name,
 * city, state, certificate numbers) and the claimant (full name, e-mail MASKED, the types of
 * their other organisations), and no full address, no download link. The letterhead is opened
 * only through `createLetterheadDownloadTicket` (I2-ADM-04, OQ-225).
 *
 * The 24-hour rule (OQ-206, OQ-220): a claim that is `PENDING_OTP` in the table and 24 hours old
 * or older is `EXPIRED`, whatever the row says. This code reads it that way everywhere, with the
 * constant and the cutoff of `claims.ts` (`isStale`, `staleCutoff`), and never writes the expiry
 * (a read must not write; approve and reject refuse such a claim with no write, so the lazy expiry
 * of the lab side keeps its own behaviour).
 */

/** The site of a claim for the reviewer: public data only. */
export interface AdminClaimLabSite {
  id: string;
  siteCode: string;
  name: string;
  /** From the site's address; empty when the data has none. */
  city: string;
  stateCode: string;
  /** The certificate numbers of the site's accreditations, sorted. */
  certificateNos: string[];
}

/** The claimant for the reviewer: the address masked, the other organisations by type only. */
export interface AdminClaimClaimant {
  id: string;
  fullName: string;
  emailMasked: string;
  /** Types of the active memberships OTHER than the claimed organisation, each once, sorted. */
  organisationTypes: OrgType[];
}

/** A claim as the contract's `AdminLabClaim` shows it, with `lockVersion` for the `ETag`. */
export interface AdminLabClaimView {
  id: string;
  organisationId: string;
  labSiteId: string;
  requestedByUserId: string;
  method: ClaimMethod;
  /** The effective status: a stale `PENDING_OTP` claim is `EXPIRED`. */
  status: ClaimRequestStatus;
  authorisationFileId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  decisionNotes: string | null;
  createdAt: Date;
  lockVersion: number;
  labSite: AdminClaimLabSite;
  claimant: AdminClaimClaimant;
}

/** The claim row as it is in the table with its effective status, before the site and claimant. */
export type AdminLabClaimBase = Omit<AdminLabClaimView, 'labSite' | 'claimant'>;

export interface AdminLabClaimPage {
  data: AdminLabClaimView[];
  page: { nextCursor: string | null; limit: number };
}

export interface ClaimReviewDeps {
  clock: Clock;
  audit: AuditService;
  outbox: OutboxService;
  files: FileService;
}

export const CLAIM_LIST_LIMITS = { default: 25, max: 100 } as const;

/** The reasons an approval is refused because of the claimant (`422 VALIDATION_FAILED`, `meta.reason`). */
export type ClaimApprovalRefusal =
  | 'CLAIMANT_NOT_ACTIVE'
  | 'CLAIMANT_IS_PLATFORM_STAFF'
  | 'CLAIMANT_HOLDS_LAB_ROLE'
  | 'CLAIMANT_ALREADY_MEMBER'
  | 'LETTERHEAD_MISSING';

const REFUSAL_OF: Record<LabMembershipRefusal, { reason: ClaimApprovalRefusal; detail: string }> = {
  USER_NOT_ACTIVE: {
    reason: 'CLAIMANT_NOT_ACTIVE',
    detail: 'The claimant is no longer an active user.',
  },
  USER_IS_PLATFORM_STAFF: {
    reason: 'CLAIMANT_IS_PLATFORM_STAFF',
    detail: 'The claimant is platform staff and cannot join a lab organisation.',
  },
  HOLDS_LAB_ROLE: {
    reason: 'CLAIMANT_HOLDS_LAB_ROLE',
    detail: 'The claimant already holds a lab role in an organisation.',
  },
  ALREADY_MEMBER: {
    reason: 'CLAIMANT_ALREADY_MEMBER',
    detail: 'The claimant already has a membership of this organisation.',
  },
};

function refusal(reason: ClaimApprovalRefusal, detail: string): LabClaimError {
  return new LabClaimError('VALIDATION_FAILED', { detail, meta: { reason } });
}

function conflict(currentState: string, detail: string): LabClaimError {
  return new LabClaimError('INVALID_STATE_TRANSITION', { detail, meta: { currentState } });
}

function modified(): LabClaimError {
  return new LabClaimError('CONCURRENT_MODIFICATION', {
    detail: 'The claim changed since it was read.',
  });
}

/** Only `PLATFORM_OPS`: the permission the API guards with is also held by Finance for banks. */
function requireOps(actor: CurrentActor): void {
  if (!actor.isPlatform || !actor.roles.includes('PLATFORM_OPS')) {
    throw new LabClaimError('FORBIDDEN', { detail: 'Only platform operations may review claims.' });
  }
}

function auditActor(actor: CurrentActor): AuditActor {
  return {
    userId: actor.userId,
    ...(actor.membershipId !== null && { membershipId: actor.membershipId }),
    role: 'PLATFORM_OPS',
    ...(actor.orgId !== null && { orgId: actor.orgId }),
  };
}

/** The status Ops see: a `PENDING_OTP` claim 24 hours old or older is `EXPIRED` (OQ-220). */
export function effectiveClaimStatus(
  claim: { status: ClaimRequestStatus; createdAt: Date },
  now: Date,
): ClaimRequestStatus {
  return isStale(claim, now) ? 'EXPIRED' : claim.status;
}

interface ClaimRow {
  id: string;
  organisationId: string;
  labSiteId: string;
  requestedByUserId: string;
  method: ClaimMethod;
  status: ClaimRequestStatus;
  authorisationFileId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  decisionNotes: string | null;
  createdAt: Date;
  lockVersion: number;
}

const CLAIM_SELECT = {
  id: true,
  organisationId: true,
  labSiteId: true,
  requestedByUserId: true,
  method: true,
  status: true,
  authorisationFileId: true,
  reviewedByUserId: true,
  reviewedAt: true,
  decisionNotes: true,
  createdAt: true,
  lockVersion: true,
} satisfies Prisma.LabClaimRequestSelect;

function toView(row: ClaimRow, now: Date): AdminLabClaimBase {
  return { ...row, status: effectiveClaimStatus(row, now) };
}

/**
 * Adds the site and the claimant to claims, for a whole page in FOUR queries whatever its size
 * (users, sites, certificates, memberships: one `WHERE ... = ANY(ids)` each), never one set per
 * claim. Runs in the caller's `platform` transaction, where the policies of `app_user`, `membership`
 * and the rest show everything: the claim ids come from claim rows the caller was already allowed
 * to read, and nothing from the request names a user or a site.
 *
 * Personal data goes out in the least form the reviewer needs: the e-mail is masked with
 * `maskEmail` (the function of the claimant's own view), the other organisations are types only
 * (never a name, an id or a role), and the claimed organisation is left out of them so that an
 * approved claim does not list the lab the claimant now belongs to as "another" one.
 */
export async function withSiteAndClaimant(
  tx: Prisma.TransactionClient,
  claims: readonly AdminLabClaimBase[],
): Promise<AdminLabClaimView[]> {
  if (claims.length === 0) return [];
  const userIds = [...new Set(claims.map((claim) => claim.requestedByUserId))];
  const siteIds = [...new Set(claims.map((claim) => claim.labSiteId))];

  const users = await tx.$queryRaw<{ id: string; full_name: string; email: string }[]>(Prisma.sql`
    SELECT id::text AS id, full_name, email::text AS email
      FROM app_user WHERE id = ANY(${userIds}::uuid[])`);
  const sites = await tx.$queryRaw<
    { id: string; site_code: string; name: string; city: string | null; state_code: string }[]
  >(Prisma.sql`
    SELECT id::text AS id, site_code, name, address->>'city' AS city, state_code
      FROM lab_site WHERE id = ANY(${siteIds}::uuid[])`);
  const certificates = await tx.$queryRaw<{ lab_site_id: string; certificate_no: string }[]>(
    Prisma.sql`
    SELECT DISTINCT lab_site_id::text AS lab_site_id, certificate_no
      FROM accreditation WHERE lab_site_id = ANY(${siteIds}::uuid[])`,
  );
  const memberships = await tx.$queryRaw<
    { user_id: string; organisation_id: string; org_type: OrgType }[]
  >(Prisma.sql`
    SELECT m.user_id::text AS user_id, m.organisation_id::text AS organisation_id,
           o.org_type::text AS org_type
      FROM membership m JOIN organisation o ON o.id = m.organisation_id
     WHERE m.user_id = ANY(${userIds}::uuid[]) AND m.status = 'ACTIVE'::membership_status`);

  const userOf = new Map(users.map((user) => [user.id, user]));
  const siteOf = new Map(sites.map((site) => [site.id, site]));
  return claims.map((claim) => {
    const user = userOf.get(claim.requestedByUserId);
    const site = siteOf.get(claim.labSiteId);
    if (user === undefined || site === undefined) {
      throw new Error('A claim names a user or a site that cannot be read.');
    }
    const types = new Set<OrgType>(
      memberships
        .filter(
          (member) =>
            member.user_id === claim.requestedByUserId &&
            member.organisation_id !== claim.organisationId,
        )
        .map((member) => member.org_type),
    );
    return {
      ...claim,
      labSite: {
        id: site.id,
        siteCode: site.site_code,
        name: site.name,
        city: site.city ?? '',
        stateCode: site.state_code,
        certificateNos: certificates
          .filter((row) => row.lab_site_id === claim.labSiteId)
          .map((row) => row.certificate_no)
          .sort(),
      },
      claimant: {
        id: user.id,
        fullName: user.full_name,
        emailMasked: maskEmail(user.email),
        organisationTypes: [...types].sort(),
      },
    };
  });
}

async function withSiteAndClaimantOne(
  tx: Prisma.TransactionClient,
  claim: AdminLabClaimBase,
): Promise<AdminLabClaimView> {
  const [view] = await withSiteAndClaimant(tx, [claim]);
  if (view === undefined) throw new Error('A claim lost its site or claimant.');
  return view;
}

// ------------------------------------------------------------------ list (I2-ADM-01)

interface RawClaim {
  id: string;
  organisation_id: string;
  lab_site_id: string;
  requested_by_user_id: string;
  method: ClaimMethod;
  status: ClaimRequestStatus;
  authorisation_file_id: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  decision_notes: string | null;
  created_at: Date;
  lock_version: number;
}

const STATUSES: readonly ClaimRequestStatus[] = [
  'PENDING_OTP',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
];

function unreadableCursor(): LabClaimError {
  return new LabClaimError('VALIDATION_FAILED', { detail: 'The cursor cannot be read.' });
}

/** The cursor is the id of the last claim of the page, opaque to the client. */
function encodeCursor(id: string): string {
  return Buffer.from(JSON.stringify({ i: id }), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): string {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { i?: unknown };
    if (typeof parsed.i === 'string' && isUuid(parsed.i)) return parsed.i.toLowerCase();
  } catch {
    // fall through to the error below
  }
  throw unreadableCursor();
}

/**
 * `listAdminLabClaims`: claims oldest first (`created_at`, then `id`), keyset-paged, with an
 * optional `status` filter. With no `status` every status is returned (the contract gives no
 * default; the queue screen asks for `PENDING_REVIEW` itself).
 *
 * The filter and the status shown follow the 24-hour rule: `status=PENDING_OTP` returns only
 * claims younger than 24 hours, `status=EXPIRED` returns the stored `EXPIRED` claims and the stale
 * `PENDING_OTP` ones, and a stale claim is shown as `EXPIRED`. Nothing is written.
 */
export async function listLabClaimsForReview(
  tx: Prisma.TransactionClient,
  deps: Pick<ClaimReviewDeps, 'clock'>,
  input: {
    actor: CurrentActor;
    status?: ClaimRequestStatus | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  },
): Promise<AdminLabClaimPage> {
  requireOps(input.actor);
  const limit = input.limit ?? CLAIM_LIST_LIMITS.default;
  if (!Number.isInteger(limit) || limit < 1 || limit > CLAIM_LIST_LIMITS.max) {
    throw new LabClaimError('VALIDATION_FAILED', {
      detail: `limit must be a whole number from 1 to ${String(CLAIM_LIST_LIMITS.max)}.`,
    });
  }
  if (input.status !== undefined && !STATUSES.includes(input.status)) {
    throw new LabClaimError('VALIDATION_FAILED', { detail: 'The status is not known.' });
  }
  const now = deps.clock.now();
  // The cutoff of the lab side (`staleCutoff`, the 24-hour constant): the SQL below selects by the
  // same instant `isStale` uses, so the filter and the status shown cannot disagree.
  const cutoff = staleCutoff(now);

  const afterId = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
  if (afterId !== undefined) {
    const known = await tx.labClaimRequest.findUnique({
      where: { id: afterId },
      select: { id: true },
    });
    if (known === null) throw unreadableCursor();
  }

  let statusFilter = Prisma.empty;
  if (input.status === 'PENDING_OTP') {
    statusFilter = Prisma.sql`AND status = 'PENDING_OTP'::claim_request_status AND created_at > ${cutoff}`;
  } else if (input.status === 'EXPIRED') {
    statusFilter = Prisma.sql`AND (status = 'EXPIRED'::claim_request_status
      OR (status = 'PENDING_OTP'::claim_request_status AND created_at <= ${cutoff}))`;
  } else if (input.status !== undefined) {
    statusFilter = Prisma.sql`AND status = ${input.status}::claim_request_status`;
  }
  const cursorFilter =
    afterId === undefined
      ? Prisma.empty
      : Prisma.sql`AND (created_at, id) > (SELECT created_at, id FROM lab_claim_request WHERE id = ${afterId}::uuid)`;

  const rows = await tx.$queryRaw<RawClaim[]>(Prisma.sql`
    SELECT id, organisation_id, lab_site_id, requested_by_user_id, method::text AS method,
           status::text AS status, authorisation_file_id, reviewed_by_user_id, reviewed_at,
           decision_notes, created_at, lock_version
      FROM lab_claim_request
     WHERE TRUE ${statusFilter} ${cursorFilter}
     ORDER BY created_at ASC, id ASC
     LIMIT ${limit + 1}`);

  const pageRows = rows.slice(0, limit);
  const last = pageRows[pageRows.length - 1];
  const base = pageRows.map((row) =>
    toView(
      {
        id: row.id,
        organisationId: row.organisation_id,
        labSiteId: row.lab_site_id,
        requestedByUserId: row.requested_by_user_id,
        method: row.method,
        status: row.status,
        authorisationFileId: row.authorisation_file_id,
        reviewedByUserId: row.reviewed_by_user_id,
        reviewedAt: row.reviewed_at,
        decisionNotes: row.decision_notes,
        createdAt: row.created_at,
        lockVersion: row.lock_version,
      },
      now,
    ),
  );
  return {
    data: await withSiteAndClaimant(tx, base),
    page: {
      nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last.id) : null,
      limit,
    },
  };
}

// ------------------------------------------------------------------ approve and reject

/**
 * The common start of a decision, in the order the contract's statuses are given:
 * 1. only `PLATFORM_OPS` (`403`);
 * 2. the claim exists (`404`), and its row is locked (`FOR UPDATE`) so that two decisions on one
 *    claim run one after the other and the second sees the first's result;
 * 3. it is `PENDING_REVIEW` (`409` with `meta.currentState`). `PENDING_OTP` is never decidable; a
 *    stale one is reported as `EXPIRED`, as the list shows it, and nothing is written;
 * 4. `If-Match` equals `lock_version` (`412`).
 */
async function lockedPendingReview(
  tx: Prisma.TransactionClient,
  deps: Pick<ClaimReviewDeps, 'clock'>,
  input: { actor: CurrentActor; claimId: string; ifMatch: number },
): Promise<ClaimRow> {
  requireOps(input.actor);
  if (!isUuid(input.claimId)) throw new LabClaimError('NOT_FOUND', { detail: 'No such claim.' });
  const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM lab_claim_request WHERE id = ${input.claimId}::uuid FOR UPDATE`);
  if (locked.length === 0) throw new LabClaimError('NOT_FOUND', { detail: 'No such claim.' });
  const claim = await tx.labClaimRequest.findUniqueOrThrow({
    where: { id: input.claimId },
    select: CLAIM_SELECT,
  });
  const shown = effectiveClaimStatus(claim, deps.clock.now());
  if (shown !== 'PENDING_REVIEW') {
    throw conflict(shown, 'Only a claim waiting for review can be decided.');
  }
  if (claim.lockVersion !== input.ifMatch) throw modified();
  return claim;
}

/**
 * The claim's own letterhead, or `null`: the file whose id is the claim's `authorisation_file_id`
 * AND that is tied to this claim by its live `file_link` (role `CLAIM_LETTERHEAD`), of the
 * `KYC_DOCUMENT` purpose and ownerless. The approval and the Ops read of the letterhead use this
 * one predicate, so a file that one of them accepts is the file the other would open. It does not
 * look at the scan status: the callers ask the file service (`requireClean`).
 */
export async function findClaimLetterhead(
  tx: Prisma.TransactionClient,
  claim: { id: string; authorisationFileId: string | null; requestedByUserId: string },
): Promise<{ id: string } | null> {
  if (claim.authorisationFileId === null) return null;
  return tx.fileObject.findFirst({
    where: {
      id: claim.authorisationFileId,
      purpose: LETTERHEAD_PURPOSE,
      ownerOrgId: null,
      // The claimant's own upload, as the submit requires: a file someone else uploaded is never
      // a claim's letterhead, even if a row should one day point at it.
      uploadedByUserId: claim.requestedByUserId,
      fileLinks: {
        some: {
          entityType: LETTERHEAD_LINK.entityType,
          entityId: claim.id,
          role: LETTERHEAD_LINK.role,
          removedAt: null,
        },
      },
    },
    select: { id: true },
  });
}

function cleanNotes(notes: string | undefined): string | null {
  const trimmed = notes?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}

/**
 * `approveAdminLabClaim`: `PENDING_REVIEW` to `APPROVED`, the organisation to `CLAIMED`, and the
 * claimant the organisation's first `LAB_CHECKER`, in ONE transaction. Order of the checks, each
 * refusal writing nothing (the thrown error rolls the transaction back):
 *
 * 1. to 4. as `lockedPendingReview` (`403`, `404`, `409`, `412`);
 * 5. the organisation: a conditional update (`claim_status` is `UNCLAIMED` or `CLAIM_PENDING`, an
 *    active lab) sets `CLAIMED`; no row is `409` with `meta.currentState` (`CLAIMED`, or the
 *    organisation's status). The organisation row is locked first, so two claims that end on one
 *    organisation (possible only when a start races an approval, see `startLabClaim`) are decided
 *    one after the other and the second finds it claimed: never two owners;
 * 6. a `MANUAL` claim needs its letterhead: the file of this claim, `KYC_DOCUMENT`, ownerless,
 *    linked to the claim, and `CLEAN` (`422 FILE_NOT_CLEAN`; a missing file is `422
 *    VALIDATION_FAILED`, `reason: LETTERHEAD_MISSING`);
 * 7. the claimant becomes `LAB_CHECKER` through identity's `grantLabMembership`, assigned to the
 *    site of the claim (RR-3). Refused with `422 VALIDATION_FAILED` and `meta.reason`:
 *    `CLAIMANT_NOT_ACTIVE`, `CLAIMANT_IS_PLATFORM_STAFF` (RR-5; this also stops an Ops user from
 *    approving a claim they started, if they ever became staff after starting it),
 *    `CLAIMANT_HOLDS_LAB_ROLE` (RR-2, OQ-208), `CLAIMANT_ALREADY_MEMBER`;
 * 8. the claim row: a conditional update on `status` and `lock_version` (`412` if no row);
 * 9. audit rows (`lab_claim.approve`, `organisation.claim`, `membership.create`) and the outbox
 *    event `lab_claim.approved`, ids and states only: no notes, no name, no address.
 *
 * "MFA enrolment forced" needs nothing here: `LAB_CHECKER` is an MFA-required role, so the next
 * sign-in of the claimant is a partial session until MFA is enrolled and verified, and an actor
 * built from the new membership without MFA is `401 STEP_UP_REQUIRED` (`buildCurrentActor`).
 *
 * Afterwards the organisation is `CLAIMED` and its sites are as they were (not bookable): KYC,
 * bank, pricing and the listing change are later tasks. The claimant is not told (OQ-207).
 */
export async function approveLabClaim(
  tx: Prisma.TransactionClient,
  deps: ClaimReviewDeps,
  input: {
    actor: CurrentActor;
    claimId: string;
    ifMatch: number;
    decisionNotes?: string | undefined;
    meta: RequestMeta;
  },
): Promise<AdminLabClaimView> {
  const { actor, meta } = input;
  const claim = await lockedPendingReview(tx, deps, input);
  const now = deps.clock.now();

  // 5. The organisation, locked and then changed by a conditional update.
  const lockedOrganisation = await tx.$queryRaw<{ claim_status: string }[]>(Prisma.sql`
    SELECT claim_status::text AS claim_status
      FROM organisation WHERE id = ${claim.organisationId}::uuid FOR UPDATE`);
  // What the organisation was before this approval, for the audit entry (read under the lock).
  const previousClaimStatus = lockedOrganisation[0]?.claim_status ?? 'UNKNOWN';
  const claimed = await tx.organisation.updateMany({
    where: {
      id: claim.organisationId,
      orgType: 'LAB',
      status: 'ACTIVE',
      claimStatus: { in: ['UNCLAIMED', 'CLAIM_PENDING'] },
    },
    data: { claimStatus: 'CLAIMED', lockVersion: { increment: 1 } },
  });
  if (claimed.count !== 1) {
    const organisation = await tx.organisation.findUnique({
      where: { id: claim.organisationId },
      select: { status: true, claimStatus: true },
    });
    const state =
      organisation === null
        ? 'UNKNOWN'
        : organisation.claimStatus === 'CLAIMED' || organisation.status === 'ACTIVE'
          ? organisation.claimStatus
          : organisation.status;
    throw conflict(state, 'This lab organisation cannot be claimed now.');
  }

  // 6. A manual claim needs its letterhead, clean.
  if (claim.method === 'MANUAL') {
    const file = await findClaimLetterhead(tx, claim);
    if (file === null) {
      throw refusal('LETTERHEAD_MISSING', 'A manual claim needs its letterhead file.');
    }
    await deps.files.requireClean(tx, file.id, [LETTERHEAD_PURPOSE]);
  }

  // 7. The claimant becomes the first Checker, at the site of the claim.
  const granted = await grantLabMembership(tx, {
    userId: claim.requestedByUserId,
    organisationId: claim.organisationId,
    role: 'LAB_CHECKER',
    siteIds: [claim.labSiteId],
    grantedByUserId: actor.userId,
    now,
  });
  if (!granted.ok) {
    const { reason, detail } = REFUSAL_OF[granted.reason];
    throw refusal(reason, detail);
  }

  // 8. The claim.
  const notes = cleanNotes(input.decisionNotes);
  const decided = await tx.labClaimRequest.updateMany({
    where: { id: claim.id, status: 'PENDING_REVIEW', lockVersion: claim.lockVersion },
    data: {
      status: 'APPROVED',
      reviewedByUserId: actor.userId,
      reviewedAt: now,
      decisionNotes: notes,
      lockVersion: { increment: 1 },
    },
  });
  if (decided.count !== 1) throw modified();

  // 9. Audit and event: ids and states only.
  const who = auditActor(actor);
  await deps.audit.record(tx, {
    actor: who,
    action: 'lab_claim.approve',
    entityType: 'lab_claim_request',
    entityId: claim.id,
    before: { status: 'PENDING_REVIEW' },
    after: {
      status: 'APPROVED',
      method: claim.method,
      organisationId: claim.organisationId,
      labSiteId: claim.labSiteId,
      requestedByUserId: claim.requestedByUserId,
      membershipId: granted.membershipId,
      notesRecorded: notes !== null,
    },
    ...auditMeta(meta),
  });
  await deps.audit.record(tx, {
    actor: who,
    action: 'organisation.claim',
    entityType: 'organisation',
    entityId: claim.organisationId,
    before: { claimStatus: previousClaimStatus },
    after: { claimStatus: 'CLAIMED', claimId: claim.id },
    ...auditMeta(meta),
  });
  await deps.audit.record(tx, {
    actor: who,
    action: 'membership.create',
    entityType: 'membership',
    entityId: granted.membershipId,
    after: {
      userId: claim.requestedByUserId,
      organisationId: claim.organisationId,
      role: 'LAB_CHECKER',
      siteIds: [claim.labSiteId],
      source: 'lab_claim',
      claimId: claim.id,
    },
    ...auditMeta(meta),
  });
  await deps.outbox.enqueue(tx, {
    type: 'lab_claim.approved',
    aggregate: { type: 'lab_claim_request', id: claim.id },
    actor: who,
    data: {
      claimId: claim.id,
      organisationId: claim.organisationId,
      labSiteId: claim.labSiteId,
      requestedByUserId: claim.requestedByUserId,
      membershipId: granted.membershipId,
      status: 'APPROVED',
    },
  });

  return withSiteAndClaimantOne(
    tx,
    toView(
      {
        ...claim,
        status: 'APPROVED',
        reviewedByUserId: actor.userId,
        reviewedAt: now,
        decisionNotes: notes,
        lockVersion: claim.lockVersion + 1,
      },
      now,
    ),
  );
}

/**
 * `rejectAdminLabClaim`: `PENDING_REVIEW` to `REJECTED` with the reviewer, the time and the notes
 * (required, not blank: `422 VALIDATION_FAILED`). The checks 1 to 4 are those of
 * `lockedPendingReview`; the update is conditional on `status` and `lock_version`. The
 * organisation is not touched: its open claim is gone, so `uq_lab_claim_request_pending` no longer
 * blocks and anyone, the same person included, can start a new claim. The notes are shown to the
 * claimant as `decisionNotes` of the lab-side claim; nothing else of the review (not the reviewer)
 * reaches the lab side. Audit `lab_claim.reject` and event `lab_claim.rejected`, ids and states only.
 */
export async function rejectLabClaim(
  tx: Prisma.TransactionClient,
  deps: ClaimReviewDeps,
  input: {
    actor: CurrentActor;
    claimId: string;
    ifMatch: number;
    decisionNotes: string;
    meta: RequestMeta;
  },
): Promise<AdminLabClaimView> {
  const { actor, meta } = input;
  const claim = await lockedPendingReview(tx, deps, input);
  const now = deps.clock.now();
  const notes = cleanNotes(input.decisionNotes);
  if (notes === null) {
    throw new LabClaimError('VALIDATION_FAILED', {
      detail: 'Say why the claim is rejected: the claimant is shown the notes.',
      meta: { reason: 'DECISION_NOTES_REQUIRED' },
    });
  }

  const decided = await tx.labClaimRequest.updateMany({
    where: { id: claim.id, status: 'PENDING_REVIEW', lockVersion: claim.lockVersion },
    data: {
      status: 'REJECTED',
      reviewedByUserId: actor.userId,
      reviewedAt: now,
      decisionNotes: notes,
      lockVersion: { increment: 1 },
    },
  });
  if (decided.count !== 1) throw modified();

  const who = auditActor(actor);
  await deps.audit.record(tx, {
    actor: who,
    action: 'lab_claim.reject',
    entityType: 'lab_claim_request',
    entityId: claim.id,
    before: { status: 'PENDING_REVIEW' },
    after: {
      status: 'REJECTED',
      method: claim.method,
      organisationId: claim.organisationId,
      labSiteId: claim.labSiteId,
      requestedByUserId: claim.requestedByUserId,
      notesRecorded: true,
    },
    ...auditMeta(meta),
  });
  await deps.outbox.enqueue(tx, {
    type: 'lab_claim.rejected',
    aggregate: { type: 'lab_claim_request', id: claim.id },
    actor: who,
    data: {
      claimId: claim.id,
      organisationId: claim.organisationId,
      labSiteId: claim.labSiteId,
      requestedByUserId: claim.requestedByUserId,
      status: 'REJECTED',
    },
  });

  return withSiteAndClaimantOne(
    tx,
    toView(
      {
        ...claim,
        status: 'REJECTED',
        reviewedByUserId: actor.userId,
        reviewedAt: now,
        decisionNotes: notes,
        lockVersion: claim.lockVersion + 1,
      },
      now,
    ),
  );
}

// ------------------------------------------------------------------ one claim (I2-ADM)

/**
 * `getAdminLabClaim`: one claim for review, as the list shows it, whatever its status. Checks in
 * order: only `PLATFORM_OPS` (`403`, before any row is read), the claim exists (`404`; a value
 * that is not a UUID is the same `404` here). It writes nothing and is not audited: the claimant
 * appears masked (name, masked e-mail, organisation types) and the letterhead only as an id, so
 * nothing is shown that the list does not already show; the audit document asks for an entry
 * for the opening of a document (the letterhead), not for the reading of a queue row.
 */
export async function getLabClaimForReview(
  tx: Prisma.TransactionClient,
  deps: Pick<ClaimReviewDeps, 'clock'>,
  input: { actor: CurrentActor; claimId: string },
): Promise<AdminLabClaimView> {
  requireOps(input.actor);
  if (!isUuid(input.claimId)) throw new LabClaimError('NOT_FOUND', { detail: 'No such claim.' });
  const claim = await tx.labClaimRequest.findUnique({
    where: { id: input.claimId },
    select: CLAIM_SELECT,
  });
  if (claim === null) throw new LabClaimError('NOT_FOUND', { detail: 'No such claim.' });
  return withSiteAndClaimantOne(tx, toView(claim, deps.clock.now()));
}

// ------------------------------------------------------------------ letterhead read (I2-ADM-04)

/**
 * `createAdminLabClaimLetterheadDownloadUrl`, the database part: Ops open the letterhead
 * authorisation of a claim for review (OQ-225). Returns the ticket the caller presigns with
 * `FileService.presignDownload` AFTER the transaction commits; the URL never exists inside it.
 * The caller sends a claim id and nothing else: the file is found from the claim row.
 *
 * Order of the checks, each refusal writing nothing (the thrown error rolls the transaction back):
 * 1. only `PLATFORM_OPS` (`403`), before any row is read;
 * 2. the claim exists (`404`), whatever its status: a decided claim can still be looked at;
 * 3. it has a letterhead (`404`): `findClaimLetterhead`, the predicate of the approval. A claim made
 *    by code, and a claim whose `authorisation_file_id` names a file not tied to it, have none;
 * 4. the file is `CLEAN` (`422 FILE_NOT_CLEAN` for a pending, failed, infected or rejected file):
 *    never a link to a file the scan has not passed;
 * 5. `FileService.requestDownload` (re-reads the file, writes its own `file.download_url` audit
 *    entry for the restricted purpose `KYC_DOCUMENT`);
 * 6. the audit entry `lab_claim.letterhead_download_url_created`: claim id, file id, the claim's
 *    status as it is, and (through the audit actor) the reviewer. No URL, no file name, no storage
 *    key; no outbox event (FILES_AND_REPORTS asks for none).
 *
 * The claim row is not locked and not changed: this read moves nothing.
 */
export async function createLetterheadDownloadTicket(
  tx: Prisma.TransactionClient,
  deps: Pick<ClaimReviewDeps, 'clock' | 'audit' | 'files'>,
  input: { actor: CurrentActor; claimId: string; meta: RequestMeta },
): Promise<{ ticket: DownloadTicket }> {
  const { actor, meta } = input;
  requireOps(actor);
  if (!isUuid(input.claimId)) throw new LabClaimError('NOT_FOUND', { detail: 'No such claim.' });
  const claim = await tx.labClaimRequest.findUnique({
    where: { id: input.claimId },
    select: CLAIM_SELECT,
  });
  if (claim === null) throw new LabClaimError('NOT_FOUND', { detail: 'No such claim.' });

  const file = await findClaimLetterhead(tx, claim);
  if (file === null) {
    throw new LabClaimError('NOT_FOUND', { detail: 'This claim has no letterhead.' });
  }
  await deps.files.requireClean(tx, file.id, [LETTERHEAD_PURPOSE]);

  const who = auditActor(actor);
  const ticket = await deps.files.requestDownload(tx, {
    fileId: file.id,
    actor: who,
    ...(meta.requestId === undefined ? {} : { requestId: meta.requestId }),
  });
  await deps.audit.record(tx, {
    actor: who,
    action: 'lab_claim.letterhead_download_url_created',
    entityType: 'lab_claim_request',
    entityId: claim.id,
    after: {
      claimId: claim.id,
      fileId: file.id,
      claimStatus: effectiveClaimStatus(claim, deps.clock.now()),
    },
    ...auditMeta(meta),
  });
  return { ticket };
}
