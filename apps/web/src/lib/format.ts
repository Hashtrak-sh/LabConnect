// Display helpers. Money is integer paise and is only turned into rupees for display; times are
// stored in UTC and shown in IST (CLAUDE.md §6).

const IST = 'Asia/Kolkata';

const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** `125000` paise → "₹1,250". Indian digit grouping. */
export function formatMoney(money: { amountPaise: number }): string {
  return rupees.format(money.amountPaise / 100);
}

/** "27 Nov 2026, 10:00 am" in IST. */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** "10:00 am" in IST. */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** A `YYYY-MM-DD` calendar date as "Fri, 27 Nov, 2026" (en-IN). */
export function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** The IST calendar date `days` after `now`, as `YYYY-MM-DD`. */
export function istDate(now: Date, days = 0): string {
  const shifted = new Date(now.getTime() + 5.5 * 3_600_000 + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

/** Rupees typed by a user ("1250", "1,250.50") → integer paise, or `null` when not a price. */
export function rupeesToPaise(input: string): number | null {
  const cleaned = input.replaceAll(',', '').trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
