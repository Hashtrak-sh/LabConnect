import { describe, expect, it } from 'vitest';
import {
  REQUEST_ID_MAX_LENGTH,
  getRequestContext,
  isValidRequestId,
  resolveRequestId,
  runWithRequestContext,
} from './request-context.js';

describe('isValidRequestId', () => {
  it.each(['abc', 'req-1', 'A_b.c:d~e', 'a'.repeat(REQUEST_ID_MAX_LENGTH)])('accepts %s', (v) => {
    expect(isValidRequestId(v)).toBe(true);
  });

  it.each([
    '',
    ' ',
    'a b',
    'a,b',
    'é',
    'a\r\nb',
    'a'.repeat(REQUEST_ID_MAX_LENGTH + 1),
    42,
    undefined,
  ])('rejects %j', (v) => {
    expect(isValidRequestId(v)).toBe(false);
  });
});

describe('resolveRequestId', () => {
  it('keeps a valid id', () => {
    expect(resolveRequestId('req-1')).toBe('req-1');
  });

  it('generates a UUID otherwise', () => {
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId('bad id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('getRequestContext', () => {
  it('is undefined outside a request', () => {
    expect(getRequestContext()).toBeUndefined();
  });

  it('is the context of the running scope, across awaits', async () => {
    const context = { requestId: 'r1', ip: '10.0.0.1', userAgent: 'ua' };
    await runWithRequestContext(context, async () => {
      await Promise.resolve();
      expect(getRequestContext()).toEqual(context);
    });
    expect(getRequestContext()).toBeUndefined();
  });
});
