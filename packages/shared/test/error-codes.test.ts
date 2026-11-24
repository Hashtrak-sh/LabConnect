import { describe, expect, it } from 'vitest';

import { ERROR_CODE_LIST, httpStatusOf, isErrorCode } from '../src/error-codes.js';

describe('error codes', () => {
  it('map to client or server error statuses', () => {
    for (const code of ERROR_CODE_LIST) {
      expect(httpStatusOf(code)).toBeGreaterThanOrEqual(400);
      expect(httpStatusOf(code)).toBeLessThan(600);
    }
    expect(httpStatusOf('INVALID_STATE_TRANSITION')).toBe(409);
    expect(httpStatusOf('OTP_LOCKED')).toBe(429);
  });

  it('isErrorCode accepts only catalogue codes', () => {
    expect(isErrorCode('NOT_FOUND')).toBe(true);
    expect(isErrorCode('not_found')).toBe(false);
    expect(isErrorCode('constructor')).toBe(false);
    expect(isErrorCode(404)).toBe(false);
  });
});
