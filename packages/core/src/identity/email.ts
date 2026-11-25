const MAX_EMAIL_LENGTH = 254;

/**
 * The form of an email address used as a key: trimmed and lower-cased. `app_user.email` is
 * `citext`, so the database compares without case as well; hashes of the address
 * (`otp_challenge.destination_hash`) are made from this form so that `A@x.in` and `a@x.in`
 * are one destination.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** A shape check, not a deliverability check: one `@`, no spaces, a dot in the domain, 254 characters at most. */
export function isPlausibleEmail(email: string): boolean {
  return email.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email);
}

/** The part before the `@`, used as a placeholder name for a user who has not given one. */
export function emailLocalPart(email: string): string {
  const at = email.lastIndexOf('@');
  return (at > 0 ? email.slice(0, at) : email).slice(0, 100);
}
