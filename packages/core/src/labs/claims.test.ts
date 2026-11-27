import { describe, expect, it } from 'vitest';
import { claimOtpFailure, LabClaimError } from './claim-errors.js';
import { CLAIM_LIMITS } from './claim-limits.js';
import { claimantDecisionNotes, maskEmail } from './claims.js';

describe('claimantDecisionNotes', () => {
  it('passes on the reason of a rejection and nothing else, whatever the reviewer wrote', () => {
    expect(claimantDecisionNotes('REJECTED', 'The letterhead is not the lab’s.')).toBe(
      'The letterhead is not the lab’s.',
    );
    for (const status of ['PENDING_OTP', 'PENDING_REVIEW', 'APPROVED', 'EXPIRED'] as const) {
      expect(claimantDecisionNotes(status, 'INTERNAL remark')).toBeNull();
    }
    expect(claimantDecisionNotes('REJECTED', null)).toBeNull();
  });
});

describe('maskEmail', () => {
  it('shows the first character of the local part and the top-level domain only', () => {
    expect(maskEmail('lab@example.in')).toBe('l***@***.in');
    expect(maskEmail('Quality.Head@Lab.Example.CO.IN')).toBe('Q***@***.in');
    expect(maskEmail('x@y.z')).toBe('x***@***.z');
    expect(maskEmail('ünïcode@exämple.org')).toBe('ü***@***.org');
  });

  it('reveals no length and no domain name', () => {
    expect(maskEmail('a@b.in')).toBe(maskEmail('a-very-long-local-part@a-very-long-domain.in'));
    const masked = maskEmail('secret.person@private-lab.example.test');
    expect(masked).toBe('s***@***.test');
    for (const leaked of ['ecret', 'person', 'private', 'lab', 'example']) {
      expect(masked).not.toContain(leaked);
    }
  });

  it('shows nothing of a malformed value', () => {
    expect(maskEmail('')).toBe('***@***');
    expect(maskEmail('no-at-sign')).toBe('***@***');
    expect(maskEmail('@nolocal.in')).toBe('***@***');
    expect(maskEmail('a@localhost')).toBe('a***@***');
    expect(maskEmail('a@trailing.')).toBe('a***@***');
  });
});

describe('claimOtpFailure', () => {
  it('maps each rejected code to its catalogued error', () => {
    expect(claimOtpFailure('INVALID')).toMatchObject({ code: 'OTP_INVALID', status: 422 });
    expect(claimOtpFailure('EXPIRED')).toMatchObject({ code: 'OTP_EXPIRED', status: 422 });
    expect(claimOtpFailure('LOCKED')).toMatchObject({ code: 'OTP_LOCKED', status: 429 });
    expect(claimOtpFailure('INVALID')).toBeInstanceOf(LabClaimError);
    expect(claimOtpFailure('CLAIM_EXPIRED')).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      status: 409,
      meta: { currentState: 'EXPIRED' },
    });
  });

  it('keeps the three limits decided by the product owner on 2026-11-26', () => {
    expect(CLAIM_LIMITS).toEqual({
      unverifiedClaimTtlMs: 24 * 3_600_000,
      maxOpenClaimsPerUser: 3,
      maxLetterheadUploadsPerClaim: 5,
    });
  });
});
