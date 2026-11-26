import { type DeploymentEnv, nonProductionDeployment } from '../platform/deployment-env.js';
import { normaliseEmail } from './email.js';

/*
 * Demo one-time codes (UAT only): a deliberately limited back door for showing the product on UAT
 * without a mailbox. Docs: AUTHENTICATION_AND_AUTHORISATION.md, "Demo one-time codes (UAT only)".
 *
 * What it is: when two settings are present, the one-time code of a *demo destination* is the
 * configured fixed code instead of a random one, and no e-mail is sent for it. Everything else
 * about the code is unchanged: hashed at rest, expires, locks after five wrong guesses, and counts
 * against the request limits. The authenticator step (TOTP) is not touched.
 *
 * What makes it safe to leave in the code:
 * - off unless `DEMO_OTP_CODE` is set; the API refuses to start with it in production
 *   (`nonProductionDeployment`, the test the fake payment gateway uses);
 * - the demo domain must end in a reserved top-level domain (RFC 2606, RFC 6761), so it can
 *   never name a domain where a real person has an address;
 * - a destination matches only when its domain is exactly the demo domain (see `isDemoDestination`).
 */

/** `DEMO_OTP_CODE`: exactly six digits. */
export const DEMO_OTP_CODE_VARIABLE = 'DEMO_OTP_CODE';
/** `DEMO_OTP_EMAIL_DOMAIN`: the domain of the demo accounts. */
export const DEMO_OTP_DOMAIN_VARIABLE = 'DEMO_OTP_EMAIL_DOMAIN';
/** The domain of the demo seed (`DemoSeedOptions.emailDomain`). */
export const DEFAULT_DEMO_EMAIL_DOMAIN = 'demo.labconnect.test';
/** Top-level domains that can never receive mail or name a real organisation. */
export const RESERVED_TOP_LEVEL_DOMAINS = ['test', 'example', 'invalid', 'localhost'] as const;

/**
 * The validated setting. `code` is not enumerable, so logging, `JSON.stringify` or spreading the
 * object can never show it; read it as `settings.code` only where the code is issued.
 */
export interface DemoOtpSettings {
  readonly emailDomain: string;
  readonly code: string;
}

/** An invalid or forbidden demo-code setting. The message names the variable, never its value. */
export class DemoOtpConfigError extends Error {
  override name = 'DemoOtpConfigError';
}

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A domain name made of ASCII labels, at least two, ending in a reserved top-level domain. */
function validDemoDomain(raw: string): string | undefined {
  // ASCII only, checked before lower-casing: some non-ASCII letters (the Kelvin sign) fold to ASCII.
  if (!/^[\x21-\x7e]+$/.test(raw) || raw.length > 253) return undefined;
  const domain = raw.toLowerCase();
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label))) return undefined;
  const top = labels[labels.length - 1] ?? '';
  return (RESERVED_TOP_LEVEL_DOMAINS as readonly string[]).includes(top) ? domain : undefined;
}

/**
 * Reads the two settings. `undefined` means off: neither variable is present (the default).
 *
 * Present means defined, even empty: a stray empty value is refused rather than guessed at.
 * Refused, naming the variable and never its value: in production (either variable present), a
 * code that is not exactly six digits, a domain that is not a domain name under a reserved
 * top-level domain. The domain defaults to the demo seed's. A domain without a code is off.
 */
export function parseDemoOtpSettings(env: DeploymentEnv): DemoOtpSettings | undefined {
  const rawCode = env[DEMO_OTP_CODE_VARIABLE];
  const rawDomain = env[DEMO_OTP_DOMAIN_VARIABLE];
  if (rawCode === undefined && rawDomain === undefined) return undefined;

  if (!nonProductionDeployment(env)) {
    const present = rawCode !== undefined ? DEMO_OTP_CODE_VARIABLE : DEMO_OTP_DOMAIN_VARIABLE;
    throw new DemoOtpConfigError(
      `${present} is set, and demo one-time codes are not allowed in production. ` +
        'UAT sets APP_ENV=uat explicitly. Remove the variable.',
    );
  }
  if (rawCode !== undefined && !/^\d{6}$/.test(rawCode)) {
    throw new DemoOtpConfigError(`${DEMO_OTP_CODE_VARIABLE} must be exactly six digits.`);
  }
  let emailDomain = DEFAULT_DEMO_EMAIL_DOMAIN;
  if (rawDomain !== undefined) {
    const valid = validDemoDomain(rawDomain.trim());
    if (valid === undefined) {
      throw new DemoOtpConfigError(
        `${DEMO_OTP_DOMAIN_VARIABLE} must be a domain name ending in a reserved top-level domain ` +
          `(${RESERVED_TOP_LEVEL_DOMAINS.map((tld) => `.${tld}`).join(', ')}).`,
      );
    }
    emailDomain = valid;
  }
  if (rawCode === undefined) return undefined;
  const settings = { emailDomain } as { emailDomain: string; code: string };
  Object.defineProperty(settings, 'code', { value: rawCode, enumerable: false });
  return Object.freeze(settings);
}

/**
 * Whether an address is a demo destination: exactly one `@`, a local part, and a domain that is
 * *exactly* the demo domain after the usual normalisation (trimmed, lower-cased). A subdomain, a
 * look-alike (`demo.labconnect.test.evil.example`), a trailing dot, a second `@`, whitespace or any
 * non-ASCII character is not a demo destination. Pure: no database.
 */
export function isDemoDestination(email: string, settings: DemoOtpSettings): boolean {
  const trimmed = email.trim();
  if (!/^[\x21-\x7e]+$/.test(trimmed)) return false;
  const normalised = normaliseEmail(trimmed);
  const parts = normalised.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return local !== undefined && local.length > 0 && domain === settings.emailDomain;
}
