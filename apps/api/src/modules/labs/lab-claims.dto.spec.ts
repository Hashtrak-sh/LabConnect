import { describe, expect, it } from 'vitest';
import { DomainError } from '../../common/domain-error.js';
import { parseLabClaimCreate, parseLabClaimOtpVerify, requireClaimId } from './lab-claims.dto.js';

const issues = (work: () => unknown): { path: string; code: string }[] => {
  try {
    work();
  } catch (error) {
    if (error instanceof DomainError) return [...(error.errors ?? [])];
    throw error;
  }
  return expect.fail('expected a validation error');
};

describe('parseLabClaimCreate', () => {
  it('takes exactly a certificate number and trims it', () => {
    expect(parseLabClaimCreate({ certificateNo: 'TC-1234' })).toEqual({ certificateNo: 'TC-1234' });
    expect(parseLabClaimCreate({ certificateNo: '  TC-1234 ' })).toEqual({
      certificateNo: 'TC-1234',
    });
  });

  it('refuses every other field, naming it, and never repeats a value', () => {
    for (const extra of ['email', 'contactEmail', 'otpSentTo', 'organisationId', 'userId']) {
      const found = issues(() => parseLabClaimCreate({ certificateNo: 'TC-1', [extra]: 'x@y.in' }));
      expect(found).toEqual([expect.objectContaining({ path: extra, code: 'UNKNOWN_FIELD' })]);
      expect(JSON.stringify(found)).not.toContain('x@y.in');
    }
  });

  it('refuses a missing, empty, blank, long or non-string certificate and a non-object body', () => {
    for (const body of [
      {},
      { certificateNo: '' },
      { certificateNo: '   ' },
      { certificateNo: 'x'.repeat(51) },
      { certificateNo: 5 },
      { certificateNo: null },
      null,
      [],
      'TC-1',
    ]) {
      expect(issues(() => parseLabClaimCreate(body)).length, JSON.stringify(body)).toBeGreaterThan(
        0,
      );
    }
  });
});

describe('parseLabClaimOtpVerify', () => {
  it('takes exactly a 6-digit code', () => {
    expect(parseLabClaimOtpVerify({ code: '012345' })).toEqual({ code: '012345' });
    for (const body of [
      {},
      { code: '12345' },
      { code: '1234567' },
      { code: 'abcdef' },
      { code: 123456 },
      { code: '123456', email: 'a@b.in' },
      [],
    ]) {
      expect(
        issues(() => parseLabClaimOtpVerify(body)).length,
        JSON.stringify(body),
      ).toBeGreaterThan(0);
    }
  });
});

describe('requireClaimId', () => {
  it('accepts a UUID and refuses anything else with 422', () => {
    expect(requireClaimId('0190D6A2-7C4E-7A1B-9C3D-000000000000')).toBe(
      '0190d6a2-7c4e-7a1b-9c3d-000000000000',
    );
    expect(issues(() => requireClaimId('not-a-uuid'))).toEqual([
      expect.objectContaining({ path: 'id' }),
    ]);
  });
});
