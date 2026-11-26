import { BadRequestException } from '@nestjs/common';
import { DomainError } from './domain-error.js';

// ETag and If-Match for aggregates (API_CONVENTIONS.md section 4): the `ETag` of an aggregate is
// `"<lockVersion>"` and a command that changes it sends that value back in `If-Match`.
//
// Shared by both developers' modules, so it stays small:
// - `formatEtag(lockVersion)` for the response header;
// - `parseIfMatch(header)` for the request header: one strong ETag of this form, else `400`
//   (the header is required by the contract's `IfMatch` parameter, which also fixes the pattern
//   `"<digits>"`; ERROR_HANDLING has no 428 and the contract documents none, OQ-209);
// - `assertIfMatch(ifMatch, current)` for a handler that compares in application code: `412
//   CONCURRENT_MODIFICATION`.
//
// The comparison is only a fast, early refusal. The write itself must carry the version in its
// `WHERE` (`UPDATE ... WHERE id = ? AND lock_version = ?` and `lock_version = lock_version + 1`
// in the same statement), so two simultaneous commands cannot both win.

const IF_MATCH = /^"(0|[1-9][0-9]{0,9})"$/;

/** The `ETag` value of a lock version: `"3"`. */
export function formatEtag(lockVersion: number): string {
  if (!Number.isSafeInteger(lockVersion) || lockVersion < 0) {
    throw new RangeError('A lock version is a non-negative integer.');
  }
  return `"${String(lockVersion)}"`;
}

/**
 * The lock version in an `If-Match` header. A missing header, a list, a weak validator
 * (`W/"3"`), `*` or anything but `"<digits>"` is `400`: the command cannot be checked.
 */
export function parseIfMatch(header: string | string[] | undefined): number {
  if (typeof header !== 'string') {
    throw new BadRequestException('If-Match is required and must be one ETag.');
  }
  const match = IF_MATCH.exec(header.trim());
  if (match?.[1] === undefined) {
    throw new BadRequestException('If-Match must be an ETag of the form "<version>".');
  }
  return Number(match[1]);
}

/** `412 CONCURRENT_MODIFICATION` unless the version the client read is the current one. */
export function assertIfMatch(ifMatch: number, currentLockVersion: number): void {
  if (ifMatch !== currentLockVersion) {
    throw new DomainError('CONCURRENT_MODIFICATION', {
      detail: 'The resource changed since it was read. Read it again and retry.',
    });
  }
}
