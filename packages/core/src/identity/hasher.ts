import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { IDENTITY_POLICY } from './policy.js';

/** A `bytea` value as Prisma wants it. */
export type Bytes = Uint8Array<ArrayBuffer>;

const MIN_SECRET_BYTES = 32;

/** Compares two byte strings in constant time. Different lengths are simply unequal. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Decodes a secret given as base64 or hex. At least 32 bytes, so a short string cannot be used by mistake. */
export function parseSecretBytes(value: string, name: string): Bytes {
  const trimmed = value.trim();
  const isHex = /^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0;
  const bytes = Uint8Array.from(Buffer.from(trimmed, isHex ? 'hex' : 'base64'));
  if (bytes.length < MIN_SECRET_BYTES) {
    throw new Error(`${name} must decode to at least ${String(MIN_SECRET_BYTES)} bytes.`);
  }
  return bytes;
}

/** SHA-256 of a refresh token. The token is 256 random bits, so a plain hash is enough. */
export function hashRefreshToken(token: string): Bytes {
  return Uint8Array.from(createHash('sha256').update('refresh-token\0').update(token).digest());
}

/** A random opaque token, 256 bits, URL safe. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** `length` random decimal digits from the CSPRNG, zero padded. */
export function generateDigits(length: number = IDENTITY_POLICY.otpLength): string {
  return String(randomInt(0, 10 ** length)).padStart(length, '0');
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A recovery code like `K7QX2-M9FDA`: 10 characters from a 32 letter alphabet (50 bits). */
export function generateRecoveryCode(): string {
  let code = '';
  for (let i = 0; i < 10; i++) {
    code += RECOVERY_ALPHABET.charAt(randomInt(0, RECOVERY_ALPHABET.length));
    if (i === 4) code += '-';
  }
  return code;
}

/** Recovery codes are compared without case, dashes or spaces. */
export function normaliseRecoveryCode(code: string): string {
  return code.replaceAll(/[\s-]/g, '').toUpperCase();
}

/**
 * Keyed hashes of the things the database must not hold in clear: the OTP destination, the
 * OTP and the recovery codes (SCHEMA_SPECIFICATION.md 2.7: "HMAC ... never in plaintext").
 *
 * An OTP has only a million values, so an unkeyed hash would be undone in a second. These are
 * HMAC-SHA256 under a server secret (`AUTH_HASH_SECRET`) that is not in the database, with a
 * different label per purpose so one hash can never stand in for another, and with the
 * challenge or user id mixed in so equal inputs give different hashes.
 */
export class IdentityHasher {
  private readonly secret: Bytes;

  constructor(secret: Uint8Array) {
    if (secret.length < MIN_SECRET_BYTES) {
      throw new Error(`The hash secret must be at least ${String(MIN_SECRET_BYTES)} bytes.`);
    }
    this.secret = Uint8Array.from(secret);
  }

  private mac(label: string, ...parts: string[]): Bytes {
    const hmac = createHmac('sha256', this.secret);
    hmac.update(label);
    for (const part of parts) {
      hmac.update('\0');
      hmac.update(part);
    }
    return Uint8Array.from(hmac.digest());
  }

  /** `otp_challenge.destination_hash`: HMAC of the normalised email. */
  destination(normalisedEmail: string): Bytes {
    return this.mac('otp-destination', normalisedEmail);
  }

  /** `otp_challenge.code_hash`. */
  otpCode(challengeId: string, code: string): Bytes {
    return this.mac('otp-code', challengeId, code);
  }

  /** `mfa_recovery_code.code_hash`. */
  recoveryCode(userId: string, code: string): Bytes {
    return this.mac('recovery-code', userId, normaliseRecoveryCode(code));
  }
}
