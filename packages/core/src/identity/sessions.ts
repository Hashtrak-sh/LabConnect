import { isIP } from 'node:net';
import { type Prisma, uuidv7 } from '@labconnect/database';
import type { Clock } from '../platform/clock.js';
import { auditMeta, IdentityError, type RequestMeta } from './errors.js';
import { generateOpaqueToken, hashRefreshToken } from './hasher.js';
import { loadMemberships, type MembershipView } from './memberships.js';
import { IDENTITY_POLICY } from './policy.js';
import type { IdentityDeps } from './ports.js';

// Sessions and refresh rotation.
//
// One sign-in is a *session*, identified by `user_session.token_family_id` (the `sid` claim).
// Its refresh token rotates: each refresh retires the live row (`revoked_reason = 'ROTATED'`)
// and inserts a new live row of the same family with the new token's hash. Keeping the
// retired rows is what lets the API recognise a token that was already used: presenting
// the hash of a ROTATED row is reuse, and revokes the whole family. A session is alive when
// its family has a row that is neither revoked nor expired. `created_at` of the live row is
// carried over from the first row, so it always says when the sign-in began (the 7 day limit
// counts from there).

export const REVOKE_REASONS = {
  ROTATED: 'ROTATED',
  LOGOUT: 'LOGOUT',
  LOGOUT_ALL: 'LOGOUT_ALL',
  REFRESH_REUSE: 'REFRESH_REUSE',
  MFA_COMPLETED: 'MFA_COMPLETED',
  USER_DISABLED: 'USER_DISABLED',
} as const;

/** The live row of a session. */
export interface SessionRecord {
  /** `user_session.id` of the live row. */
  rowId: string;
  /** The session id (`token_family_id`), the `sid` claim. */
  sessionId: string;
  userId: string;
  activeMembershipId: string | null;
  /** When MFA last succeeded in this session; the step-up clock. */
  mfaVerifiedAt: Date | null;
  /** When the sign-in began. */
  startedAt: Date;
  expiresAt: Date;
}

export interface IssuedSession {
  session: SessionRecord;
  /** The clear refresh token, to put in the cookie. `null` for a partial session: it has none. */
  refreshToken: string | null;
}

function ipOf(meta: RequestMeta): string | null {
  return meta.ipAddress !== undefined && isIP(meta.ipAddress) !== 0 ? meta.ipAddress : null;
}

const sessionSelect = {
  id: true,
  tokenFamilyId: true,
  userId: true,
  activeMembershipId: true,
  mfaVerifiedAt: true,
  createdAt: true,
  expiresAt: true,
} as const;

type SessionRow = Prisma.UserSessionGetPayload<{ select: typeof sessionSelect }>;

function toRecord(row: SessionRow): SessionRecord {
  return {
    rowId: row.id,
    sessionId: row.tokenFamilyId,
    userId: row.userId,
    activeMembershipId: row.activeMembershipId,
    mfaVerifiedAt: row.mfaVerifiedAt,
    startedAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

/** The end of a full session that is refreshed at `now`: 12 hours on, but never past 7 days from the start. */
export function fullSessionExpiry(startedAt: Date, now: Date): Date {
  const idleEnd = now.getTime() + IDENTITY_POLICY.sessionIdleSeconds * 1000;
  const absoluteEnd = startedAt.getTime() + IDENTITY_POLICY.sessionAbsoluteSeconds * 1000;
  return new Date(Math.min(idleEnd, absoluteEnd));
}

export interface CreateSessionInput {
  userId: string;
  activeMembershipId: string | null;
  mfaVerifiedAt: Date | null;
  /** A session that still owes MFA: it gets no refresh token and lives 10 minutes. */
  partial: boolean;
  meta: RequestMeta;
}

/**
 * Starts a session. A partial session has no refresh token: the column is NOT NULL, so it
 * holds the hash of a random token that is thrown away, which no request can ever present.
 */
export async function createSession(
  tx: Prisma.TransactionClient,
  deps: Pick<IdentityDeps, 'clock'>,
  input: CreateSessionInput,
): Promise<IssuedSession> {
  const now = deps.clock.now();
  const token = generateOpaqueToken();
  const expiresAt = input.partial
    ? new Date(now.getTime() + IDENTITY_POLICY.partialSessionTtlSeconds * 1000)
    : fullSessionExpiry(now, now);
  const row = await tx.userSession.create({
    data: {
      id: uuidv7(now.getTime()),
      userId: input.userId,
      activeMembershipId: input.activeMembershipId,
      refreshTokenHash: hashRefreshToken(token),
      tokenFamilyId: uuidv7(now.getTime()),
      mfaVerifiedAt: input.mfaVerifiedAt,
      ipAddress: ipOf(input.meta),
      userAgent: input.meta.userAgent?.slice(0, 1000) ?? null,
      expiresAt,
      createdAt: now,
    },
    select: sessionSelect,
  });
  return { session: toRecord(row), refreshToken: input.partial ? null : token };
}

/**
 * The session behind a verified access token, or `null` if it is revoked, expired or its
 * user is disabled. Asked on every authenticated request, so a revoked session stops
 * working at once even though its access token has not expired (AuthGuard).
 */
export async function authenticateSession(
  tx: Prisma.TransactionClient,
  deps: Pick<IdentityDeps, 'clock'>,
  claims: { userId: string; sessionId: string },
): Promise<SessionRecord | null> {
  const now = deps.clock.now();
  const row = await tx.userSession.findFirst({
    where: {
      tokenFamilyId: claims.sessionId,
      userId: claims.userId,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: { ...sessionSelect, user: { select: { status: true } } },
  });
  if (!row || row.user.status === 'DISABLED') return null;
  return toRecord(row);
}

export type RefreshOutcome =
  | { ok: true; session: SessionRecord; refreshToken: string }
  | { ok: false; reason: 'UNKNOWN' | 'EXPIRED' | 'REVOKED' | 'USER_DISABLED' }
  | { ok: false; reason: 'REUSED'; sessionId: string; userId: string };

/**
 * Exchanges a refresh token for a new one. The caller commits whatever the outcome: a reused
 * token revokes its family, and that must be saved.
 *
 * - Unknown hash: `UNKNOWN`. Expired or revoked for another reason: `EXPIRED`, `REVOKED`.
 * - The hash of a row that was already rotated: `REUSED`. Someone holds a copy of a token
 *   that was spent, so every live row of the family is revoked (`REFRESH_REUSE`) and the
 *   event is audited.
 * - Otherwise the live row is retired with one conditional UPDATE (`revoked_at IS NULL`) and
 *   a new live row is inserted. Two simultaneous refreshes with the same token: the database
 *   lets exactly one UPDATE succeed; the other finds the row already retired and is treated
 *   as reuse, which also revokes the family. So **at most one of the two requests gets a
 *   token and the family is revoked right after**: both callers end up signed out, which is
 *   the cautious reading of "a token was used twice". A client must serialise its refreshes.
 */
export async function rotateRefreshToken(
  tx: Prisma.TransactionClient,
  deps: IdentityDeps,
  input: { refreshToken: string; meta: RequestMeta },
): Promise<RefreshOutcome> {
  const now = deps.clock.now();
  const row = await tx.userSession.findUnique({
    where: { refreshTokenHash: hashRefreshToken(input.refreshToken) },
    select: {
      ...sessionSelect,
      revokedAt: true,
      revokedReason: true,
      user: { select: { status: true } },
    },
  });
  if (!row) return { ok: false, reason: 'UNKNOWN' };

  if (row.revokedAt !== null) {
    if (row.revokedReason === REVOKE_REASONS.ROTATED) {
      return reuseDetected(tx, deps, toRecord(row), input.meta);
    }
    return { ok: false, reason: 'REVOKED' };
  }
  if (row.expiresAt <= now) return { ok: false, reason: 'EXPIRED' };
  if (row.user.status === 'DISABLED') {
    await revokeFamily(tx, deps, row.tokenFamilyId, REVOKE_REASONS.USER_DISABLED);
    return { ok: false, reason: 'USER_DISABLED' };
  }

  const retired = await tx.userSession.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: now, revokedReason: REVOKE_REASONS.ROTATED },
  });
  if (retired.count !== 1) return reuseDetected(tx, deps, toRecord(row), input.meta);

  const token = generateOpaqueToken();
  const next = await tx.userSession.create({
    data: {
      id: uuidv7(now.getTime()),
      userId: row.userId,
      activeMembershipId: row.activeMembershipId,
      refreshTokenHash: hashRefreshToken(token),
      tokenFamilyId: row.tokenFamilyId,
      mfaVerifiedAt: row.mfaVerifiedAt,
      ipAddress: ipOf(input.meta),
      userAgent: input.meta.userAgent?.slice(0, 1000) ?? null,
      expiresAt: fullSessionExpiry(row.createdAt, now),
      // The first row's start, so the 7 day limit keeps counting from the sign-in.
      createdAt: row.createdAt,
    },
    select: sessionSelect,
  });
  return { ok: true, session: toRecord(next), refreshToken: token };
}

async function reuseDetected(
  tx: Prisma.TransactionClient,
  deps: IdentityDeps,
  session: SessionRecord,
  meta: RequestMeta,
): Promise<RefreshOutcome> {
  await revokeFamily(tx, deps, session.sessionId, REVOKE_REASONS.REFRESH_REUSE);
  await deps.audit.record(tx, {
    actor: { userId: session.userId },
    action: 'auth.refresh_reuse_detected',
    entityType: 'user_session',
    entityId: session.sessionId,
    reason: 'A refresh token that had already been rotated was presented.',
    ...auditMeta(meta),
  });
  return { ok: false, reason: 'REUSED', sessionId: session.sessionId, userId: session.userId };
}

async function revokeFamily(
  tx: Prisma.TransactionClient,
  deps: Pick<IdentityDeps, 'clock'>,
  tokenFamilyId: string,
  reason: string,
): Promise<number> {
  const result = await tx.userSession.updateMany({
    where: { tokenFamilyId, revokedAt: null },
    data: { revokedAt: deps.clock.now(), revokedReason: reason },
  });
  return result.count;
}

/** Revokes one session (every live row of its family) and audits it. Returns whether anything was revoked. */
export async function revokeSession(
  tx: Prisma.TransactionClient,
  deps: IdentityDeps,
  input: {
    sessionId: string;
    userId: string;
    reason: (typeof REVOKE_REASONS)[keyof typeof REVOKE_REASONS];
    meta: RequestMeta;
  },
): Promise<boolean> {
  const result = await tx.userSession.updateMany({
    where: { tokenFamilyId: input.sessionId, userId: input.userId, revokedAt: null },
    data: { revokedAt: deps.clock.now(), revokedReason: input.reason },
  });
  if (result.count === 0) return false;
  await deps.audit.record(tx, {
    actor: { userId: input.userId },
    action: 'auth.session_revoke',
    entityType: 'user_session',
    entityId: input.sessionId,
    reason: input.reason,
    ...auditMeta(input.meta),
  });
  return true;
}

/** Revokes every live session of the user (sign out everywhere). Returns how many were live. */
export async function revokeAllSessions(
  tx: Prisma.TransactionClient,
  deps: IdentityDeps,
  input: { userId: string; reason: 'LOGOUT_ALL' | 'USER_DISABLED'; meta: RequestMeta },
): Promise<number> {
  const result = await tx.userSession.updateMany({
    where: { userId: input.userId, revokedAt: null },
    data: { revokedAt: deps.clock.now(), revokedReason: input.reason },
  });
  await deps.audit.record(tx, {
    actor: { userId: input.userId },
    action: 'auth.sessions_revoke_all',
    entityType: 'app_user',
    entityId: input.userId,
    after: { revokedSessions: result.count },
    reason: input.reason,
    ...auditMeta(input.meta),
  });
  return result.count;
}

/** Records a fresh MFA on the live row: the step-up clock (`mfa_verified_at`). `null` if the session is no longer live. */
export async function recordMfaVerified(
  tx: Prisma.TransactionClient,
  deps: Pick<IdentityDeps, 'clock'>,
  session: SessionRecord,
): Promise<SessionRecord | null> {
  const now = deps.clock.now();
  const result = await tx.userSession.updateMany({
    where: { id: session.rowId, revokedAt: null },
    data: { mfaVerifiedAt: now },
  });
  // Returned, not thrown, when the session was revoked meanwhile: the caller still commits.
  return result.count === 1 ? { ...session, mfaVerifiedAt: now } : null;
}

/**
 * Switches the membership a session acts as. The target must be one of the user's own active
 * memberships (found through the user's rows, not by an id from the request alone), else
 * `NOT_FOUND`. The composite foreign key (`active_membership_id`, `user_id`) backs this in
 * the database (C-06). Returns the user's memberships.
 */
export async function setActiveMembership(
  tx: Prisma.TransactionClient,
  deps: IdentityDeps,
  session: SessionRecord,
  membershipId: string,
  meta: RequestMeta,
): Promise<{ session: SessionRecord; memberships: MembershipView[] }> {
  const memberships = await loadMemberships(tx, session.userId);
  if (!memberships.some((membership) => membership.id === membershipId)) {
    throw new IdentityError('NOT_FOUND');
  }
  const result = await tx.userSession.updateMany({
    where: { id: session.rowId, revokedAt: null },
    data: { activeMembershipId: membershipId },
  });
  if (result.count !== 1) throw new IdentityError('UNAUTHENTICATED');
  await deps.audit.record(tx, {
    actor: { userId: session.userId, membershipId },
    action: 'auth.membership_switch',
    entityType: 'user_session',
    entityId: session.sessionId,
    before: { membershipId: session.activeMembershipId },
    after: { membershipId },
    ...auditMeta(meta),
  });
  return { session: { ...session, activeMembershipId: membershipId }, memberships };
}

/**
 * Step-up (FR-IAM-04): passes only if MFA succeeded in this session no more than
 * `maxAgeSeconds` ago (default 5 minutes), else throws `STEP_UP_REQUIRED` with
 * `meta.maxAgeSeconds`. A time in the future also fails. The caller reads the session from
 * the database, never from the token alone.
 */
export function assertStepUp(
  session: Pick<SessionRecord, 'mfaVerifiedAt'>,
  clock: Clock,
  maxAgeSeconds: number = IDENTITY_POLICY.stepUpMaxAgeSeconds,
): void {
  const verifiedAt = session.mfaVerifiedAt;
  const age = verifiedAt ? clock.now().getTime() - verifiedAt.getTime() : Number.POSITIVE_INFINITY;
  if (age < 0 || age > maxAgeSeconds * 1000) {
    throw new IdentityError('STEP_UP_REQUIRED', { meta: { maxAgeSeconds } });
  }
}
