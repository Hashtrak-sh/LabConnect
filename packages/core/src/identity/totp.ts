import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { IDENTITY_POLICY, TOTP_ISSUER } from './policy.js';

// TOTP (RFC 6238) on HOTP (RFC 4226), written on node:crypto only.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, no padding (the form authenticator apps expect). */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET.charAt((value << (5 - bits)) & 31);
  return out;
}

/** Decodes base32, ignoring case, spaces and `=` padding. Throws on any other character. */
export function base32Decode(text: string): Uint8Array<ArrayBuffer> {
  const cleaned = text.replaceAll(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new RangeError('The text is not valid base32.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** A new 160-bit TOTP secret, the length RFC 4226 recommends. */
export function generateTotpSecret(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(randomBytes(20));
}

export type HmacAlgorithm = 'sha1' | 'sha256' | 'sha512';

/** HOTP (RFC 4226 section 5.3): the code for one counter value. */
export function hotp(
  secret: Uint8Array,
  counter: bigint | number,
  digits: number = IDENTITY_POLICY.totpDigits,
  algorithm: HmacAlgorithm = 'sha1',
): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, secret).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    (((mac[offset + 1] ?? 0) & 0xff) << 16) |
    (((mac[offset + 2] ?? 0) & 0xff) << 8) |
    ((mac[offset + 3] ?? 0) & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The time step of an instant: `floor(unixTime / period)`. */
export function timeStep(
  epochMillis: number,
  periodSeconds: number = IDENTITY_POLICY.totpPeriodSeconds,
): number {
  return Math.floor(epochMillis / 1000 / periodSeconds);
}

export interface TotpOptions {
  periodSeconds?: number;
  digits?: number;
  algorithm?: HmacAlgorithm;
}

/** The TOTP code at an instant (RFC 6238 section 4). */
export function totpAt(secret: Uint8Array, epochMillis: number, options: TotpOptions = {}): string {
  return hotp(
    secret,
    timeStep(epochMillis, options.periodSeconds),
    options.digits,
    options.algorithm,
  );
}

export interface MatchOptions extends TotpOptions {
  /** Steps accepted on each side of the current one. Default 1 (30 seconds either way). */
  windowSteps?: number;
  /**
   * Replay protection: only a step greater than this one can match (RFC 6238 section 5.2,
   * a code is accepted once). `null` or absent accepts any step in the window.
   */
  afterStep?: number | null;
}

function codesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The time step the code belongs to, or `null` if it matches no step in the window or only
 * a step that has been used already. Every step of the window is always computed and
 * compared in constant time, so the time taken does not tell which step (if any) matched.
 * When two steps would match (a code can repeat by chance), the later one is returned.
 */
export function matchTotp(
  secret: Uint8Array,
  code: string,
  nowMillis: number,
  options: MatchOptions = {},
): number | null {
  const window = options.windowSteps ?? IDENTITY_POLICY.totpWindowSteps;
  const digits = options.digits ?? IDENTITY_POLICY.totpDigits;
  const current = timeStep(nowMillis, options.periodSeconds);
  const floor = options.afterStep ?? Number.NEGATIVE_INFINITY;
  // A code of the wrong length can never equal a string of digits; the loop still runs in full.
  const candidate = code.length === digits ? code : 'x'.repeat(digits);
  let matched: number | null = null;
  for (let offset = -window; offset <= window; offset++) {
    const step = current + offset;
    if (step < 0) continue;
    const expected = hotp(secret, step, digits, options.algorithm ?? 'sha1');
    if (codesEqual(expected, candidate) && step > floor) matched = step;
  }
  return matched;
}

/** `otpauth://totp/LabConnect:<account>?secret=...` (Key URI Format of Google Authenticator). */
export function otpauthUri(account: string, secretBase32: string): string {
  const label = `${encodeURIComponent(TOTP_ISSUER)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({
    secret: secretBase32,
    issuer: TOTP_ISSUER,
    algorithm: 'SHA1',
    digits: String(IDENTITY_POLICY.totpDigits),
    period: String(IDENTITY_POLICY.totpPeriodSeconds),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
