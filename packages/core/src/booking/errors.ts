import { CoreError, type CoreErrorOptions } from '../platform/errors.js';

export type BookingErrorOptions = CoreErrorOptions;

/**
 * The typed error of the booking module: a `CoreError`, so the API's exception filter
 * turns it into the problem body with the same `code` and `meta`.
 */
export class BookingError extends CoreError {
  override name = 'BookingError';
}

/** True for a `BookingError`, also when it comes from another copy of the package. */
export function isBookingError(value: unknown): value is BookingError {
  return (
    value instanceof BookingError ||
    (value instanceof Error &&
      value.name === 'BookingError' &&
      typeof (value as { code?: unknown }).code === 'string')
  );
}
