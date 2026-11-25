import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AuditService,
  authenticateSession,
  type Clock,
  completeMfaSignIn,
  confirmTotpEnrolment,
  consumeLoginOtp,
  IDENTITY_POLICY,
  IdentityError,
  type IdentityDeps,
  loadMe,
  type MeView,
  type OtpMailer,
  type RequestMeta,
  requestLoginOtp,
  recordMfaVerified,
  revokeAllSessions,
  revokeSession,
  rotateRefreshToken,
  type SessionRecord,
  setActiveMembership,
  signInWithVerifiedEmail,
  startTotpEnrolment,
  verifyUserTotp,
  type TotpEnrolment,
} from '@labconnect/core';
import { type Prisma, type PrismaClient, withDbContext } from '@labconnect/database';
import { CLOCK, PRISMA_CLIENT } from '../platform/platform.providers.js';
import { IdentityRuntime } from './identity.runtime.js';
import { OTP_MAILER } from './smtp-otp-mailer.js';

/** The session behind a verified access token. */
export interface AuthenticatedSession extends SessionRecord {
  /** The token is a partial (pre-MFA) one: it may call only `/auth/mfa/*` and `/auth/logout`. */
  partial: boolean;
}

/** `Session` of the contract. */
export interface SessionBody {
  mfaRequired: false;
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

/** `MfaChallenge` of the contract. */
export interface MfaChallengeBody {
  mfaRequired: true;
  mfaEnrolled: boolean;
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

/** A refresh token to put in the cookie, and how long the cookie lives. */
export interface RefreshCookie {
  token: string;
  maxAgeSeconds: number;
}

export interface SessionResult {
  body: SessionBody;
  refresh?: RefreshCookie;
}

export interface VerifyOtpResult {
  body: SessionBody | MfaChallengeBody;
  refresh?: RefreshCookie;
}

/**
 * The identity use cases. Each one is a short sequence: open a transaction under the right
 * database context, call the framework-free functions of `@labconnect/core`, commit, then
 * sign tokens and map outcomes to catalogued errors. Failures that must be saved (a wrong
 * code counts as an attempt) come back as outcomes, the transaction commits, and only then
 * is the error raised.
 *
 * Database contexts (TENANT_ISOLATION.md section 3, ADR-020): before a user is known (OTP,
 * sign-in, refresh, the token lookup of the guard) the work runs as `system`, the context
 * the schema names for this ("finding a session by its token"). Once the access token has
 * identified the user, it runs as that user alone, with no organisation, so the policies
 * on `user_session`, `mfa_factor` and `membership` apply.
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly runtime: IdentityRuntime,
    @Inject(OTP_MAILER) private readonly mailer: OtpMailer,
  ) {}

  private deps(): IdentityDeps {
    return {
      clock: this.clock,
      audit: this.audit,
      hasher: this.runtime.hasher,
      cipher: this.runtime.cipher,
    };
  }

  private asSystem<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return withDbContext(this.prisma, { kind: 'system' }, work);
  }

  private asUser<T>(
    userId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return withDbContext(this.prisma, { kind: 'tenant', orgId: '', userId }, work);
  }

  // ---------------------------------------------------------------- sign-in

  /** `requestOtp`. The answer never depends on whether the address has an account. */
  async requestOtp(input: { email: string }, meta: RequestMeta): Promise<void> {
    const outcome = await this.asSystem((tx) =>
      requestLoginOtp(tx, this.deps(), {
        email: input.email,
        ...(meta.ipAddress !== undefined && { ipAddress: meta.ipAddress }),
      }),
    );
    if (!outcome.ok) {
      throw new IdentityError('RATE_LIMITED', { retryAfterSeconds: outcome.retryAfterSeconds });
    }
    try {
      // After the commit, outside the outbox, the audit log and every log (OQ-65).
      await this.mailer.sendLoginOtp({
        to: input.email,
        code: outcome.code,
        validForMinutes: IDENTITY_POLICY.otpTtlSeconds / 60,
      });
    } catch (error) {
      // Only the kind of failure: a mail error can carry the address, and must not carry the code.
      this.logger.error(`The sign-in email could not be sent (${errorKind(error)}).`);
      throw new Error('The sign-in email could not be sent.', { cause: error });
    }
  }

  /** `verifyOtp`: a full session, or the partial session of a user who still owes MFA. */
  async verifyOtp(
    input: { email: string; code: string },
    meta: RequestMeta,
  ): Promise<VerifyOtpResult> {
    const deps = this.deps();
    const outcome = await this.asSystem(async (tx) => {
      const consumed = await consumeLoginOtp(tx, deps, input);
      if (!consumed.ok) return { signedIn: false as const, reason: consumed.reason };
      const signIn = await signInWithVerifiedEmail(tx, deps, { email: input.email, meta });
      // A disabled user is answered exactly like a wrong code (OQ-35).
      if (!signIn.ok) return { signedIn: false as const, reason: 'INVALID' as const };
      return { signedIn: true as const, signIn };
    });
    if (!outcome.signedIn) throw otpFailure(outcome.reason);

    const { signIn } = outcome;
    const { session, refreshToken } = signIn.issued;
    if (signIn.mfaRequired) {
      const { token, expiresIn } = await this.runtime.tokens.sign({
        userId: signIn.userId,
        sessionId: session.sessionId,
        amr: ['otp'],
        partial: true,
      });
      return {
        body: {
          mfaRequired: true,
          mfaEnrolled: signIn.mfaEnrolled,
          accessToken: token,
          tokenType: 'Bearer',
          expiresIn,
        },
      };
    }
    return this.fullSession(session, refreshToken);
  }

  // ---------------------------------------------------------------- MFA

  /**
   * `verifyMfa`. With a partial session it completes the sign-in (a new full session, the
   * partial one is revoked). With a full session it is a step-up: `mfa_verified_at` is set to
   * now and a new access token carries it.
   */
  async verifyMfa(
    session: AuthenticatedSession,
    input: { code: string },
    meta: RequestMeta,
  ): Promise<SessionResult> {
    const deps = this.deps();
    const outcome = await this.asUser(session.userId, async (tx) => {
      const check = await verifyUserTotp(tx, deps, {
        userId: session.userId,
        code: input.code,
        meta,
      });
      if (!check.ok) return { kind: 'failed' as const, check };
      if (session.partial) {
        const issued = await completeMfaSignIn(tx, deps, { partial: session, meta });
        return issued ? { kind: 'signed-in' as const, issued } : { kind: 'revoked' as const };
      }
      const updated = await recordMfaVerified(tx, deps, session);
      return updated
        ? { kind: 'stepped-up' as const, session: updated }
        : { kind: 'revoked' as const };
    });

    switch (outcome.kind) {
      case 'failed':
        throw mfaFailure(outcome.check);
      case 'revoked':
        throw new IdentityError('UNAUTHENTICATED');
      case 'signed-in':
        return this.fullSession(outcome.issued.session, outcome.issued.refreshToken);
      case 'stepped-up':
        return this.fullSession(outcome.session, null);
    }
  }

  /** `startMfaEnrolment`: the secret and URI of a new pending factor. */
  startMfaEnrolment(session: AuthenticatedSession, meta: RequestMeta): Promise<TotpEnrolment> {
    return this.asUser(session.userId, (tx) =>
      startTotpEnrolment(tx, this.deps(), { userId: session.userId, meta }),
    );
  }

  /** `confirmMfaEnrolment`: activates the factor and returns the recovery codes, once. */
  async confirmMfaEnrolment(
    session: AuthenticatedSession,
    input: { code: string },
    meta: RequestMeta,
  ): Promise<{ recoveryCodes: string[] }> {
    const outcome = await this.asUser(session.userId, (tx) =>
      confirmTotpEnrolment(tx, this.deps(), { userId: session.userId, code: input.code, meta }),
    );
    if (!outcome.ok) throw mfaFailure(outcome);
    return { recoveryCodes: outcome.recoveryCodes };
  }

  // ---------------------------------------------------------------- sessions

  /** `refreshSession`: rotates the refresh token. Any failure is `UNAUTHENTICATED`. */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<SessionResult> {
    const outcome = await this.asSystem((tx) =>
      rotateRefreshToken(tx, this.deps(), { refreshToken, meta }),
    );
    if (!outcome.ok) throw new IdentityError('UNAUTHENTICATED');
    return this.fullSession(outcome.session, outcome.refreshToken);
  }

  async logout(session: AuthenticatedSession, meta: RequestMeta): Promise<void> {
    await this.asUser(session.userId, (tx) =>
      revokeSession(tx, this.deps(), {
        sessionId: session.sessionId,
        userId: session.userId,
        reason: 'LOGOUT',
        meta,
      }),
    );
  }

  async logoutAll(session: AuthenticatedSession, meta: RequestMeta): Promise<void> {
    await this.asUser(session.userId, (tx) =>
      revokeAllSessions(tx, this.deps(), { userId: session.userId, reason: 'LOGOUT_ALL', meta }),
    );
  }

  /**
   * The session behind an access token, checked against the database on every call: a
   * revoked, expired or disabled-user session is `UNAUTHENTICATED` although the token itself
   * has not expired.
   */
  async authenticate(accessToken: string): Promise<AuthenticatedSession> {
    const claims = await this.runtime.tokens.verify(accessToken);
    const record = await this.asSystem((tx) =>
      authenticateSession(tx, { clock: this.clock }, claims),
    );
    if (!record) throw new IdentityError('UNAUTHENTICATED');
    return { ...record, partial: claims.partial };
  }

  // ---------------------------------------------------------------- /me

  getMe(session: AuthenticatedSession, requestedMembershipId?: string): Promise<MeView> {
    return this.asUser(session.userId, (tx) =>
      loadMe(tx, {
        userId: session.userId,
        sessionMembershipId: session.activeMembershipId,
        ...(requestedMembershipId !== undefined && { requestedMembershipId }),
      }),
    );
  }

  setActiveMembership(
    session: AuthenticatedSession,
    membershipId: string,
    meta: RequestMeta,
  ): Promise<MeView> {
    return this.asUser(session.userId, async (tx) => {
      await setActiveMembership(tx, this.deps(), session, membershipId, meta);
      return loadMe(tx, {
        userId: session.userId,
        sessionMembershipId: membershipId,
      });
    });
  }

  // ---------------------------------------------------------------- tokens

  /** An access token for a full session and, when a refresh token was issued, its cookie. */
  private async fullSession(
    session: SessionRecord,
    refreshToken: string | null,
  ): Promise<SessionResult> {
    const { token, expiresIn } = await this.runtime.tokens.sign({
      userId: session.userId,
      sessionId: session.sessionId,
      amr: session.mfaVerifiedAt ? ['otp', 'totp'] : ['otp'],
      mfaAt: session.mfaVerifiedAt,
      partial: false,
    });
    const body: SessionBody = {
      mfaRequired: false,
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn,
    };
    if (refreshToken === null) return { body };
    const maxAgeSeconds = Math.max(
      1,
      Math.floor((session.expiresAt.getTime() - this.clock.now().getTime()) / 1000),
    );
    return { body, refresh: { token: refreshToken, maxAgeSeconds } };
  }
}

function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function otpFailure(reason: 'INVALID' | 'EXPIRED' | 'LOCKED'): IdentityError {
  if (reason === 'EXPIRED')
    return new IdentityError('OTP_EXPIRED', { detail: 'The code has expired.' });
  if (reason === 'LOCKED') {
    return new IdentityError('OTP_LOCKED', {
      detail: 'Too many wrong codes. Ask for a new code.',
      retryAfterSeconds: IDENTITY_POLICY.otpTtlSeconds,
    });
  }
  return new IdentityError('OTP_INVALID', { detail: 'The code is not valid.' });
}

function mfaFailure(
  outcome:
    | { reason: 'NOT_ENROLLED' }
    | { reason: 'INVALID' }
    | { reason: 'LOCKED'; retryAfterSeconds: number },
): IdentityError {
  switch (outcome.reason) {
    case 'NOT_ENROLLED':
      return new IdentityError('MFA_ENROLMENT_REQUIRED', {
        detail: 'Set up an authenticator app first.',
      });
    case 'LOCKED':
      return new IdentityError('OTP_LOCKED', {
        detail: 'Too many wrong codes. Try again later.',
        retryAfterSeconds: outcome.retryAfterSeconds,
      });
    case 'INVALID':
      return new IdentityError('OTP_INVALID', { detail: 'The code is not valid.' });
  }
}
