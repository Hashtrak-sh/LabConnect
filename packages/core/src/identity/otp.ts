import { isIP } from 'node:net';
import { type OtpPurpose, type Prisma, uuidv7 } from '@labconnect/database';
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
export function requestLoginOtp(
  tx: Prisma.TransactionClient,
  deps: IdentityDeps,
  input: { email: string; ipAddress?: string },
): Promise<OtpRequestOutcome> {
  return requestOtp(tx, deps, { ...input, purpose: 'LOGIN' });
}

export interface OtpRequestInput {
  purpose: OtpPurpose;
  email: string;
  ipAddress?: string;
  /**
   * What the code is for (`otp_challenge.context_id`), for example the id of a lab claim. A new
   * code closes only the open codes of the same purpose, destination and context, so one
   * request cannot cancel another's code for a shared address.
   */
  contextId?: string;
  /** The signed-in user who asked, when there is one. */
  createdByUserId?: string;
}

/**
 * `requestLoginOtp` for any purpose: the same hashing, limits and storage. The per-destination
 * limit counts the codes of the same purpose; the per-IP limit counts every purpose.
 */
export async function requestOtp(
  tx: Prisma.TransactionClient,
  deps: IdentityDeps,
  input: OtpRequestInput,
): Promise<OtpRequestOutcome> {
  const { purpose, contextId } = input;
  const now = deps.clock.now();
  const destinationHash = deps.hasher.destination(normaliseEmail(input.email));
  const ipAddress =
    input.ipAddress !== undefined && isIP(input.ipAddress) !== 0 ? input.ipAddress : undefined;

  const perDestination = IDENTITY_POLICY.otpRequestsPerDestination;
  const destinationSince = new Date(now.getTime() - perDestination.windowSeconds * 1000);
  const recent = await tx.otpChallenge.findMany({
    where: { destinationHash, purpose, createdAt: { gt: destinationSince } },
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
    where: {
      destinationHash,
      purpose,
      consumedAt: null,
      ...(contextId !== undefined && { contextId }),
    },
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
      purpose,
      contextId: contextId ?? null,
      createdByUserId: input.createdByUserId ?? null,
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
export function consumeLoginOtp(
  tx: Prisma.TransactionClient,
  deps: IdentityDeps,
  input: { email: string; code: string },
): Promise<OtpConsumeOutcome> {
  return consumeOtp(tx, deps, {
    purpose: 'LOGIN',
    code: input.code,
    destinationHash: deps.hasher.destination(normaliseEmail(input.email)),
  });
}

/** Which open challenge a code is checked against. */
export interface OtpConsumeInput {
  purpose: OtpPurpose;
  code: string;
  /** The HMAC of the normalised address (`IdentityHasher.destination`), to find the newest open code of an address. */
  destinationHash?: Uint8Array<ArrayBuffer>;
  /** The context the code was issued for (`otp_challenge.context_id`), for example a lab claim id. */
  contextId?: string;
}

/**
 * `consumeLoginOtp` for any purpose, with the same attempt count, lockout, expiry and single
 * use. The challenge is found by `destinationHash`, by `contextId`, or both; one of them is
 * required, so a call can never match every open code of a purpose.
 */
export async function consumeOtp(
  tx: Prisma.TransactionClient,
  deps: IdentityDeps,
  input: OtpConsumeInput,
): Promise<OtpConsumeOutcome> {
  if (input.destinationHash === undefined && input.contextId === undefined) {
    throw new TypeError('An OTP is checked against a destination or a context.');
  }
  const now = deps.clock.now();
  const challenge = await tx.otpChallenge.findFirst({
    where: {
      purpose: input.purpose,
      channel: 'EMAIL',
      consumedAt: null,
      ...(input.destinationHash !== undefined && { destinationHash: input.destinationHash }),
      ...(input.contextId !== undefined && { contextId: input.contextId }),
    },
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
