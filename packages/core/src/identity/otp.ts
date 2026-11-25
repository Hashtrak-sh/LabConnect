import { isIP } from 'node:net';
import { type Prisma, uuidv7 } from '@labconnect/database';
import { normaliseEmail } from './email.js';
import { constantTimeEqual, generateDigits } from './hasher.js';
import { IDENTITY_POLICY } from './policy.js';
import type { IdentityDeps } from './ports.js';

export type OtpRequestOutcome =
  | { ok: true; challengeId: string; code: string; expiresAt: Date }
  | { ok: false; reason: 'RATE_LIMITED'; retryAfterSeconds: number };

/**
 * Creates a login challenge for an email address and returns the clear code for the caller
 * to send. Only an HMAC of the code is stored (`code_hash`), bound to the challenge id.
 *
 * The answer does not depend on whether a user has this address: no user is read. (Every
 * address can sign up, so there is nothing to hide, and a disabled user is handled at
 * verification, indistinguishably from a wrong code, OQ-35.)
 *
 * Limits (AUTHENTICATION doc, API_CONVENTIONS section 7): 5 requests per 15 minutes per
 * destination and 20 per hour per IP address. A request over the limit stores nothing.
 * The count-then-insert is not serialised, so two simultaneous requests can overshoot a
 * limit by one; the attempt limit per challenge is what bounds guessing.
 *
 * The code must be sent after the caller's transaction commits, and must never be logged,
 * audited or written to the outbox (OQ-65).
 */
export async function requestLoginOtp(
  tx: Prisma.TransactionClient,
  deps: IdentityDeps,
  input: { email: string; ipAddress?: string },
): Promise<OtpRequestOutcome> {
  const now = deps.clock.now();
  const destinationHash = deps.hasher.destination(normaliseEmail(input.email));
  const ipAddress =
    input.ipAddress !== undefined && isIP(input.ipAddress) !== 0 ? input.ipAddress : undefined;

  const perDestination = IDENTITY_POLICY.otpRequestsPerDestination;
  const destinationSince = new Date(now.getTime() - perDestination.windowSeconds * 1000);
  const recent = await tx.otpChallenge.findMany({
    where: { destinationHash, purpose: 'LOGIN', createdAt: { gt: destinationSince } },
    orderBy: { createdAt: 'desc' },
    take: perDestination.max,
    select: { createdAt: true },
  });
  const oldestCounted = recent[perDestination.max - 1];
  if (oldestCounted) {
    return {
      ok: false,
      reason: 'RATE_LIMITED',
      retryAfterSeconds: secondsUntil(
        oldestCounted.createdAt.getTime() + perDestination.windowSeconds * 1000,
        now,
      ),
    };
  }

  if (ipAddress !== undefined) {
    const perIp = IDENTITY_POLICY.otpRequestsPerIp;
    const ipSince = new Date(now.getTime() - perIp.windowSeconds * 1000);
    const rows = await tx.$queryRaw<{ created_at: Date }[]>`
      SELECT created_at FROM otp_challenge
       WHERE ip_address = ${ipAddress}::inet AND created_at > ${ipSince}
       ORDER BY created_at DESC LIMIT ${perIp.max}`;
    const oldestForIp = rows[perIp.max - 1];
    if (oldestForIp) {
      return {
        ok: false,
        reason: 'RATE_LIMITED',
        retryAfterSeconds: secondsUntil(
          oldestForIp.created_at.getTime() + perIp.windowSeconds * 1000,
          now,
        ),
      };
    }
  }

  // A new code replaces the old one: open challenges of this destination are closed, so
  // exactly one can be checked and a tie in `created_at` cannot pick the wrong one.
  await tx.otpChallenge.updateMany({
    where: { destinationHash, purpose: 'LOGIN', consumedAt: null },
    data: { consumedAt: now },
  });
  const id = uuidv7(now.getTime());
  const code = generateDigits(IDENTITY_POLICY.otpLength);
  const expiresAt = new Date(now.getTime() + IDENTITY_POLICY.otpTtlSeconds * 1000);
  await tx.otpChallenge.create({
    data: {
      id,
      channel: 'EMAIL',
      destinationHash,
      purpose: 'LOGIN',
      codeHash: deps.hasher.otpCode(id, code),
      expiresAt,
      ipAddress: ipAddress ?? null,
      createdAt: now,
    },
    select: { id: true },
  });
  return { ok: true, challengeId: id, code, expiresAt };
}

export type OtpConsumeOutcome =
  | { ok: true; challengeId: string }
  | { ok: false; reason: 'INVALID' | 'EXPIRED' }
  | { ok: false; reason: 'LOCKED' };

/**
 * Checks a login code against the newest open challenge of the address and, if it is right,
 * spends it (single use). Earlier challenges of the same address are ignored: asking for a
 * new code replaces the old one.
 *
 * The caller must commit the transaction whatever the outcome: a wrong guess is recorded as
 * an attempt, and the fifth wrong guess locks the challenge (`OTP_LOCKED`). Spending the
 * challenge is one conditional UPDATE (`consumed_at IS NULL AND attempts < 5 AND not
 * expired`), so of two simultaneous correct submissions exactly one succeeds.
 */
export async function consumeLoginOtp(
  tx: Prisma.TransactionClient,
  deps: IdentityDeps,
  input: { email: string; code: string },
): Promise<OtpConsumeOutcome> {
  const now = deps.clock.now();
  const destinationHash = deps.hasher.destination(normaliseEmail(input.email));
  const challenge = await tx.otpChallenge.findFirst({
    where: { destinationHash, purpose: 'LOGIN', channel: 'EMAIL', consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!challenge) {
    // Do the same hashing work as for a real challenge so the answer takes about as long.
    deps.hasher.otpCode('00000000-0000-0000-0000-000000000000', input.code);
    return { ok: false, reason: 'INVALID' };
  }
  if (challenge.attempts >= IDENTITY_POLICY.otpMaxAttempts) return { ok: false, reason: 'LOCKED' };
  if (challenge.expiresAt <= now) return { ok: false, reason: 'EXPIRED' };

  const expected = challenge.codeHash;
  const given = deps.hasher.otpCode(challenge.id, input.code);
  if (constantTimeEqual(expected, given)) {
    const spent = await tx.otpChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        attempts: { lt: IDENTITY_POLICY.otpMaxAttempts },
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    // Someone else spent it first, or it expired meanwhile: this submission has no code left.
    return spent.count === 1
      ? { ok: true, challengeId: challenge.id }
      : { ok: false, reason: 'INVALID' };
  }

  const counted = await tx.otpChallenge.updateMany({
    where: {
      id: challenge.id,
      consumedAt: null,
      attempts: { lt: IDENTITY_POLICY.otpMaxAttempts },
    },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count === 0) return { ok: false, reason: 'LOCKED' };
  const after = await tx.otpChallenge.findUniqueOrThrow({
    where: { id: challenge.id },
    select: { attempts: true },
  });
  return after.attempts >= IDENTITY_POLICY.otpMaxAttempts
    ? { ok: false, reason: 'LOCKED' }
    : { ok: false, reason: 'INVALID' };
}

function secondsUntil(epochMillis: number, now: Date): number {
  return Math.max(1, Math.ceil((epochMillis - now.getTime()) / 1000));
}
