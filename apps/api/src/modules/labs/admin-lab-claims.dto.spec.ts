import { describe, expect, it } from 'vitest';
import { DomainError } from '../../common/domain-error.js';
import {
  parseClaimApproval,
  parseClaimListQuery,
  parseClaimRejection,
} from './admin-lab-claims.dto.js';

// The request parts of the three Ops claim operations, against the contract schemas
// `AdminClaimApproval`, `AdminClaimRejection` and the list query.

function refusedWith(work: () => unknown): DomainError {
  try {
    work();
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  return expect.fail('expected a DomainError');
}

describe('parseClaimApproval', () => {
  it('takes no notes, empty notes and notes up to 2000 characters', () => {
    expect(parseClaimApproval({})).toEqual({});
    expect(parseClaimApproval({ decisionNotes: '' })).toEqual({ decisionNotes: '' });
    expect(parseClaimApproval({ decisionNotes: 'x'.repeat(2000) })).toEqual({
      decisionNotes: 'x'.repeat(2000),
    });
  });

  it('refuses unknown fields (no organisation, user or reviewer can be sent), wrong types and long notes', () => {
    for (const body of [
      { organisationId: 'x' },
      { reviewedByUserId: 'x' },
      { decisionNotes: 5 },
      { decisionNotes: 'x'.repeat(2001) },
      null,
      [],
      'text',
    ]) {
      const error = refusedWith(() => parseClaimApproval(body));
      expect(error.code, JSON.stringify(body)).toBe('VALIDATION_FAILED');
      expect(error.status).toBe(422);
    }
  });
});

describe('parseClaimRejection', () => {
  it('needs notes of 1 to 2000 characters', () => {
    expect(parseClaimRejection({ decisionNotes: 'No.' })).toEqual({ decisionNotes: 'No.' });
    for (const body of [
      {},
      { decisionNotes: '' },
      { decisionNotes: 'x'.repeat(2001) },
      { decisionNotes: 'ok', status: 'APPROVED' },
      { decisionNotes: null },
    ]) {
      expect(refusedWith(() => parseClaimRejection(body)).code, JSON.stringify(body)).toBe(
        'VALIDATION_FAILED',
      );
    }
  });
});

describe('parseClaimListQuery', () => {
  it('reads status, cursor and limit', () => {
    expect(parseClaimListQuery({})).toEqual({});
    expect(parseClaimListQuery({ status: 'PENDING_REVIEW', cursor: 'abc', limit: '100' })).toEqual({
      status: 'PENDING_REVIEW',
      cursor: 'abc',
      limit: 100,
    });
  });

  it('refuses an unknown or repeated status, an empty cursor and a bad limit', () => {
    for (const query of [
      { status: 'DONE' },
      { status: ['APPROVED', 'REJECTED'] },
      { status: '' },
      { cursor: '' },
      { cursor: ['a', 'b'] },
      { limit: '0' },
      { limit: '101' },
      { limit: '1.5' },
      { limit: '-1' },
      { limit: 'ten' },
      { limit: ['1', '2'] },
    ]) {
      expect(refusedWith(() => parseClaimListQuery(query)).code, JSON.stringify(query)).toBe(
        'VALIDATION_FAILED',
      );
    }
  });
});
