// Money rules from docs/05-integrations/PAYMENTS_AND_LEDGER.md §1: integer paise as `bigint`,
// currency INR, GST per line rounded half up, and `amountPaise` as a JSON number.
// Display formatting is UI work and is not here.

/** An amount of money in integer paise. Never a floating-point number. */
export type Paise = bigint;

export const CURRENCY = 'INR';
export type Currency = typeof CURRENCY;

/** 1 rupee = 100 paise. */
export const PAISE_PER_RUPEE = 100n;

const BASIS_POINTS = 10_000n;

/**
 * GST on one line: `round_half_up(taxable × rate_bp / 10000)`.
 * The taxable amount must not be negative; the rate is a whole number of basis points
 * (1800 = 18%). Booking GST is the sum of the line GST (see sumPaise()).
 */
export function gstForLine(taxablePaise: Paise, rateBp: number): Paise {
  if (taxablePaise < 0n) {
    throw new RangeError('The taxable amount must not be negative');
  }
  if (!Number.isSafeInteger(rateBp) || rateBp < 0) {
    throw new RangeError('The GST rate must be a non-negative whole number of basis points');
  }
  const product = taxablePaise * BigInt(rateBp);
  // Both operands are non-negative, so adding half the divisor and truncating rounds half up.
  return (product + BASIS_POINTS / 2n) / BASIS_POINTS;
}

export function sumPaise(amounts: Iterable<Paise>): Paise {
  let total = 0n;
  for (const amount of amounts) total += amount;
  return total;
}

/**
 * Reads an `amountPaise` JSON number. It must be a safe integer: a fraction, NaN, Infinity or a
 * value beyond ±(2^53 − 1) is refused rather than rounded.
 */
export function paiseFromJson(amountPaise: number): Paise {
  if (!Number.isSafeInteger(amountPaise)) {
    throw new RangeError('amountPaise must be a safe integer');
  }
  return BigInt(amountPaise);
}

/** Writes an amount as the JSON `amountPaise` number. Refuses a value JSON cannot carry exactly. */
export function paiseToJson(paise: Paise): number {
  const value = Number(paise);
  if (!Number.isSafeInteger(value)) {
    throw new RangeError('The amount is too large to carry as amountPaise');
  }
  return value;
}
