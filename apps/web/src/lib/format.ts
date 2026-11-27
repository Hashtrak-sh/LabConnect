// Web-only helpers. Display formatting (money, dates, times) comes from @labconnect/ui, so every
// screen formats the same way (DP2-11, DP2-12, DR-23).

const IST_OFFSET_MS = 5.5 * 3_600_000;

/** The IST calendar date `days` after `now`, as `YYYY-MM-DD`. */
export function istDate(now: Date, days = 0): string {
  return new Date(now.getTime() + IST_OFFSET_MS + days * 86_400_000).toISOString().slice(0, 10);
}

/** Today's weekday in IST, 1 = Monday … 7 = Sunday (as `receiving_hours.weekday`). */
export function istWeekday(now: Date): number {
  const day = new Date(now.getTime() + IST_OFFSET_MS).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The IST wall-clock time of `now`, `HH:MM`. */
export function istClock(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(11, 16);
}

/** `HH:MM` (24 h, IST) → "5:00 PM IST". */
export function formatClock(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${String(hour)}:${String(m).padStart(2, '0')} ${period} IST`;
}

/** Rupees typed by a user ("1250", "1,250.50") → integer paise, or `null` when not a price. */
export function rupeesToPaise(input: string): number | null {
  const cleaned = input.replaceAll(',', '').trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
