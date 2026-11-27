// Formatting primitives (COMPONENT_SPECIFICATION: Money, DateTime). Money is integer paise and is
// shown in rupees with Indian grouping and always two decimals (decided after DESIGN_REVIEW_PASS_2,
// DP2-11). Times are stored in UTC and shown in IST, always with "IST" (DR-23). Dates are
// "DD MMM YYYY" (DP2-12).

const IST = 'Asia/Kolkata';

const RUPEES = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `125000` paise → "₹1,250.00". */
export function formatMoney(money: { amountPaise: number }): string {
  return RUPEES.format(money.amountPaise / 100);
}

function parts(date: Date, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-IN', options).formatToParts(date)) {
    result[part.type] = part.value;
  }
  return result;
}

/** A `YYYY-MM-DD` calendar date → "27 Nov 2026"; with `weekday`, "Fri 27 Nov 2026". */
export function formatDate(date: string, options: { weekday?: boolean } = {}): string {
  const p = parts(new Date(`${date}T00:00:00Z`), {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const text = `${p.day ?? ''} ${p.month ?? ''} ${p.year ?? ''}`;
  return options.weekday === true ? `${p.weekday ?? ''} ${text}` : text;
}

/** An instant → "10:00 AM IST". */
export function formatTime(iso: string): string {
  const p = parts(new Date(iso), {
    timeZone: IST,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${p.hour ?? ''}:${p.minute ?? ''} ${(p.dayPeriod ?? '').toUpperCase()} IST`;
}

/** An instant → "27 Nov 2026, 10:00 AM IST". */
export function formatDateTime(iso: string): string {
  const p = parts(new Date(iso), {
    timeZone: IST,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `${p.day ?? ''} ${p.month ?? ''} ${p.year ?? ''}, ${formatTime(iso)}`;
}
