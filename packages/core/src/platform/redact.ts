import type { Prisma } from '@labconnect/database';

export const REDACTED = '[REDACTED]';
const MAX_DEPTH = 20;

/**
 * Words that mark a key as sensitive. A key is split into words (`otpHash`, `otp_hash` and
 * `OTP-HASH` all give `otp`, `hash`), and any one of these words is enough. Matching on
 * whole words keeps `footprint` and `company` out of it.
 *
 * Source: CLAUDE.md section 5 ("secrets, OTPs, tokens, bank account numbers, report
 * contents") and SECURITY_AND_PRIVACY.md section 2 (restricted data: report files, bank
 * details, PAN, KYC documents, OTP and TOTP secrets, raw payment payloads).
 */
const SENSITIVE_WORDS = new Set([
  'otp',
  'totp',
  'token',
  'tokens',
  'secret',
  'secrets',
  'password',
  'passwd',
  'passcode',
  'pan',
  'aadhaar',
  'aadhar',
  'cvv',
  'authorization',
  'cookie',
  'credential',
  'credentials',
]);

/** Pairs and phrases that are sensitive only together (matched on the key without separators). */
const SENSITIVE_PHRASES = [
  'accountnumber',
  'accountno',
  'bankaccount',
  'bankacct',
  'apikey',
  'privatekey',
  'accesskey',
  'secretkey',
  'recoverycode',
  'recoverycodes',
  'filecontent',
  'filecontents',
  'filebody',
  'filebytes',
  'reportcontent',
  'reportcontents',
  'reportbody',
  'reportfile',
  'rawpayload',
  'rawbody',
  'kycdocument',
  'sessionid',
];

function wordsOf(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

export function isSensitiveKey(key: string): boolean {
  const words = wordsOf(key);
  if (words.some((word) => SENSITIVE_WORDS.has(word))) return true;
  const joined = words.join('');
  return SENSITIVE_PHRASES.some((phrase) => joined.includes(phrase));
}

/**
 * Returns a JSON-safe deep copy of `value` in which the value of every sensitive key is
 * replaced by `[REDACTED]`, at any depth, inside arrays too. The result is what goes into
 * `audit_log.before` and `audit_log.after`.
 *
 * - bigint becomes its decimal string and a Date its ISO 8601 UTC string, so the copy is
 *   deterministic and the database driver never sees a type it cannot serialise.
 * - Binary values (Buffer, typed arrays) are never copied: they become `[BINARY]`.
 * - `undefined` members are left out; a cycle or nesting beyond 20 levels becomes
 *   `[CIRCULAR]` or `[TOO_DEEP]`.
 * - Functions and symbols are dropped.
 */
export function redact(value: unknown): Prisma.InputJsonValue | null {
  return walk(value, 0, new Set()) as Prisma.InputJsonValue | null;
}

function walk(value: unknown, depth: number, path: Set<object>): unknown {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'bigint':
      return value.toString(10);
    case 'object':
      break;
    default:
      return null;
  }
  const object = value as object;
  if (object instanceof Date) {
    return Number.isNaN(object.getTime()) ? null : object.toISOString();
  }
  if (ArrayBuffer.isView(object) || object instanceof ArrayBuffer) return '[BINARY]';
  if (depth >= MAX_DEPTH) return '[TOO_DEEP]';
  if (path.has(object)) return '[CIRCULAR]';
  path.add(object);
  try {
    if (Array.isArray(object)) {
      return (object as unknown[]).map((item) => walk(item, depth + 1, path));
    }
    const result: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(object as Record<string, unknown>)) {
      if (member === undefined || typeof member === 'function' || typeof member === 'symbol') {
        continue;
      }
      result[key] = isSensitiveKey(key) ? REDACTED : walk(member, depth + 1, path);
    }
    return result;
  } finally {
    path.delete(object);
  }
}
