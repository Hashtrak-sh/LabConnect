import { describe, expect, it } from 'vitest';
import { isSensitiveKey, REDACTED, redact } from './redact.js';

describe('isSensitiveKey', () => {
  it.each([
    'otp',
    'otpHash',
    'otp_hash',
    'OTP',
    'token',
    'refreshToken',
    'access_token',
    'resetTokenHash',
    'secret',
    'clientSecret',
    'password',
    'passwordHash',
    'totpSecret',
    'pan',
    'PAN',
    'panNumber',
    'aadhaar',
    'accountNumber',
    'account_number',
    'bankAccountNumber',
    'apiKey',
    'privateKey',
    'recoveryCodes',
    'fileContent',
    'reportContents',
    'rawPayload',
    'authorization',
    'cookie',
    'cvv',
  ])('flags %s', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    'footprint',
    'company',
    'expand',
    'status',
    'bookingNo',
    'organisationId',
    'reason',
    'amountPaise',
    'accountId',
    'ifsc',
    'pincode',
  ])('does not flag %s', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe('redact', () => {
  it('replaces sensitive values at any depth, in arrays too', () => {
    const result = redact({
      status: 'ACTIVE',
      owner: { name: 'A', otp: '123456', tokens: ['x', 'y'] },
      history: [{ password: 'p', note: 'n' }],
    });
    expect(result).toEqual({
      status: 'ACTIVE',
      owner: { name: 'A', otp: REDACTED, tokens: REDACTED },
      history: [{ password: REDACTED, note: 'n' }],
    });
  });

  it('redacts the whole value of a sensitive key, whatever its type', () => {
    expect(redact({ secret: { nested: 1 }, pan: 5, otp: null })).toEqual({
      secret: REDACTED,
      pan: REDACTED,
      otp: REDACTED,
    });
  });

  it('does not change its input', () => {
    const input = { otp: '1', inner: { token: 't' } };
    redact(input);
    expect(input).toEqual({ otp: '1', inner: { token: 't' } });
  });

  it('writes bigint and Date deterministically', () => {
    expect(redact({ amount: 123n, at: new Date('2026-11-25T10:00:00Z') })).toEqual({
      amount: '123',
      at: '2026-11-25T10:00:00.000Z',
    });
  });

  it('never copies binary data', () => {
    expect(redact({ blob: Buffer.from('secret bytes'), view: new Uint8Array(2) })).toEqual({
      blob: '[BINARY]',
      view: '[BINARY]',
    });
  });

  it('survives cycles and very deep nesting', () => {
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    expect(redact(loop)).toEqual({ a: 1, self: '[CIRCULAR]' });
    let deep: unknown = 'leaf';
    for (let i = 0; i < 40; i += 1) deep = { next: deep };
    expect(JSON.stringify(redact(deep))).toContain('[TOO_DEEP]');
  });

  it('drops undefined, functions and symbols; keeps null; handles scalars', () => {
    expect(redact({ a: undefined, b: () => 1, c: Symbol('x'), d: null, e: 0 })).toEqual({
      d: null,
      e: 0,
    });
    expect(redact('plain')).toBe('plain');
    expect(redact(7)).toBe(7);
    expect(redact(undefined)).toBeNull();
  });
});
