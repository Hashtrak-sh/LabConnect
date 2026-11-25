import { CoreError, type CoreErrorOptions } from '../platform/errors.js';

/** A search request the contract refuses (`VALIDATION_FAILED`, 422): a bad value or combination. */
export class SearchQueryError extends CoreError {
  override name = 'SearchQueryError';
  constructor(detail: string, options: Omit<CoreErrorOptions, 'detail'> = {}) {
    super('VALIDATION_FAILED', { ...options, detail });
  }
}

/** The cursor cannot be read, or was issued by the other backend (`VALIDATION_FAILED`, 422). */
export class SearchCursorError extends SearchQueryError {
  override name = 'SearchCursorError';
  constructor() {
    super('The cursor is not valid. Start again from the first page.');
  }
}

/** No backend could answer (`INTERNAL_ERROR`, 500). The cause is kept for logs, never sent. */
export class SearchUnavailableError extends CoreError {
  override name = 'SearchUnavailableError';
  constructor(cause?: unknown) {
    super('INTERNAL_ERROR', {
      detail: 'Search is not available right now.',
      ...(cause === undefined ? {} : { cause }),
    });
  }
}
