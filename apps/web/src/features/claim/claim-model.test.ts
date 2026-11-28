import { describe, expect, it } from 'vitest';
import {
  checkLetterhead,
  mayReadClaims,
  readCertificate,
  readClaimCode,
  readFailure,
  readReloadNotice,
  reasonForClaimant,
  reloadFor,
  sniffLetterhead,
  startOutcome,
  submitOutcome,
  uploadOutcome,
  verifyOutcome,
} from './claim-model';

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
      checkLetterhead({ contentType: 'application/pdf', sizeBytes: 10 * 1024 * 1024 }).ok,
    ).toBe(true);
  });

  it('refuses a 50 MB file, one byte over 10 MB, an empty file and other types', () => {
    expect(
      checkLetterhead({ contentType: 'application/pdf', sizeBytes: 50 * 1024 * 1024 }),
    ).toEqual({
      ok: false,
      reason: 'size',
    });
    expect(
      checkLetterhead({ contentType: 'application/pdf', sizeBytes: 10 * 1024 * 1024 + 1 }),
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

describe('reading the claims', () => {
  it('says what a refused read means', () => {
    expect(readFailure(401, 'one')).toBe('signed-out');
    expect(readFailure(403, 'list')).toBe('staff');
    expect(readFailure(404, 'one')).toBe('not-found');
    expect(readFailure(422, 'one')).toBe('not-found');
    expect(readFailure(422, 'list')).toBe('bad-page');
  });

  it('never words a service that does not answer as "not found" or "no claims"', () => {
    for (const status of [500, 502, 503, 504, 429, undefined]) {
      expect(readFailure(status, 'one')).toBe('unavailable');
      expect(readFailure(status, 'list')).toBe('unavailable');
    }
  });

  it('does not call the claimant reads for platform staff', () => {
    expect(mayReadClaims({ memberships: [{ orgType: 'PLATFORM' }] })).toBe(false);
    expect(mayReadClaims({ memberships: [{ orgType: 'CUSTOMER' }, { orgType: 'PLATFORM' }] })).toBe(
      false,
    );
    expect(mayReadClaims({ memberships: [{ orgType: 'CUSTOMER' }, { orgType: 'LAB' }] })).toBe(
      true,
    );
    expect(mayReadClaims({ memberships: [] })).toBe(true);
  });
});

describe('the reason shown to the claimant', () => {
  it('is the rejection reason, as text, and only for a rejected claim', () => {
    expect(
      reasonForClaimant({ status: 'REJECTED', decisionNotes: 'Upload a signed letter.' }),
    ).toBe('Upload a signed letter.');
    expect(reasonForClaimant({ status: 'REJECTED', decisionNotes: '  ok  ' })).toBe('ok');
  });

  it('never shows approval notes, even if the API were to send them', () => {
    for (const status of ['PENDING_OTP', 'PENDING_REVIEW', 'APPROVED', 'EXPIRED'] as const)
      expect(reasonForClaimant({ status, decisionNotes: 'Internal: looks fine' })).toBeNull();
  });

  it('keeps HTML, line breaks and a link as plain characters and cuts only the absurd', () => {
    const html = '<img src=x onerror=alert(1)>\nSee https://example.test/a?b=1&c=2';
    expect(reasonForClaimant({ status: 'REJECTED', decisionNotes: html })).toBe(html);
    const long = 'x'.repeat(2000);
    expect(reasonForClaimant({ status: 'REJECTED', decisionNotes: long })).toBe(long);
    const absurd = reasonForClaimant({ status: 'REJECTED', decisionNotes: 'y'.repeat(9000) });
    expect(absurd?.length).toBe(4001);
    expect(absurd?.endsWith('…')).toBe(true);
  });

  it('is nothing for a blank or missing reason', () => {
    expect(reasonForClaimant({ status: 'REJECTED', decisionNotes: '   ' })).toBeNull();
    expect(reasonForClaimant({ status: 'REJECTED', decisionNotes: null })).toBeNull();
  });
});

describe('reloading a claim after a form', () => {
  it('reloads from the API on a changed version or a claim in another state', () => {
    expect(reloadFor('changed')).toBe('changed');
    for (const outcome of [
      'in-review',
      'own-review',
      'expired',
      'not-open',
      'claimed',
      'not-found',
    ] as const)
      expect(reloadFor(outcome)).toBe('moved');
  });

  it('leaves the answers about the form itself on the form', () => {
    for (const outcome of [
      'code-invalid',
      'code-expired',
      'locked',
      'rate-limited',
      'scanning',
      'failed',
    ] as const)
      expect(reloadFor(outcome)).toBeNull();
  });

  it('reads the notice from the address and nothing else', () => {
    expect(readReloadNotice('changed')).toBe('changed');
    expect(readReloadNotice(['moved', 'changed'])).toBe('moved');
    expect(readReloadNotice('<script>')).toBeNull();
    expect(readReloadNotice(undefined)).toBeNull();
  });
});
