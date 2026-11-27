import { type ClaimMethod, type ClaimRequestStatus, Prisma } from '@labconnect/database';
import type { CurrentActor } from '../identity/actor.js';
import { isPlatformStaff } from '../identity/memberships.js';
import { isUuid } from '../identity/repository.js';
import type { Clock } from '../platform/clock.js';
import { LabClaimError } from './claim-errors.js';
import { claimantView, isStale, type LabClaimView, usableContactAddress } from './claims.js';

/*
 * The claimant's reads of their own claims: `listMyLabClaims` and `getLabClaim`
 * (I2-LAB, OQ-49, OQ-209). The writes are in `claims.ts`; the Ops reads are in `claim-review.ts`.
 *
 * Who may call: a signed-in user without a platform role, exactly as `startLabClaim` (platform
 * staff, by the actor and by the user row: `403 FORBIDDEN`, RR-5). Nothing about an organisation
 * is read from the actor: a claim belongs to the person who started it (`requested_by_user_id`),
 * so every active membership of the caller, or none, shows the same claims.
 *
 * Database context: ONE transaction as `system`, chosen by the caller (apps/api `LabClaimsService`),
 * for the reason the writes give: the claimant belongs to no organisation, so the policy of
 * `lab_claim_request` (`app_is_org(organisation_id)`) hides the rows from them, and so does the
 * one of `lab_site_private` (the masked address). The system context bypasses the row-level
 * policies, so the `WHERE requested_by_user_id = <the caller>` below is the ONLY thing that keeps
 * one claimant from another's claims: every query that reads a claim carries it, the cursor's
 * lookup included, and the test of this file runs the same reads in a tenant context (which the
 * policy then empties) and breaks the filter on purpose.
 *
 * Another user's claim and an unknown id are the same `404`, from the same code path (one query,
 * no second lookup that could differ in time or in text). A read writes nothing: a claim still
 * `PENDING_OTP` 24 hours after it was created is shown as `EXPIRED` (the rule and the cutoff of the
 * Ops side, `isStale`), while the row stays as it is until a write meets it. Its `lock_version`
 * is the stored one, so an `ETag` from such a read is refused by the next write with the `409`
 * of the expiry, never accepted.
 */

export const MY_CLAIM_LIST_LIMITS = { default: 25, max: 100 } as const;

export interface MyLabClaimPage {
  data: LabClaimView[];
  page: { nextCursor: string | null; limit: number };
}

interface RawOwnClaim {
  id: string;
  lab_site_id: string;
  method: ClaimMethod;
  status: ClaimRequestStatus;
  created_at: Date;
  reviewed_at: Date | null;
  decision_notes: string | null;
  lock_version: number;
}

function notFound(): LabClaimError {
  return new LabClaimError('NOT_FOUND', { detail: 'No claim with this id.' });
}

function unreadableCursor(): LabClaimError {
  return new LabClaimError('VALIDATION_FAILED', { detail: 'The cursor cannot be read.' });
}

/** Platform staff hold no lab claim: the same refusal as `startLabClaim`, before any claim is read. */
async function requireClaimant(tx: Prisma.TransactionClient, actor: CurrentActor): Promise<void> {
  if (actor.isPlatform || (await isPlatformStaff(tx, actor.userId))) {
    throw new LabClaimError('FORBIDDEN', {
      detail: 'Platform staff cannot hold a lab claim.',
    });
  }
}

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
 * The claims as the claimant sees them: the site (public data) and the masked NABL address of the
 * site, for a whole page in two queries (never one per claim), with the true status now.
 */
async function toClaimantViews(
  tx: Prisma.TransactionClient,
  clock: Clock,
  rows: readonly RawOwnClaim[],
): Promise<LabClaimView[]> {
  if (rows.length === 0) return [];
  const now = clock.now();
  const siteIds = [...new Set(rows.map((row) => row.lab_site_id))];
  const sites = await tx.labSite.findMany({
    where: { id: { in: siteIds } },
    select: { id: true, siteCode: true, name: true },
  });
  const privates = await tx.labSitePrivate.findMany({
    where: { labSiteId: { in: siteIds } },
    select: { labSiteId: true, contactEmail: true },
  });
  const siteOf = new Map(sites.map((site) => [site.id, site]));
  const addressOf = new Map(
    privates.map((row) => [row.labSiteId, usableContactAddress(row.contactEmail)]),
  );
  return rows.map((row) => {
    const site = siteOf.get(row.lab_site_id);
    if (site === undefined) throw new Error('A claim names a lab site that cannot be read.');
    const createdAt = row.created_at;
    return claimantView(
      {
        id: row.id,
        status: isStale({ status: row.status, createdAt }, now) ? 'EXPIRED' : row.status,
        method: row.method,
        createdAt,
        reviewedAt: row.reviewed_at,
        decisionNotes: row.decision_notes,
        lockVersion: row.lock_version,
      },
      site,
      addressOf.get(row.lab_site_id) ?? null,
    );
  });
}

/**
 * `listMyLabClaims`: the caller's claims, newest first (`created_at`, then `id`), keyset-paged by
 * the id of the last claim of the page. A claim created while the caller pages through is newer
 * than every cursor, so it never shifts a later page: nothing is repeated or skipped. A cursor
 * naming a claim that is not the caller's is the same `422` as one that cannot be read.
 */
export async function listMyLabClaims(
  tx: Prisma.TransactionClient,
  deps: { clock: Clock },
  input: { actor: CurrentActor; cursor?: string | undefined; limit?: number | undefined },
): Promise<MyLabClaimPage> {
  const { actor } = input;
  await requireClaimant(tx, actor);
  const userId = actor.userId;
  const limit = input.limit ?? MY_CLAIM_LIST_LIMITS.default;
  if (!Number.isInteger(limit) || limit < 1 || limit > MY_CLAIM_LIST_LIMITS.max) {
    throw new LabClaimError('VALIDATION_FAILED', {
      detail: `limit must be a whole number from 1 to ${String(MY_CLAIM_LIST_LIMITS.max)}.`,
    });
  }
  const afterId = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
  // The cursor's claim is looked up as the caller's own: another user's id finds nothing.
  const cursorFilter =
    afterId === undefined
      ? Prisma.empty
      : Prisma.sql`AND (created_at, id) < (
          SELECT created_at, id FROM lab_claim_request
           WHERE id = ${afterId}::uuid AND requested_by_user_id = ${userId}::uuid)`;
  if (afterId !== undefined) {
    const known = await tx.labClaimRequest.findFirst({
      where: { id: afterId, requestedByUserId: userId },
      select: { id: true },
    });
    if (known === null) throw unreadableCursor();
  }

  const rows = await tx.$queryRaw<RawOwnClaim[]>(Prisma.sql`
    SELECT id, lab_site_id, method::text AS method, status::text AS status, created_at,
           reviewed_at, decision_notes, lock_version
      FROM lab_claim_request
     WHERE requested_by_user_id = ${userId}::uuid ${cursorFilter}
     ORDER BY created_at DESC, id DESC
     LIMIT ${limit + 1}`);

  const pageRows = rows.slice(0, limit);
  const last = pageRows[pageRows.length - 1];
  return {
    data: await toClaimantViews(tx, deps.clock, pageRows),
    page: {
      nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last.id) : null,
      limit,
    },
  };
}

/**
 * `getLabClaim`: one claim of the caller. Anything else (another user's claim, an unknown id, a
 * value that is not a UUID) is `404 NOT_FOUND` from one lookup by id AND caller.
 */
export async function getMyLabClaim(
  tx: Prisma.TransactionClient,
  deps: { clock: Clock },
  input: { actor: CurrentActor; claimId: string },
): Promise<LabClaimView> {
  const { actor } = input;
  await requireClaimant(tx, actor);
  if (!isUuid(input.claimId)) throw notFound();
  const row = await tx.labClaimRequest.findFirst({
    where: { id: input.claimId, requestedByUserId: actor.userId },
    select: {
      id: true,
      labSiteId: true,
      method: true,
      status: true,
      createdAt: true,
      reviewedAt: true,
      decisionNotes: true,
      lockVersion: true,
    },
  });
  if (row === null) throw notFound();
  const [view] = await toClaimantViews(tx, deps.clock, [
    {
      id: row.id,
      lab_site_id: row.labSiteId,
      method: row.method,
      status: row.status,
      created_at: row.createdAt,
      reviewed_at: row.reviewedAt,
      decision_notes: row.decisionNotes,
      lock_version: row.lockVersion,
    },
  ]);
  if (view === undefined) throw notFound();
  return view;
}
