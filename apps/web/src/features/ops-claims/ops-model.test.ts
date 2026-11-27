import { describe, expect, it } from 'vitest';
import {
  type AdminClaim,
  approvalNotes,
  decisionOutcome,
  downloadOutcome,
  findClaim,
  isFollowableUrl,
  readRejectReason,
  readStatusFilter,
  rejectionNotes,
} from './ops-model';

function claim(id: string): AdminClaim {
  return {
    id,
    organisationId: 'o',
    labSiteId: 's',
    requestedByUserId: 'u',
    method: 'EMAIL_OTP',
    status: 'PENDING_REVIEW',
    authorisationFileId: null,
    reviewedByUserId: null,
    reviewedAt: null,
    decisionNotes: null,
    createdAt: '2026-11-27T05:00:00.000Z',
    lockVersion: 2,
  };
}

describe('decision outcomes', () => {
  it('maps the refused states the Ops screens show', () => {
    expect(decisionOutcome({ status: 403, code: 'FORBIDDEN' })).toBe('forbidden');
    expect(decisionOutcome({ status: 412, code: 'CONCURRENT_MODIFICATION' })).toBe('changed');
    expect(decisionOutcome({ status: 409, code: 'INVALID_STATE_TRANSITION' })).toBe(
      'already-decided',
    );
    expect(decisionOutcome({ status: 409, code: 'REQUEST_IN_PROGRESS' })).toBe('busy');
    expect(decisionOutcome({ status: 404 })).toBe('not-found');
    expect(decisionOutcome({ status: 401 })).toBe('signed-out');
    expect(decisionOutcome({ status: 429 })).toBe('rate-limited');
    expect(decisionOutcome({ status: 500 })).toBe('failed');
  });

  it('maps the 422 reasons of the review', () => {
    expect(decisionOutcome({ status: 422, code: 'FILE_NOT_CLEAN' })).toBe('file-not-clean');
    expect(decisionOutcome({ status: 422, reason: 'LETTERHEAD_MISSING' })).toBe(
      'letterhead-missing',
    );
    expect(decisionOutcome({ status: 422, reason: 'DECISION_NOTES_REQUIRED' })).toBe(
      'notes-required',
    );
    for (const reason of [
      'CLAIMANT_NOT_ACTIVE',
      'CLAIMANT_IS_PLATFORM_STAFF',
      'CLAIMANT_HOLDS_LAB_ROLE',
      'CLAIMANT_ALREADY_MEMBER',
    ])
      expect(decisionOutcome({ status: 422, reason })).toBe('claimant-blocked');
    expect(decisionOutcome({ status: 422, code: 'VALIDATION_FAILED' })).toBe('failed');
  });
});

describe('download outcomes', () => {
  it('tells apart no letterhead, a file still being scanned and a refusal', () => {
    expect(downloadOutcome({ status: 404 })).toBe('no-letterhead');
    expect(downloadOutcome({ status: 422, code: 'FILE_NOT_CLEAN' })).toBe('not-clean');
    expect(downloadOutcome({ status: 403 })).toBe('forbidden');
    expect(downloadOutcome({ status: 429 })).toBe('rate-limited');
  });

  it('follows only http and https links', () => {
    expect(isFollowableUrl('https://files.example.test/x?sig=1')).toBe(true);
    expect(isFollowableUrl('http://localhost:4566/bucket/key')).toBe(true);
    expect(isFollowableUrl('javascript:alert(1)')).toBe(false);
    expect(isFollowableUrl('data:text/html,hi')).toBe(false);
    expect(isFollowableUrl('/relative')).toBe(false);
    expect(isFollowableUrl(undefined)).toBe(false);
  });
});

describe('the list and its filter', () => {
  it('reads one of the five statuses and otherwise means all', () => {
    expect(readStatusFilter('PENDING_REVIEW')).toBe('PENDING_REVIEW');
    expect(readStatusFilter(['APPROVED', 'REJECTED'])).toBe('APPROVED');
    expect(readStatusFilter('pending_review')).toBeNull();
    expect(readStatusFilter('DROP TABLE')).toBeNull();
    expect(readStatusFilter(undefined)).toBeNull();
  });

  it('walks the pages until it finds the claim', async () => {
    const pages: Record<string, { data: AdminClaim[]; nextCursor: string | null }> = {
      start: { data: [claim('a'), claim('b')], nextCursor: 'c1' },
      c1: { data: [claim('c')], nextCursor: 'c2' },
      c2: { data: [claim('d')], nextCursor: null },
    };
    const seen: (string | null)[] = [];
    const fetchPage = (cursor: string | null) => {
      seen.push(cursor);
      return Promise.resolve(pages[cursor ?? 'start'] ?? null);
    };
    expect((await findClaim(fetchPage, 'c'))?.id).toBe('c');
    expect(seen).toEqual([null, 'c1']);
    expect(await findClaim(fetchPage, 'zzz')).toBeNull();
  });

  it('stops after the page limit and when a page cannot be read', async () => {
    let calls = 0;
    const endless = () => {
      calls++;
      return Promise.resolve({ data: [claim('a')], nextCursor: 'more' });
    };
    expect(await findClaim(endless, 'nope', 3)).toBeNull();
    expect(calls).toBe(3);
    expect(await findClaim(() => Promise.resolve(null), 'a')).toBeNull();
  });
});

describe('notes', () => {
  it('requires notes on a rejection and writes the reason first', () => {
    expect(rejectionNotes(null, '   ')).toEqual({ ok: false, reason: 'notes-required' });
    expect(rejectionNotes(null, undefined)).toEqual({ ok: false, reason: 'notes-required' });
    expect(rejectionNotes(null, ' Please re-upload ')).toEqual({
      ok: true,
      value: 'Please re-upload',
    });
    expect(rejectionNotes('Letter not signed', 'Sign it')).toEqual({
      ok: true,
      value: 'Letter not signed: Sign it',
    });
  });

  it('refuses notes that would pass 2000 characters with the reason', () => {
    expect(rejectionNotes(null, 'x'.repeat(2000)).ok).toBe(true);
    expect(rejectionNotes('Reason', 'x'.repeat(2000))).toEqual({ ok: false, reason: 'too-long' });
  });

  it('knows the reasons of the board and the optional approval note', () => {
    expect(readRejectReason('signature')).toBe('signature');
    expect(readRejectReason('anything else')).toBeNull();
    expect(approvalNotes('')).toBeUndefined();
    expect(approvalNotes('  ok ')).toBe('ok');
    expect(approvalNotes('x'.repeat(2001))).toBeNull();
  });
});
