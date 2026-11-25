import { type Prisma, uuidv7 } from '@labconnect/database';
import { auditMeta, IdentityError, type RequestMeta } from './errors.js';
import { generateRecoveryCode } from './hasher.js';
import { IDENTITY_POLICY } from './policy.js';
import type { IdentityDeps } from './ports.js';
import { base32Encode, generateTotpSecret, matchTotp, otpauthUri } from './totp.js';

/** The associated data that ties an encrypted TOTP secret to its row. */
const secretContext = (factorId: string): string => `mfa_factor:${factorId}`;

export interface TotpEnrolment {
  /** The secret in base32, for manual entry. Returned once and never stored in clear. */
  secret: string;
  otpauthUri: string;
}

/**
 * Creates a pending TOTP factor and returns its secret (once). The secret is encrypted before
 * it is stored. A user who has a verified factor gets `INVALID_STATE_TRANSITION`: replacing a
 * factor is an MFA reset, which only a `PLATFORM_ADMIN` does. A pending factor from an earlier
 * attempt is revoked, so there is one pending factor at a time.
 */
export async function startTotpEnrolment(
  tx: Prisma.TransactionClient,
  deps: IdentityDeps,
  input: { userId: string; meta: RequestMeta },
): Promise<TotpEnrolment> {
  const now = deps.clock.now();
  const user = await tx.appUser.findUniqueOrThrow({
    where: { id: input.userId },
    select: { email: true },
  });
  const verified = await tx.mfaFactor.findFirst({
    where: { userId: input.userId, factorType: 'TOTP', verifiedAt: { not: null }, revokedAt: null },
    select: { id: true },
  });
  if (verified) {
    throw new IdentityError('INVALID_STATE_TRANSITION', {
      detail: 'MFA is already set up. Ask a platform administrator to reset it.',
    });
  }
  await tx.mfaFactor.updateMany({
    where: { userId: input.userId, factorType: 'TOTP', verifiedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });

  const secret = generateTotpSecret();
  const id = uuidv7(now.getTime());
  await tx.mfaFactor.create({
    data: {
      id,
      userId: input.userId,
      factorType: 'TOTP',
      secretCiphertext: await deps.cipher.encrypt(secret, secretContext(id)),
      createdAt: now,
    },
    select: { id: true },
  });
  await deps.audit.record(tx, {
    actor: { userId: input.userId },
    action: 'auth.mfa_enrol_started',
    entityType: 'mfa_factor',
    entityId: id,
    ...auditMeta(input.meta),
  });
  const secretBase32 = base32Encode(secret);
  return { secret: secretBase32, otpauthUri: otpauthUri(user.email, secretBase32) };
}

export type TotpCheckOutcome =
  | { ok: true; step: number }
  | { ok: false; reason: 'INVALID' }
  | { ok: false; reason: 'LOCKED'; retryAfterSeconds: number };

interface FactorRow {
  id: string;
  secretCiphertext: Uint8Array;
  lastUsedStep: bigint | null;
  failedAttempts: number;
  lockedUntil: Date | null;
}

/**
 * Checks a TOTP code against one factor: lockout, then the code in a window of one step
 * either side, then replay protection.
 *
 * - A locked factor refuses every code, right or wrong, until `locked_until`.
 * - A step at or before `last_used_step` never matches again (RFC 6238 section 5.2).
 * - A match records its step with one conditional UPDATE (`last_used_step` still lower), so
 *   two simultaneous submissions of one code cannot both succeed.
 * - A wrong code adds to `failed_attempts`; the fifth in a row locks the factor for 15
 *   minutes. A right code clears the count.
 *
 * The caller commits whatever the outcome: counting a failure must be saved.
 */
async function checkTotp(
  tx: Prisma.TransactionClient,
  deps: IdentityDeps,
  factor: FactorRow,
  userId: string,
  code: string,
  meta: RequestMeta,
): Promise<TotpCheckOutcome> {
  const now = deps.clock.now();
  if (factor.lockedUntil !== null) {
    if (factor.lockedUntil > now) {
      return {
        ok: false,
        reason: 'LOCKED',
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((factor.lockedUntil.getTime() - now.getTime()) / 1000),
        ),
      };
    }
    // The lock has run out: start counting again.
    await tx.mfaFactor.update({
      where: { id: factor.id },
      data: { failedAttempts: 0, lockedUntil: null },
      select: { id: true },
    });
  }

  const secret = await deps.cipher.decrypt(factor.secretCiphertext, secretContext(factor.id));
  const step = matchTotp(secret, code, now.getTime(), {
    afterStep: factor.lastUsedStep === null ? null : Number(factor.lastUsedStep),
  });

  if (step !== null) {
    const spent = await tx.mfaFactor.updateMany({
      where: {
        id: factor.id,
        OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(step) } }],
      },
      data: { lastUsedStep: BigInt(step), failedAttempts: 0, lockedUntil: null },
    });
    if (spent.count === 1) return { ok: true, step };
    // The same step was accepted by another request in the meantime: that is a replay.
  }

  const updated = await tx.mfaFactor.update({
    where: { id: factor.id },
    data: { failedAttempts: { increment: 1 } },
    select: { failedAttempts: true },
  });
  if (updated.failedAttempts >= IDENTITY_POLICY.mfaMaxFailedAttempts) {
    const lockedUntil = new Date(now.getTime() + IDENTITY_POLICY.mfaLockSeconds * 1000);
    await tx.mfaFactor.update({
      where: { id: factor.id },
      data: { lockedUntil },
      select: { id: true },
    });
    await deps.audit.record(tx, {
      actor: { userId },
      action: 'auth.mfa_locked',
      entityType: 'mfa_factor',
      entityId: factor.id,
      reason: 'Too many wrong TOTP codes.',
      ...auditMeta(meta),
    });
    return { ok: false, reason: 'LOCKED', retryAfterSeconds: IDENTITY_POLICY.mfaLockSeconds };
  }
  return { ok: false, reason: 'INVALID' };
}

export type ConfirmEnrolmentOutcome =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; reason: 'INVALID' }
  | { ok: false; reason: 'LOCKED'; retryAfterSeconds: number };

/**
 * Activates the pending factor with a first code and creates the 10 recovery codes, returned
 * once; only their HMACs are stored. Throws `NOT_FOUND` if there is no pending factor. The
 * code's time step is recorded like any other, so the sign-in that follows needs a *new* code.
 * Earlier unused recovery codes of the user (from a factor that was reset) are retired.
 */
export async function confirmTotpEnrolment(
  tx: Prisma.TransactionClient,
  deps: IdentityDeps,
  input: { userId: string; code: string; meta: RequestMeta },
): Promise<ConfirmEnrolmentOutcome> {
  const now = deps.clock.now();
  const pending = await tx.mfaFactor.findFirst({
    where: { userId: input.userId, factorType: 'TOTP', verifiedAt: null, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      secretCiphertext: true,
      lastUsedStep: true,
      failedAttempts: true,
      lockedUntil: true,
    },
  });
  if (!pending)
    throw new IdentityError('NOT_FOUND', { detail: 'There is no MFA set-up to confirm.' });

  const outcome = await checkTotp(tx, deps, pending, input.userId, input.code, input.meta);
  if (!outcome.ok) return outcome;

  const activated = await tx.mfaFactor.updateMany({
    where: { id: pending.id, verifiedAt: null, revokedAt: null },
    data: { verifiedAt: now },
  });
  if (activated.count !== 1) throw new IdentityError('NOT_FOUND');
  await tx.appUser.update({
    where: { id: input.userId },
    data: { mfaEnrolledAt: now },
    select: { id: true },
  });

  await tx.mfaRecoveryCode.updateMany({
    where: { userId: input.userId, usedAt: null },
    data: { usedAt: now },
  });
  const recoveryCodes = Array.from(
    { length: IDENTITY_POLICY.recoveryCodeCount },
    generateRecoveryCode,
  );
  await tx.mfaRecoveryCode.createMany({
    data: recoveryCodes.map((code) => ({
      id: uuidv7(now.getTime()),
      userId: input.userId,
      codeHash: deps.hasher.recoveryCode(input.userId, code),
      createdAt: now,
    })),
  });
  await deps.audit.record(tx, {
    actor: { userId: input.userId },
    action: 'auth.mfa_enrol_confirmed',
    entityType: 'mfa_factor',
    entityId: pending.id,
    ...auditMeta(input.meta),
  });
  return { ok: true, recoveryCodes };
}

export type VerifyMfaOutcome =
  | { ok: true }
  | { ok: false; reason: 'NOT_ENROLLED' }
  | { ok: false; reason: 'INVALID' }
  | { ok: false; reason: 'LOCKED'; retryAfterSeconds: number };

/**
 * Checks a TOTP code of the user's verified factor (`/auth/mfa/verify`). `NOT_ENROLLED` means
 * the user has no verified factor (`MFA_ENROLMENT_REQUIRED`). The caller commits whatever the
 * outcome.
 */
export async function verifyUserTotp(
  tx: Prisma.TransactionClient,
  deps: IdentityDeps,
  input: { userId: string; code: string; meta: RequestMeta },
): Promise<VerifyMfaOutcome> {
  const factor = await tx.mfaFactor.findFirst({
    where: { userId: input.userId, factorType: 'TOTP', verifiedAt: { not: null }, revokedAt: null },
    select: {
      id: true,
      secretCiphertext: true,
      lastUsedStep: true,
      failedAttempts: true,
      lockedUntil: true,
    },
  });
  if (!factor) return { ok: false, reason: 'NOT_ENROLLED' };
  const outcome = await checkTotp(tx, deps, factor, input.userId, input.code, input.meta);
  return outcome.ok ? { ok: true } : outcome;
}
