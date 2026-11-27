import qrcode from 'qrcode-generator';

/** A QR code as one SVG path: `d` draws every dark module of a `size` x `size` grid. */
export interface QrCode {
  size: number;
  d: string;
}

const QUIET_ZONE = 4;

/**
 * Encodes `text` as a QR code and returns its dark modules as a single path of 1x1 squares on a
 * grid that includes the 4-module quiet zone the standard asks for. The component draws the path
 * itself, so no markup string is ever built from the secret.
 */
export function qrPath(text: string): QrCode {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  const modules = code.getModuleCount();
  let d = '';
  for (let row = 0; row < modules; row++) {
    for (let column = 0; column < modules; column++) {
      if (code.isDark(row, column)) {
        d += `M${String(column + QUIET_ZONE)} ${String(row + QUIET_ZONE)}h1v1h-1z`;
      }
    }
  }
  return { size: modules + QUIET_ZONE * 2, d };
}

const BASE32 = /^[A-Z2-7]{16,128}$/;

/** What `POST /auth/mfa/enrol` returns, once checked. */
export interface Enrolment {
  /** The base32 setup key, upper case, no spaces. */
  secret: string;
  /** The key in groups of four for reading aloud or typing: `ABCD EFGH ...`. */
  groupedSecret: string;
  /** The `otpauth://totp/...` address for the QR code. */
  uri: string;
}

/** Splits a setup key into groups of four. */
export function groupSecret(secret: string): string {
  return secret.replaceAll(/(.{4})(?=.)/g, '$1 ');
}

/**
 * Checks the API's answer before it is drawn: the key is base32, the address is an `otpauth://totp`
 * one, and its `secret` is the same key (so the QR code and the typed key cannot disagree).
 * Returns `null` for anything else, which the screen shows as "could not start".
 */
export function readEnrolment(secret: unknown, uri: unknown): Enrolment | null {
  if (typeof secret !== 'string' || typeof uri !== 'string') return null;
  const key = secret.replaceAll(/\s/g, '').toUpperCase();
  if (!BASE32.test(key)) return null;
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'otpauth:' || parsed.hostname !== 'totp') return null;
  if (parsed.searchParams.get('secret')?.toUpperCase() !== key) return null;
  return { secret: key, groupedSecret: groupSecret(key), uri };
}

/** A code typed from an authenticator app: six digits, spaces allowed. */
export function readCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.replaceAll(/\s/g, '');
  return /^\d{6}$/.test(code) ? code : null;
}
