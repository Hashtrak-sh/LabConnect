import { type Prisma, uuidv7 } from '@labconnect/database';
import { emailLocalPart, normaliseEmail } from './email.js';
import { auditMeta, type RequestMeta } from './errors.js';
import { hasVerifiedTotp, loadMemberships, requiresMfa } from './memberships.js';
import type { IdentityDeps } from './ports.js';
import { createSession, type IssuedSession } from './sessions.js';

export type SignInOutcome =
  /** The user is disabled. The API answers exactly as for a wrong code (OQ-35). */
  | { ok: false; reason: 'DISABLED' }
  | {
      ok: true;
      userId: string;
      userCreated: boolean;
      /** True when the session is partial: an active membership has a role that requires MFA. */
      mfaRequired: boolean;
      mfaEnrolled: boolean;
      issued: IssuedSession;
    };

/**
 * Signs a user in after their OTP was accepted: finds the user by email, creating them on
 * first sign-in (customer self-signup: `ACTIVE`, email verified, the part of the address before
 * the `@` as a placeholder name), then starts a session.
 *
 * If any active membership holds a role that requires MFA, the session is *partial* (10
 * minutes, no refresh token): the user must enrol or verify TOTP before a full session is
 * issued. Otherwise it is a full session. The session starts on the user's oldest active
 * membership, or on none if they have none yet.
 *
 * A `DISABLED` user gets no session. An `INVITED` user may sign in (the OTP proves they own
 * the address) but stays `INVITED`: accepting the invitation activates them (OQ-86).
 */
export async function signInWithVerifiedEmail(
  tx: Prisma.TransactionClient,
  deps: IdentityDeps,
  input: { email: string; meta: RequestMeta },
): Promise<SignInOutcome> {
  const now = deps.clock.now();
  const email = normaliseEmail(input.email);

  let user = await tx.appUser.findUnique({
    where: { email },
    select: { id: true, status: true, emailVerifiedAt: true },
  });
  let userCreated = false;
  if (!user) {
    // ON CONFLICT DO NOTHING: two first sign-ins of one address cannot both create the user.
    const inserted = await tx.appUser.createMany({
      data: [
        {
          id: uuidv7(now.getTime()),
          email,
          fullName: emailLocalPart(email),
          status: 'ACTIVE',
          emailVerifiedAt: now,
          lastLoginAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ],
      skipDuplicates: true,
    });
    userCreated = inserted.count === 1;
    user = await tx.appUser.findUniqueOrThrow({
      where: { email },
      select: { id: true, status: true, emailVerifiedAt: true },
    });
  }
  if (user.status === 'DISABLED') return { ok: false, reason: 'DISABLED' };

  if (!userCreated) {
    await tx.appUser.update({
      where: { id: user.id },
      data: { lastLoginAt: now, ...(user.emailVerifiedAt === null && { emailVerifiedAt: now }) },
      select: { id: true },
    });
  }

  const memberships = await loadMemberships(tx, user.id);
  const mfaRequired = requiresMfa(memberships);
  const mfaEnrolled = await hasVerifiedTotp(tx, user.id);
  const issued = await createSession(tx, deps, {
    userId: user.id,
    activeMembershipId: memberships[0]?.id ?? null,
    mfaVerifiedAt: null,
    partial: mfaRequired,
    meta: input.meta,
  });

  if (userCreated) {
    await deps.audit.record(tx, {
      actor: { userId: user.id },
      action: 'user.create',
      entityType: 'app_user',
      entityId: user.id,
      reason: 'Customer self-signup with an email OTP.',
      ...auditMeta(input.meta),
    });
  }
  await deps.audit.record(tx, {
    actor: { userId: user.id },
    action: 'auth.signin',
    entityType: 'user_session',
    entityId: issued.session.sessionId,
    after: { method: 'email_otp', mfaPending: mfaRequired },
    ...auditMeta(input.meta),
  });
  return { ok: true, userId: user.id, userCreated, mfaRequired, mfaEnrolled, issued };
}

/**
 * Turns a partial session into a full one once MFA succeeded: the partial session is revoked
 * (`MFA_COMPLETED`, so its token stops working) and a new full session starts with
 * `mfa_verified_at` set, on the same membership, for the same device.
 */
export async function completeMfaSignIn(
  tx: Prisma.TransactionClient,
  deps: IdentityDeps,
  input: {
    partial: {
      rowId: string;
      sessionId: string;
      userId: string;
      activeMembershipId: string | null;
    };
    meta: RequestMeta;
  },
): Promise<IssuedSession | null> {
  const now = deps.clock.now();
  const revoked = await tx.userSession.updateMany({
    where: { id: input.partial.rowId, revokedAt: null },
    data: { revokedAt: now, revokedReason: 'MFA_COMPLETED' },
  });
  // Another request ended this partial session first (a sign-out, say): it cannot be used now.
  // Returned, not thrown: the caller must still commit the TOTP step that was just used.
  if (revoked.count !== 1) return null;
  const issued = await createSession(tx, deps, {
    userId: input.partial.userId,
    activeMembershipId: input.partial.activeMembershipId,
    mfaVerifiedAt: now,
    partial: false,
    meta: input.meta,
  });
  await deps.audit.record(tx, {
    actor: { userId: input.partial.userId },
    action: 'auth.mfa_verified',
    entityType: 'user_session',
    entityId: issued.session.sessionId,
    after: { method: 'totp', completedSignIn: true },
    ...auditMeta(input.meta),
  });
  return issued;
}
