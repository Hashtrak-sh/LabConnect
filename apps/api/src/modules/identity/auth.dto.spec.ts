import { describe, expect, it } from 'vitest';
import { DomainError } from '../../common/domain-error.js';
import {
  isUuid,
  parseActiveMembership,
  parseMfaCode,
  parseOtpRequest,
  parseOtpVerify,
} from './auth.dto.js';

const issues = (run: () => unknown): string[] => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('VALIDATION_FAILED');
    return ((error as DomainError).errors ?? []).map((issue) => issue.path);
  }
  throw new Error('expected a validation error');
};

describe('identity request bodies', () => {
  it('parses an OTP request and normalises the address', () => {
    expect(parseOtpRequest({ email: '  A@Example.IN ', purpose: 'LOGIN' })).toEqual({
      email: 'a@example.in',
    });
  });

  it('names every field that is wrong, and refuses fields the contract does not have', () => {
    expect(
      issues(() => parseOtpRequest({ email: 'nope', purpose: 'LAB_CLAIM', x: 1 })).sort(),
    ).toEqual(['email', 'purpose', 'x']);
    expect(issues(() => parseOtpRequest(null))).toEqual(['']);
    expect(issues(() => parseOtpRequest('text'))).toEqual(['']);
    expect(issues(() => parseOtpRequest([]))).toEqual(['']);
  });

  it('parses an OTP verification and insists on 6 digits', () => {
    expect(parseOtpVerify({ email: 'a@example.in', code: '012345' })).toEqual({
      email: 'a@example.in',
      code: '012345',
    });
    for (const code of ['12345', '1234567', 'abcdef', '12 456', 123456, null]) {
      expect(issues(() => parseOtpVerify({ email: 'a@example.in', code }))).toEqual(['code']);
    }
  });

  it('parses an MFA code', () => {
    expect(parseMfaCode({ code: '000000' })).toEqual({ code: '000000' });
    expect(issues(() => parseMfaCode({}))).toEqual(['code']);
    expect(issues(() => parseMfaCode({ code: '123456', other: true }))).toEqual(['other']);
  });

  it('parses an active membership request', () => {
    const id = '018f0000-0000-7000-8000-000000000042';
    expect(parseActiveMembership({ membershipId: id })).toEqual({ membershipId: id });
    expect(issues(() => parseActiveMembership({ membershipId: 'abc' }))).toEqual(['membershipId']);
    expect(issues(() => parseActiveMembership({}))).toEqual(['membershipId']);
  });

  it('recognises UUIDs', () => {
    expect(isUuid('018f0000-0000-7000-8000-000000000042')).toBe(true);
    expect(isUuid('018F0000-0000-7000-8000-000000000042')).toBe(true);
    expect(isUuid('018f0000-0000-7000-8000-00000000004')).toBe(false);
    expect(isUuid(5)).toBe(false);
  });
});
