import { describe, expect, it } from 'vitest';
import { DomainError } from '../../common/domain-error.js';
import {
  parseLabClaimCreate,
  parseLabClaimManual,
  parseLabClaimOtpVerify,
  parseLetterheadUploadRequest,
  parsePageQuery,
  requireClaimId,
} from './lab-claims.dto.js';

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

describe('parseLetterheadUploadRequest', () => {
  it('takes a file name (optional), a content type and a whole number size', () => {
    expect(
      parseLetterheadUploadRequest({
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        sizeBytes: 5,
      }),
    ).toEqual({ fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 5 });
    expect(parseLetterheadUploadRequest({ contentType: 'image/png', sizeBytes: 1 })).toEqual({
      contentType: 'image/png',
      sizeBytes: 1,
    });
  });

  it('refuses unknown fields (no owner, no key) and a size that is not a positive integer', () => {
    const base = { contentType: 'application/pdf', sizeBytes: 5 };
    for (const extra of ['ownerOrgId', 'objectKey', 'purpose', 'bucket']) {
      expect(issues(() => parseLetterheadUploadRequest({ ...base, [extra]: 'x' }))).toEqual([
        expect.objectContaining({ path: extra, code: 'UNKNOWN_FIELD' }),
      ]);
    }
    for (const sizeBytes of [0, -1, 1.5, '5', null, Number.NaN, 2 ** 60]) {
      expect(issues(() => parseLetterheadUploadRequest({ ...base, sizeBytes }))).toEqual([
        expect.objectContaining({ path: 'sizeBytes' }),
      ]);
    }
    expect(issues(() => parseLetterheadUploadRequest({ sizeBytes: 5 }))).toEqual([
      expect.objectContaining({ path: 'contentType' }),
    ]);
    expect(issues(() => parseLetterheadUploadRequest({ ...base, fileName: '' }))).toEqual([
      expect.objectContaining({ path: 'fileName' }),
    ]);
    expect(
      issues(() => parseLetterheadUploadRequest({ ...base, fileName: 'x'.repeat(256) })),
    ).toEqual([expect.objectContaining({ path: 'fileName' })]);
  });
});

describe('parseLabClaimManual', () => {
  it('takes exactly a file id, lower-cased', () => {
    expect(parseLabClaimManual({ fileId: '0190D6A2-7C4E-7A1B-9C3D-000000000000' })).toEqual({
      fileId: '0190d6a2-7c4e-7a1b-9c3d-000000000000',
    });
  });

  it('refuses anything else, naming the field', () => {
    expect(issues(() => parseLabClaimManual({}))).toEqual([
      expect.objectContaining({ path: 'fileId' }),
    ]);
    expect(issues(() => parseLabClaimManual({ fileId: 'x' }))).toEqual([
      expect.objectContaining({ path: 'fileId' }),
    ]);
    expect(
      issues(() =>
        parseLabClaimManual({ fileId: '0190d6a2-7c4e-7a1b-9c3d-000000000000', status: 'X' }),
      ),
    ).toEqual([expect.objectContaining({ path: 'status', code: 'UNKNOWN_FIELD' })]);
  });
});

describe('parsePageQuery', () => {
  it('takes a cursor and a limit of 1 to 100, and nothing else is needed', () => {
    expect(parsePageQuery({})).toEqual({});
    expect(parsePageQuery({ cursor: 'abc', limit: '100' })).toEqual({ cursor: 'abc', limit: 100 });
  });

  it('refuses an empty cursor, a repeated parameter and a limit out of range or not a whole number', () => {
    expect(issues(() => parsePageQuery({ cursor: '' }))).toEqual([
      expect.objectContaining({ path: 'cursor' }),
    ]);
    expect(issues(() => parsePageQuery({ cursor: ['a', 'b'] }))).toEqual([
      expect.objectContaining({ path: 'cursor' }),
    ]);
    for (const limit of ['0', '101', '1.5', '-1', 'ten', '', ['1', '2']]) {
      expect(issues(() => parsePageQuery({ limit }))).toEqual([
        expect.objectContaining({ path: 'limit' }),
      ]);
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
