import {
  type ClaimMethod,
  type ClaimRequestStatus,
  Prisma,
  type PrismaClient,
  uuidv7,
} from '@labconnect/database';
import { type CurrentActor } from '../identity/actor.js';
import { isPlausibleEmail, normaliseEmail } from '../identity/email.js';
import { IDENTITY_POLICY } from '../identity/policy.js';
import { isPlatformStaff } from '../identity/memberships.js';
import { consumeOtp, requestOtp } from '../identity/otp.js';
import type { IdentityDeps } from '../identity/ports.js';
import type { RequestMeta } from '../identity/errors.js';
import { auditMeta } from '../identity/errors.js';
import type { FileService, UploadTicket } from '../files/file-service.js';
import { istDateKey } from '../platform/business-calendar.js';
import type { Clock } from '../platform/clock.js';
import type { OutboxService } from '../platform/outbox.js';
import { withPublicReadContext } from '../platform/public-context.js';
import { LabClaimError } from './claim-errors.js';
import { CLAIM_LIMITS } from './claim-limits.js';

/*
 * The lab claim flow (FR-DAT-07): `startLabClaim` and `verifyLabClaimOtp` (I1-LAB-01, I1-LAB-02),
 * and the letterhead route `requestClaimLetterheadUpload` and `submitLabClaimLetterhead`
 * (I1-LAB-03, I1-LAB-04). Approval, rejection and the Ops list are in `claim-review.ts` (I2-ADM-01 to 03).
 *
 * Who the code goes to, what is stored and where it may appear (CLAUDE.md section 5):
 * - the code goes only to `lab_site_private.contact_email`, imported from NABL data. Nothing in
 *   the request names an address, and the function has no parameter that could carry one;
 * - the clear code and the clear address leave `startLabClaim` once, in `delivery`, for the
 *   caller to send after the commit. They are in no audit row, outbox payload, error or log;
 * - the claim view carries the address only masked (`maskEmail`).
 *
 * Database context: every function here runs in ONE transaction as `system`, chosen by the caller
 * (apps/api `LabClaimsService`), because the claimant belongs to no organisation: the policies
 * of `lab_claim_request` and `lab_site_private` (`app_is_org(organisation_id)`) hide them from
 * a non-member, and `otp_challenge` is `platform_only`. Every query below is therefore scoped
 * by hand: a claim is always looked up by `requested_by_user_id = <the caller>`, and the
 * organisation is never taken from the request but from the site found by certificate number.
 *
 * The letterhead file (OQ-213): a `file_object` of purpose `KYC_DOCUMENT` with `owner_org_id`,
 * `customer_org_id` and `lab_org_id` all NULL. Its row-level policy then shows it to the platform
 * and the system context only, never to a member of any organisation (the claimed lab's later
 * members included), and only the system context can insert it. It is tied to its claim by a
 * `file_link` row (`lab_claim_request`, role `CLAIM_LETTERHEAD`) written in the same transaction
 * as the upload request, and every lookup of it is by id + uploader (the caller) + purpose + that link.
 *
 * Abuse limits (I1-LAB-06, `CLAIM_LIMITS`): an unverified claim expires after 24 hours, one person
 * holds at most 3 open claims, one claim may ask for at most 5 letterhead upload URLs. Expiry is
 * lazy (no timer): see `expireClaim`. The 24-hour test is on `created_at` and the injected clock.
 */

/** A claim that has not been decided yet; the partial unique index allows one per organisation. */
const OPEN: readonly ClaimRequestStatus[] = ['PENDING_OTP', 'PENDING_REVIEW'];

/** A claim of the caller as the contract's `LabClaim` shows it. */
export interface LabClaimView {
  id: string;
  status: ClaimRequestStatus;
  method: ClaimMethod;
  labSite: { id: string; siteCode: string; name: string };
  /** The NABL address the code went to, masked (`maskEmail`); `null` when the data has none. */
  otpSentTo: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  decisionNotes: string | null;
  /** `lock_version`: the API sends it as the `ETag` and checks it against `If-Match`. */
  lockVersion: number;
}

/** The code and address for the caller to send once the transaction has committed. */
export interface ClaimOtpDelivery {
  to: string;
  code: string;
  validForMinutes: number;
}

export interface StartLabClaimResult {
  claim: LabClaimView;
  /** `true`: a new claim (201). `false`: a new code for the caller's open claim (200). */
  created: boolean;
  /** `null` when the site has no usable address: no code was sent. */
  delivery: ClaimOtpDelivery | null;
}

export type VerifyLabClaimResult =
  | { ok: true; claim: LabClaimView }
  | { ok: false; reason: 'INVALID' | 'EXPIRED' | 'LOCKED' | 'CLAIM_EXPIRED' };

/**
 * Masks an address for the response: the first character of the local part and the top-level
 * domain show, nothing else, and no length is revealed (LAB_USER_FLOWS L1, contract example
 * `l***@***.in`). The top-level domain is the last label (`co.in` shows `in`). A value that is
 * not shaped like an address shows nothing.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***@***';
  const first = Array.from(email.slice(0, at))[0] ?? '*';
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const tld = dot >= 0 && dot < domain.length - 1 ? domain.slice(dot + 1).toLowerCase() : '';
  return tld === '' ? `${first}***@***` : `${first}***@***.${tld}`;
}

/**
 * The public rule of which sites are "listed" (FR-DAT-06, the same predicate as the public lab
 * directory, so a claim can name nothing a visitor cannot already see): a site that is `LISTED`
 * or `BOOKABLE` and `ACTIVE`, of an `ACTIVE` lab, with an accreditation that is `VALID`, in date
 * today (IST), `TESTING` or `CALIBRATION`, and has a scope line in force. A site with an expired
 * or not `VALID` accreditation is therefore not claimable (OQ-205).
 */
function listedAccreditationSql(today: string): Prisma.Sql {
  return Prisma.sql`
    a.status = 'VALID'
    AND a.valid_from <= ${today}::date AND a.valid_to >= ${today}::date
    AND a.lab_category IN ('TESTING', 'CALIBRATION')
    AND EXISTS (
      SELECT 1 FROM scope_line sl
       WHERE sl.accreditation_id = a.id AND sl.lab_site_id = a.lab_site_id
         AND sl.status = 'ACTIVE'
         AND (sl.effective_from IS NULL OR sl.effective_from <= ${today}::date)
         AND (sl.effective_to IS NULL OR sl.effective_to >= ${today}::date))`;
}

/**
 * Finds the listed site that holds a certificate number (FR-DAT-07), as an anonymous visitor:
 * the database hands over public data only, so this step cannot read a private column or a
 * tenant row. `null` when no listed site has it, and also when the number belongs to more than
 * one listed site (two accreditation bodies may issue the same number): the caller answers both
 * with `422 VALIDATION_FAILED`, so the answer never tells a missing, an expired and a hidden
 * certificate apart. The number is matched exactly, after trimming.
 */
export async function findListedSiteByCertificate(
  prisma: Pick<PrismaClient, '$transaction'>,
  clock: Clock,
  certificateNo: string,
): Promise<{ siteId: string } | null> {
  const wanted = certificateNo.trim();
  if (wanted === '' || wanted.length > 50) return null;
  const today = istDateKey(clock.now());
  const rows = await withPublicReadContext(prisma, (tx) =>
    tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT DISTINCT s.id
        FROM accreditation a
        JOIN lab_site s ON s.id = a.lab_site_id
        JOIN organisation o ON o.id = s.organisation_id
       WHERE a.certificate_no = ${wanted}
         AND s.listing_status IN ('LISTED', 'BOOKABLE') AND s.status = 'ACTIVE'
         AND o.org_type = 'LAB' AND o.status = 'ACTIVE'
         AND ${listedAccreditationSql(today)}
       LIMIT 2`),
  );
  const only = rows.length === 1 ? rows[0] : undefined;
  return only ? { siteId: only.id } : null;
}

export interface ClaimDeps extends IdentityDeps {
  outbox: OutboxService;
}

interface SiteInfo {
  id: string;
  siteCode: string;
  name: string;
  organisationId: string;
}

/** The address of the site from NABL data, normalised, or `null` when there is none to use. */
async function importedAddress(
  tx: Prisma.TransactionClient,
  labSiteId: string,
): Promise<string | null> {
  const row = await tx.labSitePrivate.findUnique({
    where: { labSiteId },
    select: { contactEmail: true },
  });
  const email = row?.contactEmail === null || row === null ? '' : normaliseEmail(row.contactEmail);
  return isPlausibleEmail(email) ? email : null;
}

function view(
  claim: {
    id: string;
    status: ClaimRequestStatus;
    method: ClaimMethod;
    createdAt: Date;
    reviewedAt: Date | null;
    decisionNotes: string | null;
    lockVersion: number;
  },
  site: SiteInfo,
  address: string | null,
): LabClaimView {
  return {
    id: claim.id,
    status: claim.status,
    method: claim.method,
    labSite: { id: site.id, siteCode: site.siteCode, name: site.name },
    otpSentTo: claim.method === 'EMAIL_OTP' && address !== null ? maskEmail(address) : null,
    createdAt: claim.createdAt,
    reviewedAt: claim.reviewedAt,
    decisionNotes: claim.decisionNotes,
    lockVersion: claim.lockVersion,
  };
}

function conflict(currentState: string, detail: string): LabClaimError {
  return new LabClaimError('INVALID_STATE_TRANSITION', { detail, meta: { currentState } });
}

// ------------------------------------------------------------------ expiry and limits (I1-LAB-06)

/** What the expiry needs to know about a claim. */
interface ExpiryCandidate {
  id: string;
  organisationId: string;
  labSiteId: string;
  status: ClaimRequestStatus;
  createdAt: Date;
  lockVersion: number;
}

/** A `PENDING_OTP` claim created at or before this instant is stale: `created_at <= cutoff`. */
export function staleCutoff(now: Date): Date {
  return new Date(now.getTime() - CLAIM_LIMITS.unverifiedClaimTtlMs);
}

/** Stale = `PENDING_OTP` and at least 24 hours old (at exactly 24 hours: stale). */
export function isStale(
  claim: { status: ClaimRequestStatus; createdAt: Date },
  now: Date,
): boolean {
  return claim.status === 'PENDING_OTP' && claim.createdAt.getTime() <= staleCutoff(now).getTime();
}

/**
 * Sets a stale claim to `EXPIRED` in the caller's transaction, with the same conditional update as
 * the other transitions (`status = PENDING_OTP AND lock_version = <read>`, bumping `lock_version`;
 * the row must also be stale in the database). Returns `false` when no row matched: someone else
 * changed the claim first (expired or verified it), and nothing is audited here. Audit and outbox
 * hold ids and states only. The claim may belong to another user (`startLabClaim` meets such a
 * claim on the organisation); the update is scoped by the claim id and its organisation.
 */
async function expireClaim(
  tx: Prisma.TransactionClient,
  deps: ClaimDeps,
  claim: ExpiryCandidate,
  actorUserId: string,
  meta: RequestMeta,
): Promise<boolean> {
  const changed = await tx.labClaimRequest.updateMany({
    where: {
      id: claim.id,
      organisationId: claim.organisationId,
      status: 'PENDING_OTP',
      lockVersion: claim.lockVersion,
      createdAt: { lte: staleCutoff(deps.clock.now()) },
    },
    data: { status: 'EXPIRED', lockVersion: { increment: 1 } },
  });
  if (changed.count !== 1) return false;
  const actor = { userId: actorUserId };
  await deps.audit.record(tx, {
    actor,
    action: 'lab_claim.expire',
    entityType: 'lab_claim_request',
    entityId: claim.id,
    before: { status: 'PENDING_OTP' },
    after: { status: 'EXPIRED', labSiteId: claim.labSiteId, organisationId: claim.organisationId },
    ...auditMeta(meta),
  });
  await deps.outbox.enqueue(tx, {
    type: 'lab_claim.expired',
    aggregate: { type: 'lab_claim_request', id: claim.id },
    actor,
    data: {
      claimId: claim.id,
      organisationId: claim.organisationId,
      labSiteId: claim.labSiteId,
      status: 'EXPIRED',
    },
  });
  return true;
}

/**
 * For an operation on the caller's own claim: when the claim is stale, expires it and answers
 * `true` (the caller returns the refusal `CLAIM_EXPIRED` as an outcome, so the expiry commits).
 * When another request changed the claim first, the claim is re-read: `EXPIRED` is the same
 * answer; any other state is `409` with that state (thrown: nothing was written).
 */
async function expireOwnIfStale(
  tx: Prisma.TransactionClient,
  deps: ClaimDeps,
  claim: ExpiryCandidate,
  userId: string,
  meta: RequestMeta,
): Promise<boolean> {
  if (!isStale(claim, deps.clock.now())) return false;
  if (await expireClaim(tx, deps, claim, userId, meta)) return true;
  const current = await tx.labClaimRequest.findFirst({
    where: { id: claim.id, requestedByUserId: userId },
    select: { status: true },
  });
  if (current?.status === 'EXPIRED') return true;
  throw conflict(current?.status ?? 'PENDING_OTP', 'This claim is not waiting for a code.');
}

/**
 * The outcome of an operation that found the caller's own claim stale. The expiry is committed and
 * the caller then raises `claimExpiredError()` (`409 INVALID_STATE_TRANSITION`, `currentState: EXPIRED`).
 */
export interface ClaimExpiredOutcome {
  ok: false;
  reason: 'CLAIM_EXPIRED';
}
const CLAIM_EXPIRED: ClaimExpiredOutcome = { ok: false, reason: 'CLAIM_EXPIRED' };

/** Serialises the starts of one person until the transaction ends (the open-claim cap). */
async function lockClaimant(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lab_claim_start:${userId}`}, 0))`;
}

/** A limit reached: `429 RATE_LIMITED`, with no `Retry-After` (there is no meaningful wait time). */
function limitReached(detail: string): LabClaimError {
  return new LabClaimError('RATE_LIMITED', { detail });
}

function notListed(): LabClaimError {
  return new LabClaimError('VALIDATION_FAILED', {
    detail: 'No listed lab site has this certificate number.',
  });
}

/**
 * `startLabClaim`. The caller (a signed-in user, who may have no membership at all) claims the
 * unclaimed organisation of the site `siteId`, which the API found by certificate number.
 *
 * - Platform staff are refused (`403 FORBIDDEN`, RR-5), by the actor and by the user row.
 * - The organisation already `CLAIMED`, or with an open claim of another user, is
 *   `409 INVALID_STATE_TRANSITION` with `meta.currentState` (`CLAIMED` or `CLAIM_PENDING`: it
 *   never says whose claim or how far it is). The caller's own claim already in review is `409`
 *   with `PENDING_REVIEW`.
 * - The caller's own claim awaiting its code gets a new code and is returned (`created: false`),
 *   still tied to the site it was opened with.
 * - A new claim is a row inserted `ON CONFLICT DO NOTHING` on `uq_lab_claim_request_pending`:
 *   of two users racing for one organisation the database lets exactly one in; the loser
 *   reads the winner's row and is told `409` (or, if the winner is the same user sending the
 *   request twice, gets the new code of that claim).
 * - The code is requested under the identity OTP rules (purpose `LAB_CLAIM`, context = the claim,
 *   10 minutes, 5 wrong guesses, 5 per 15 minutes per address): `429 RATE_LIMITED` rolls back
 *   the whole transaction, so a refused request leaves no claim behind.
 * - With no usable address in the NABL data nothing is sent: the claim is `MANUAL` and stays
 *   `PENDING_OTP` for the letterhead route (a later task); `delivery` is `null`.
 *
 * Limits (I1-LAB-06): a `PENDING_OTP` claim 24 hours old or older is expired first (the caller's
 * own, in any organisation, and the one on this organisation, whoever opened it), so it no longer
 * blocks and does not count; the caller's own stale claim here is replaced by a new claim, not a
 * new code. Order: platform staff, listed site, `CLAIMED`, then the advisory lock and the expiry,
 * then the open claim on the organisation (409s, or a new code for the caller's own), and only
 * when a new claim would be inserted: `429 RATE_LIMITED` if the caller already holds 3 open
 * claims. The expiry is written in this transaction, so a start that is refused afterwards (409,
 * 429, a rate-limited code) rolls it back too: nothing depends on it, because every check above
 * reads claims by their age, not by the stored status alone.
 *
 * `organisation.claim_status` is not changed here: while a claim is open the organisation stays
 * `UNCLAIMED` and the open claim row is what marks it taken (OQ-207).
 */
export async function startLabClaim(
  tx: Prisma.TransactionClient,
  deps: ClaimDeps,
  input: { actor: CurrentActor; siteId: string; meta: RequestMeta },
): Promise<StartLabClaimResult> {
  const { actor, meta } = input;
  const userId = actor.userId;
  if (actor.isPlatform || (await isPlatformStaff(tx, userId))) {
    throw new LabClaimError('FORBIDDEN', {
      detail: 'Platform staff cannot claim a lab organisation.',
    });
  }

  const found = await tx.labSite.findUnique({
    where: { id: input.siteId },
    select: {
      id: true,
      siteCode: true,
      name: true,
      organisationId: true,
      status: true,
      listingStatus: true,
      organisation: { select: { orgType: true, status: true, claimStatus: true } },
    },
  });
  if (
    found === null ||
    found.status !== 'ACTIVE' ||
    (found.listingStatus !== 'LISTED' && found.listingStatus !== 'BOOKABLE') ||
    found.organisation.orgType !== 'LAB' ||
    found.organisation.status !== 'ACTIVE'
  ) {
    throw notListed();
  }
  const organisationId = found.organisationId;
  if (found.organisation.claimStatus === 'CLAIMED') {
    throw conflict('CLAIMED', 'This lab organisation is already claimed.');
  }

  // I1-LAB-06. From here the person's starts run one after the other (advisory lock until the
  // commit), so the cap below cannot be passed by two simultaneous starts. Their own stale claims
  // (any organisation) are expired first, so old unverified claims do not use up the allowance.
  await lockClaimant(tx, userId);
  const stale = await tx.labClaimRequest.findMany({
    where: {
      requestedByUserId: userId,
      status: 'PENDING_OTP',
      createdAt: { lte: staleCutoff(deps.clock.now()) },
    },
    select: {
      id: true,
      organisationId: true,
      labSiteId: true,
      status: true,
      createdAt: true,
      lockVersion: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  for (const own of stale) await expireClaim(tx, deps, own, userId, meta);

  const openClaim = (): Promise<{
    id: string;
    organisationId: string;
    labSiteId: string;
    requestedByUserId: string;
    status: ClaimRequestStatus;
    createdAt: Date;
    lockVersion: number;
  } | null> =>
    tx.labClaimRequest.findFirst({
      where: { organisationId, status: { in: [...OPEN] } },
      select: {
        id: true,
        organisationId: true,
        labSiteId: true,
        requestedByUserId: true,
        status: true,
        createdAt: true,
        lockVersion: true,
      },
    });

  let open = await openClaim();
  if (open !== null && isStale(open, deps.clock.now())) {
    // Another person's unverified claim has outlived 24 hours: it no longer blocks. When another
    // request expired it first, the re-read below shows what is open now (maybe their new claim).
    await expireClaim(tx, deps, open, userId, meta);
    open = await openClaim();
  }
  let claimId: string;
  let created = false;
  if (open === null) {
    if (found.organisation.claimStatus !== 'UNCLAIMED') {
      throw conflict(
        found.organisation.claimStatus,
        'This lab organisation cannot be claimed now.',
      );
    }
    // The cap sits last among the checks that can refuse a new claim, right before the insert:
    // every 409 above is answered exactly as before, and a refusal here says nothing about the lab.
    const openClaims = await tx.labClaimRequest.count({
      where: {
        requestedByUserId: userId,
        OR: [
          { status: 'PENDING_REVIEW' },
          { status: 'PENDING_OTP', createdAt: { gt: staleCutoff(deps.clock.now()) } },
        ],
      },
    });
    if (openClaims >= CLAIM_LIMITS.maxOpenClaimsPerUser) {
      throw limitReached(
        'You already have the maximum number of open claims. Wait for a decision on one of them before starting another.',
      );
    }
    const address = await importedAddress(tx, found.id);
    const method: ClaimMethod = address === null ? 'MANUAL' : 'EMAIL_OTP';
    const now = deps.clock.now();
    claimId = uuidv7(now.getTime());
    const inserted = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      INSERT INTO lab_claim_request
        (id, organisation_id, lab_site_id, requested_by_user_id, method, status,
         created_at, updated_at, created_by_user_id, lock_version)
      VALUES
        (${claimId}::uuid, ${organisationId}::uuid, ${found.id}::uuid, ${userId}::uuid,
         ${method}::claim_method, 'PENDING_OTP'::claim_request_status,
         ${now}, ${now}, ${userId}::uuid, 0)
      ON CONFLICT (organisation_id)
        WHERE status IN ('PENDING_OTP'::claim_request_status, 'PENDING_REVIEW'::claim_request_status)
        DO NOTHING
      RETURNING id`);
    if (inserted.length === 1) {
      created = true;
    } else {
      // Lost the race: someone's claim is open now. Their row is visible to this statement.
      open = await openClaim();
      if (open?.requestedByUserId !== userId || open.status !== 'PENDING_OTP') {
        throw conflict('CLAIM_PENDING', 'This lab organisation already has a claim in progress.');
      }
      claimId = open.id;
    }
  } else if (open.requestedByUserId !== userId) {
    throw conflict('CLAIM_PENDING', 'This lab organisation already has a claim in progress.');
  } else if (open.status !== 'PENDING_OTP') {
    throw conflict(open.status, 'Your claim for this lab organisation is already in review.');
  } else {
    claimId = open.id;
  }

  const claim = await tx.labClaimRequest.findFirstOrThrow({
    where: { id: claimId, requestedByUserId: userId },
    select: {
      id: true,
      status: true,
      method: true,
      labSiteId: true,
      createdAt: true,
      reviewedAt: true,
      decisionNotes: true,
      lockVersion: true,
    },
  });
  const site: SiteInfo =
    claim.labSiteId === found.id
      ? found
      : await tx.labSite.findUniqueOrThrow({
          where: { id: claim.labSiteId },
          select: { id: true, siteCode: true, name: true, organisationId: true },
        });
  const address = await importedAddress(tx, claim.labSiteId);

  let delivery: ClaimOtpDelivery | null = null;
  if (claim.method === 'EMAIL_OTP' && address !== null) {
    const outcome = await requestOtp(tx, deps, {
      purpose: 'LAB_CLAIM',
      email: address,
      contextId: claim.id,
      createdByUserId: userId,
      ...(meta.ipAddress !== undefined && { ipAddress: meta.ipAddress }),
    });
    if (!outcome.ok) {
      throw new LabClaimError('RATE_LIMITED', {
        detail: 'Too many codes were sent to this lab. Try again later.',
        retryAfterSeconds: outcome.retryAfterSeconds,
      });
    }
    delivery = {
      to: address,
      code: outcome.code,
      validForMinutes: IDENTITY_POLICY.otpTtlSeconds / 60,
    };
  }

  const actorRecord = { userId };
  await deps.audit.record(tx, {
    actor: actorRecord,
    action: created ? 'lab_claim.start' : 'lab_claim.code_resend',
    entityType: 'lab_claim_request',
    entityId: claim.id,
    // Ids and states only: no address, no code.
    after: {
      status: claim.status,
      method: claim.method,
      labSiteId: claim.labSiteId,
      organisationId,
      codeSent: delivery !== null,
    },
    ...auditMeta(meta),
  });
  if (created) {
    await deps.outbox.enqueue(tx, {
      type: 'lab_claim.started',
      aggregate: { type: 'lab_claim_request', id: claim.id },
      actor: actorRecord,
      data: {
        claimId: claim.id,
        organisationId,
        labSiteId: claim.labSiteId,
        method: claim.method,
        status: claim.status,
      },
    });
  }

  return { claim: view(claim, site, address), created, delivery };
}

/**
 * `verifyLabClaimOtp`: `PENDING_OTP` to `PENDING_REVIEW` on a correct code (OQ-48: every claim
 * is reviewed by Ops, which is a later task).
 *
 * Order of the checks, each with the answer the contract gives:
 * 1. the claim must be the caller's own, else `404 NOT_FOUND` (never 403: another user's claim
 *    is indistinguishable from an unknown id);
 * 2. it must be `PENDING_OTP`, else `409 INVALID_STATE_TRANSITION` with `meta.currentState`
 *    (so a repeated verify of a verified claim is 409, whatever `If-Match` says). A `PENDING_OTP`
 *    claim 24 hours old or older is set to `EXPIRED` here and the function *returns*
 *    `{ ok: false, reason: 'CLAIM_EXPIRED' }`: the caller commits the expiry and then raises
 *    `409` with `currentState: EXPIRED` (as for a spent attempt, step 4); no code is consumed;
 * 3. `lock_version` must equal `ifMatch`, else `412 CONCURRENT_MODIFICATION`, before any attempt
 *    is spent;
 * 4. the code: a wrong, expired or locked code is *returned* so the caller commits the attempt
 *    count and then raises `claimOtpFailure(reason)`;
 * 5. the update is conditional on `status = PENDING_OTP AND lock_version = ifMatch` and bumps
 *    `lock_version` in the same statement; no row means a concurrent change, `412`, and the
 *    thrown error rolls the spent code back.
 */
export async function verifyLabClaimOtp(
  tx: Prisma.TransactionClient,
  deps: ClaimDeps,
  input: { actor: CurrentActor; claimId: string; ifMatch: number; code: string; meta: RequestMeta },
): Promise<VerifyLabClaimResult> {
  const { actor, claimId, ifMatch, meta } = input;
  const userId = actor.userId;

  const claim = await tx.labClaimRequest.findFirst({
    where: { id: claimId, requestedByUserId: userId },
    select: {
      id: true,
      organisationId: true,
      labSiteId: true,
      status: true,
      method: true,
      createdAt: true,
      reviewedAt: true,
      decisionNotes: true,
      lockVersion: true,
    },
  });
  if (claim === null) throw new LabClaimError('NOT_FOUND', { detail: 'No claim with this id.' });
  if (claim.status !== 'PENDING_OTP') {
    throw conflict(claim.status, 'This claim is not waiting for a code.');
  }
  // Part of check 2: a claim 24 hours old is `EXPIRED` now, committed with the refusal.
  if (await expireOwnIfStale(tx, deps, claim, userId, meta)) return CLAIM_EXPIRED;
  if (claim.lockVersion !== ifMatch) {
    throw new LabClaimError('CONCURRENT_MODIFICATION', {
      detail: 'The claim changed since it was read.',
    });
  }

  const consumed = await consumeOtp(tx, deps, {
    purpose: 'LAB_CLAIM',
    code: input.code,
    contextId: claim.id,
  });
  if (!consumed.ok) {
    if (consumed.reason === 'INVALID') {
      // A simultaneous correct submission may have spent the code and moved the claim on: that
      // is a state conflict, not a wrong code.
      const now = await tx.labClaimRequest.findFirst({
        where: { id: claim.id, requestedByUserId: userId },
        select: { status: true },
      });
      if (now !== null && now.status !== 'PENDING_OTP') {
        throw conflict(now.status, 'This claim is not waiting for a code.');
      }
    }
    return { ok: false, reason: consumed.reason };
  }

  const changed = await tx.labClaimRequest.updateMany({
    where: { id: claim.id, requestedByUserId: userId, status: 'PENDING_OTP', lockVersion: ifMatch },
    data: { status: 'PENDING_REVIEW', lockVersion: { increment: 1 } },
  });
  if (changed.count !== 1) {
    throw new LabClaimError('CONCURRENT_MODIFICATION', {
      detail: 'The claim changed since it was read.',
    });
  }

  const actorRecord = { userId };
  await deps.audit.record(tx, {
    actor: actorRecord,
    action: 'lab_claim.verify_otp',
    entityType: 'lab_claim_request',
    entityId: claim.id,
    before: { status: 'PENDING_OTP' },
    after: { status: 'PENDING_REVIEW', method: claim.method, labSiteId: claim.labSiteId },
    ...auditMeta(meta),
  });
  await deps.outbox.enqueue(tx, {
    type: 'lab_claim.pending_review',
    aggregate: { type: 'lab_claim_request', id: claim.id },
    actor: actorRecord,
    data: {
      claimId: claim.id,
      organisationId: claim.organisationId,
      labSiteId: claim.labSiteId,
      status: 'PENDING_REVIEW',
    },
  });

  const site = await tx.labSite.findUniqueOrThrow({
    where: { id: claim.labSiteId },
    select: { id: true, siteCode: true, name: true, organisationId: true },
  });
  const address = await importedAddress(tx, claim.labSiteId);
  return {
    ok: true,
    claim: view(
      { ...claim, status: 'PENDING_REVIEW', lockVersion: claim.lockVersion + 1 },
      site,
      address,
    ),
  };
}

// ------------------------------------------------------------------ letterhead (I1-LAB-03, I1-LAB-04)

/** What ties a file to the claim it was requested for (`file_link.entity_type` and `role`). */
export const LETTERHEAD_LINK = {
  entityType: 'lab_claim_request',
  role: 'CLAIM_LETTERHEAD',
} as const;
/** A claim letterhead is a KYC document by purpose: type and size limits of FILES_AND_REPORTS section 1. */
export const LETTERHEAD_PURPOSE = 'KYC_DOCUMENT';

export interface LetterheadDeps extends ClaimDeps {
  files: FileService;
}

/**
 * The caller's own claim, only while it waits for its code; else `404`, or `409` with the state.
 * A claim 24 hours old is expired here (committed): the answer is `CLAIM_EXPIRED`, to be returned
 * to the caller as an outcome.
 */
async function ownPendingOtpClaim(
  tx: Prisma.TransactionClient,
  deps: ClaimDeps,
  userId: string,
  claimId: string,
  meta: RequestMeta,
) {
  const claim = await tx.labClaimRequest.findFirst({
    where: { id: claimId, requestedByUserId: userId },
    select: {
      id: true,
      organisationId: true,
      labSiteId: true,
      status: true,
      method: true,
      createdAt: true,
      reviewedAt: true,
      decisionNotes: true,
      lockVersion: true,
    },
  });
  if (claim === null) throw new LabClaimError('NOT_FOUND', { detail: 'No claim with this id.' });
  if (claim.status !== 'PENDING_OTP') {
    throw conflict(claim.status, 'This claim is not waiting for a code or a letterhead.');
  }
  if (await expireOwnIfStale(tx, deps, claim, userId, meta)) return CLAIM_EXPIRED;
  return claim;
}

/**
 * `createLabClaimLetterheadUploadUrl`: records a letterhead upload for the caller's own claim and
 * returns the ticket the caller presigns after the commit (`FileService.presignUpload`).
 *
 * Allowed for every claim of the caller that is `PENDING_OTP` (and under 24 hours old), whatever
 * its method: the contract
 * calls the letterhead the fallback route and restricts only the state (OQ-214). Type and size
 * are the rules of `KYC_DOCUMENT` in the file service (`422 VALIDATION_FAILED`). The file is
 * owned by no organisation (see the header) and is linked to this claim. The number of
 * upload requests per claim is limited (OQ-217, decided 2026-11-26). The audit entry carries ids only:
 * the file name stays in `file_object.original_filename`, out of audit, outbox and logs.
 *
 * Order of the checks (I1-LAB-06): 1. the caller's own claim, else `404`; 2. `PENDING_OTP`, else
 * `409` (a claim 24 hours old is expired and *returned* as `{ ok: false, reason: 'CLAIM_EXPIRED' }`
 * so the expiry commits, then `409` with `EXPIRED`); 3. the claim row is locked (`FOR UPDATE`) so
 * that simultaneous requests for one claim run one after the other, and its state is read again;
 * 4. at most 5 `file_link` rows of role `CLAIM_LETTERHEAD` for the claim, removed links included
 * and whatever became of the files, else `429 RATE_LIMITED` (no `Retry-After`); 5. type and size
 * (`422`). A refused request writes nothing.
 */
export async function requestClaimLetterheadUpload(
  tx: Prisma.TransactionClient,
  deps: LetterheadDeps,
  input: {
    actor: CurrentActor;
    claimId: string;
    contentType: string;
    sizeBytes: number;
    fileName?: string | undefined;
    meta: RequestMeta;
  },
): Promise<{ ok: true; ticket: UploadTicket } | ClaimExpiredOutcome> {
  const userId = input.actor.userId;
  const own = await ownPendingOtpClaim(tx, deps, userId, input.claimId, input.meta);
  if ('reason' in own) return own;
  const claim = own;

  const locked = await tx.$queryRaw<{ status: ClaimRequestStatus }[]>(Prisma.sql`
    SELECT status FROM lab_claim_request
     WHERE id = ${claim.id}::uuid AND requested_by_user_id = ${userId}::uuid
       FOR UPDATE`);
  if (locked[0]?.status !== 'PENDING_OTP') {
    throw conflict(
      locked[0]?.status ?? claim.status,
      'This claim is not waiting for a code or a letterhead.',
    );
  }
  const requested = await tx.fileLink.count({
    where: {
      entityType: LETTERHEAD_LINK.entityType,
      entityId: claim.id,
      role: LETTERHEAD_LINK.role,
    },
  });
  if (requested >= CLAIM_LIMITS.maxLetterheadUploadsPerClaim) {
    throw limitReached(
      'This claim has reached the maximum number of letterhead uploads. Use one of the files already uploaded.',
    );
  }

  const ticket = await deps.files.requestUpload(tx, {
    purpose: LETTERHEAD_PURPOSE,
    ownerOrgId: null,
    declaredContentType: input.contentType,
    declaredSizeBytes: input.sizeBytes,
    fileName: input.fileName,
    uploadedByUserId: userId,
  });
  await tx.fileLink.create({
    data: {
      id: uuidv7(deps.clock.now().getTime()),
      fileId: ticket.fileId,
      entityType: LETTERHEAD_LINK.entityType,
      entityId: claim.id,
      role: LETTERHEAD_LINK.role,
      createdByUserId: userId,
    },
  });
  await deps.audit.record(tx, {
    actor: { userId },
    action: 'lab_claim.letterhead_upload_requested',
    entityType: 'lab_claim_request',
    entityId: claim.id,
    after: { fileId: ticket.fileId, purpose: LETTERHEAD_PURPOSE, sizeBytes: input.sizeBytes },
    ...auditMeta(input.meta),
  });
  return { ok: true, ticket };
}

/**
 * `submitLabClaimLetterhead`: `PENDING_OTP` to `PENDING_REVIEW` with method `MANUAL` and the file
 * as `authorisation_file_id`, for Ops to review (a later task).
 *
 * Order of the checks, each with the answer the contract gives:
 * 1. the caller's own claim, else `404`; 2. `PENDING_OTP`, else `409` with `meta.currentState`
 *    (so a claim already completed by code or letterhead is `409` whatever `If-Match` says; a claim
 *    24 hours old is expired and *returned* as `{ ok: false, reason: 'CLAIM_EXPIRED' }`, so the
 *    expiry commits, then `409` with `EXPIRED`);
 * 3. `lock_version` equals `ifMatch`, else `412`; 4. a file that this caller requested for this
 *    claim (uploader, purpose, link), else `404` (a file of another claim, user or purpose is
 *    not found, whatever its id); 5. the file is `CLEAN`, else `422 FILE_NOT_CLEAN` and the claim
 *    does not move; 6. one `UPDATE ... WHERE status = 'PENDING_OTP' AND lock_version = <If-Match>`
 *    that sets the status, method, file and `lock_version = lock_version + 1`; no row is `412`.
 * Code and letterhead use the same conditional update on the same `lock_version`, so when both
 * race for one claim exactly one wins; the loser is `409` or `412`, and a code left open for the
 * claim is refused from then on by the state check of `verifyLabClaimOtp`.
 */
export async function submitLabClaimLetterhead(
  tx: Prisma.TransactionClient,
  deps: LetterheadDeps,
  input: {
    actor: CurrentActor;
    claimId: string;
    ifMatch: number;
    fileId: string;
    meta: RequestMeta;
  },
): Promise<{ ok: true; claim: LabClaimView } | ClaimExpiredOutcome> {
  const userId = input.actor.userId;
  const own = await ownPendingOtpClaim(tx, deps, userId, input.claimId, input.meta);
  if ('reason' in own) return own;
  const claim = own;
  if (claim.lockVersion !== input.ifMatch) {
    throw new LabClaimError('CONCURRENT_MODIFICATION', {
      detail: 'The claim changed since it was read.',
    });
  }

  const file = await tx.fileObject.findFirst({
    where: {
      id: input.fileId,
      purpose: LETTERHEAD_PURPOSE,
      uploadedByUserId: userId,
      ownerOrgId: null,
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
  if (file === null) {
    throw new LabClaimError('NOT_FOUND', { detail: 'No such file of this claim.' });
  }
  // `FILE_NOT_CLEAN` (scan pending, failed, infected or rejected): the claim does not move.
  await deps.files.requireClean(tx, file.id, [LETTERHEAD_PURPOSE]);

  const changed = await tx.labClaimRequest.updateMany({
    where: {
      id: claim.id,
      requestedByUserId: userId,
      status: 'PENDING_OTP',
      lockVersion: input.ifMatch,
    },
    data: {
      status: 'PENDING_REVIEW',
      method: 'MANUAL',
      authorisationFileId: file.id,
      lockVersion: { increment: 1 },
    },
  });
  if (changed.count !== 1) {
    throw new LabClaimError('CONCURRENT_MODIFICATION', {
      detail: 'The claim changed since it was read.',
    });
  }

  const actorRecord = { userId };
  await deps.audit.record(tx, {
    actor: actorRecord,
    action: 'lab_claim.submit_letterhead',
    entityType: 'lab_claim_request',
    entityId: claim.id,
    before: { status: 'PENDING_OTP', method: claim.method },
    after: {
      status: 'PENDING_REVIEW',
      method: 'MANUAL',
      labSiteId: claim.labSiteId,
      fileId: file.id,
    },
    ...auditMeta(input.meta),
  });
  await deps.outbox.enqueue(tx, {
    type: 'lab_claim.pending_review',
    aggregate: { type: 'lab_claim_request', id: claim.id },
    actor: actorRecord,
    data: {
      claimId: claim.id,
      organisationId: claim.organisationId,
      labSiteId: claim.labSiteId,
      status: 'PENDING_REVIEW',
      method: 'MANUAL',
      fileId: file.id,
    },
  });

  const site = await tx.labSite.findUniqueOrThrow({
    where: { id: claim.labSiteId },
    select: { id: true, siteCode: true, name: true, organisationId: true },
  });
  return {
    ok: true,
    claim: view(
      { ...claim, status: 'PENDING_REVIEW', method: 'MANUAL', lockVersion: claim.lockVersion + 1 },
      site,
      null,
    ),
  };
}
