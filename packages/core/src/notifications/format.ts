// Small, dependency-free formatting for message text. Money is integer paise (CLAUDE.md
// section 6), times are stored in UTC and shown in IST. Written by hand, not with `Intl`, so the
// output does not depend on the ICU data of the Node build.

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for use in HTML content and in a quoted attribute. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/** Removes line breaks and other control characters. Used for anything that goes into a header (a subject). */
export function singleLine(value: string): string {
  // Control characters (CR and LF among them) and the Unicode line and paragraph separators.
  return value.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim();
}

/** Control characters out, length capped. For free text from an event (a reason) before it reaches a message. */
export function clipText(value: string, maxLength: number): string {
  const clean = singleLine(value);
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1)}…`;
}

/**
 * An amount of paise as rupees with Indian digit grouping: `123456789n` is `₹12,34,567.89`.
 * Negative amounts keep their sign. Never goes through floating point.
 */
export function formatInr(paise: bigint): string {
  const negative = paise < 0n;
  const absolute = negative ? -paise : paise;
  const rupees = (absolute / 100n).toString();
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  const lastThree = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped =
    rest.length > 0 ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;
  return `${negative ? '-' : ''}₹${grouped}.${fraction}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** An instant in IST, for example `26 Nov 2026, 5:30 pm IST`. */
export function formatIst(instant: Date): string {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  const hours24 = shifted.getUTCHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  const suffix = hours24 < 12 ? 'am' : 'pm';
  const month = MONTHS[shifted.getUTCMonth()] ?? '';
  return `${String(shifted.getUTCDate())} ${month} ${String(shifted.getUTCFullYear())}, ${String(hours12)}:${minutes} ${suffix} IST`;
}
