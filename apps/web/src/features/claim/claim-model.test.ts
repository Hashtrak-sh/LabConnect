import { describe, expect, it } from 'vitest';
import {
  type ClaimRecord,
  checkLetterhead,
  LETTERHEAD_MAX_BYTES,
  MAX_RECORDS,
  readCertificate,
  readClaimCode,
  readJar,
  removeClaim,
  sniffLetterhead,
  startOutcome,
  submitOutcome,
  uploadOutcome,
  upsertClaim,
  verifyOutcome,
  writeJar,
} from './claim-model';

const ID = '01930000-0000-7000-8000-0000000000aa';

function record(overrides: Partial<ClaimRecord> = {}): ClaimRecord {
  return {
    id: ID,
    etag: '"1"',
    status: 'PENDING_OTP',
    method: 'EMAIL_OTP',
    otpSentTo: 's***@***.test',
    siteName: 'DEMO Testing Laboratory 005',
    certificateNo: 'DEMO-TC-0005-1',
    createdAt: '2026-11-27T05:00:00.000Z',
    reviewedAt: null,
    decisionNotes: null,
    ...overrides,
  };
}

describe('start outcomes', () => {
  it('maps every answer the contract documents', () => {
    expect(startOutcome({ status: 401 })).toBe('signed-out');
    expect(startOutcome({ status: 403 })).toBe('staff');
    expect(startOutcome({ status: 422, code: 'VALIDATION_FAILED' })).toBe('not-found');
    expect(startOutcome({ status: 409, currentState: 'CLAIMED' })).toBe('claimed');
    expect(startOutcome({ status: 409, currentState: 'CLAIM_PENDING' })).toBe('other-open');
    expect(startOutcome({ status: 409, currentState: 'PENDING_REVIEW' })).toBe('own-review');
    expect(startOutcome({ status: 409, code: 'REQUEST_IN_PROGRESS' })).toBe('failed');
    expect(startOutcome({ status: 429, retryAfterSeconds: 120 })).toBe('rate-limited');
    expect(startOutcome({ status: 429 })).toBe('cap');
    expect(startOutcome({ status: 500 })).toBe('failed');
  });
});

describe('verify outcomes', () => {
  it('maps wrong, expired, locked, rate limited and the claim having changed', () => {
    expect(verifyOutcome({ status: 422, code: 'OTP_INVALID' })).toBe('code-invalid');
    expect(verifyOutcome({ status: 422, code: 'OTP_EXPIRED' })).toBe('code-expired');
    expect(verifyOutcome({ status: 429, code: 'OTP_LOCKED', retryAfterSeconds: 900 })).toBe(
      'locked',
    );
    expect(verifyOutcome({ status: 429, code: 'RATE_LIMITED' })).toBe('rate-limited');
    expect(verifyOutcome({ status: 412, code: 'CONCURRENT_MODIFICATION' })).toBe('changed');
    expect(verifyOutcome({ status: 409, currentState: 'PENDING_REVIEW' })).toBe('in-review');
    expect(verifyOutcome({ status: 409, currentState: 'EXPIRED' })).toBe('expired');
    expect(verifyOutcome({ status: 409, currentState: 'APPROVED' })).toBe('not-open');
    expect(verifyOutcome({ status: 404 })).toBe('not-found');
    expect(verifyOutcome({ status: 400 })).toBe('failed');
  });
});

describe('upload and submit outcomes', () => {
  it('maps the cap of five uploads apart from a wait', () => {
    expect(uploadOutcome({ status: 429 })).toBe('upload-cap');
    expect(uploadOutcome({ status: 429, retryAfterSeconds: 10 })).toBe('rate-limited');
    expect(uploadOutcome({ status: 422 })).toBe('file-rejected');
    expect(uploadOutcome({ status: 409, currentState: 'EXPIRED' })).toBe('expired');
  });

  it('treats FILE_NOT_CLEAN as "still scanning"', () => {
    expect(submitOutcome({ status: 422, code: 'FILE_NOT_CLEAN' })).toBe('scanning');
    expect(submitOutcome({ status: 422, code: 'VALIDATION_FAILED' })).toBe('failed');
    expect(submitOutcome({ status: 412 })).toBe('changed');
    expect(submitOutcome({ status: 404 })).toBe('not-found');
  });
});

describe('form parsing', () => {
  it('trims a certificate number and refuses empty or over 50 characters', () => {
    expect(readCertificate('  TC-1234 ')).toEqual({ ok: true, value: 'TC-1234' });
    expect(readCertificate('   ')).toEqual({ ok: false });
    expect(readCertificate('x'.repeat(51))).toEqual({ ok: false });
    expect(readCertificate('x'.repeat(50)).ok).toBe(true);
    expect(readCertificate(undefined)).toEqual({ ok: false });
  });

  it('takes six digits with spaces', () => {
    expect(readClaimCode('444 444')).toBe('444444');
    expect(readClaimCode('44444')).toBeNull();
    expect(readClaimCode('4444444')).toBeNull();
    expect(readClaimCode('44444x')).toBeNull();
  });
});

describe('the letterhead limits', () => {
  it('accepts PDF, JPEG and PNG up to exactly 10 MB', () => {
    for (const contentType of ['application/pdf', 'image/jpeg', 'image/png'])
      expect(checkLetterhead({ contentType, sizeBytes: 1000 }).ok).toBe(true);
    expect(
      checkLetterhead({ contentType: 'application/pdf', sizeBytes: LETTERHEAD_MAX_BYTES }).ok,
    ).toBe(true);
  });

  it('refuses one byte over 10 MB, an empty file and other types', () => {
    expect(
      checkLetterhead({ contentType: 'application/pdf', sizeBytes: LETTERHEAD_MAX_BYTES + 1 }),
    ).toEqual({ ok: false, reason: 'size' });
    expect(checkLetterhead({ contentType: 'application/pdf', sizeBytes: 0 })).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(checkLetterhead({ contentType: 'text/html', sizeBytes: 10 })).toEqual({
      ok: false,
      reason: 'type',
    });
    expect(checkLetterhead({ contentType: 'application/pdf', sizeBytes: 1.5 }).ok).toBe(false);
    expect(checkLetterhead({ contentType: 'application/pdf', sizeBytes: '10' }).ok).toBe(false);
  });

  it('recognises a file by its first bytes, so HTML renamed .pdf is not sent', () => {
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(sniffLetterhead(bytes('%PDF-1.7 ...'))).toBe('application/pdf');
    expect(sniffLetterhead(bytes('<html><body>'))).toBeNull();
    expect(sniffLetterhead(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(
      sniffLetterhead(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
    ).toBe('image/png');
    expect(sniffLetterhead(new Uint8Array())).toBeNull();
  });
});

describe('the claims cookie', () => {
  it('round trips a record for the same user', () => {
    const jar = upsertClaim({ userId: 'u1', claims: [] }, record());
    expect(readJar(writeJar(jar), 'u1').claims).toEqual([record()]);
  });

  it("never shows one user's claims to another", () => {
    const jar = upsertClaim({ userId: 'u1', claims: [] }, record());
    expect(readJar(writeJar(jar), 'u2').claims).toEqual([]);
  });

  it('reads garbage, a missing cookie and forged records as nothing', () => {
    expect(readJar(undefined, 'u1').claims).toEqual([]);
    expect(readJar('not json', 'u1').claims).toEqual([]);
    expect(readJar(JSON.stringify({ u: 'u1', c: [{ id: '../x' }] }), 'u1').claims).toEqual([]);
    expect(
      readJar(JSON.stringify({ u: 'u1', c: [{ ...record(), etag: '3' }] }), 'u1').claims,
    ).toEqual([]);
    expect(
      readJar(JSON.stringify({ u: 'u1', c: [{ ...record(), status: 'APPROVED!' }] }), 'u1').claims,
    ).toEqual([]);
  });

  it('puts the newest first, replaces by id, caps the list and removes', () => {
    let jar = { userId: 'u1', claims: [] as ClaimRecord[] };
    for (let n = 0; n < MAX_RECORDS + 2; n++)
      jar = upsertClaim(jar, record({ id: `01930000-0000-7000-8000-00000000000${String(n)}` }));
    expect(jar.claims).toHaveLength(MAX_RECORDS);
    expect(jar.claims[0]?.id.endsWith(String(MAX_RECORDS + 1))).toBe(true);
    const first = jar.claims[0];
    if (first === undefined) throw new Error('unreachable');
    jar = upsertClaim(jar, { ...first, status: 'PENDING_REVIEW' });
    expect(jar.claims).toHaveLength(MAX_RECORDS);
    expect(jar.claims[0]?.status).toBe('PENDING_REVIEW');
    expect(removeClaim(jar, first.id).claims).toHaveLength(MAX_RECORDS - 1);
  });
});
