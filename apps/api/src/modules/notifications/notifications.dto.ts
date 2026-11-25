import type { PreferenceItem } from '@labconnect/core';
import { DomainError, type ProblemIssue } from '../../common/domain-error.js';

// Request parts of the four notification operations, checked by hand against the contract
// (`paths/me.yaml`, `components/schemas/me.yaml`): objects have `additionalProperties: false`.

function fail(issues: ProblemIssue[], detail: string): never {
  throw new DomainError('VALIDATION_FAILED', { detail, errors: issues });
}

export interface ListQuery {
  cursor?: string;
  limit?: number;
  unread?: boolean;
}

function single(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : '';
}

/**
 * `cursor`, `limit` (1 to 100) and, for the inbox, `unread` (`true` or `false`) of the query
 * string. A repeated or malformed parameter is `422 VALIDATION_FAILED`. The cursor's content is
 * checked by the inbox, which owns its format.
 */
export function parseListQuery(query: Record<string, unknown>, withUnread: boolean): ListQuery {
  const issues: ProblemIssue[] = [];
  const result: ListQuery = {};

  const cursor = single(query.cursor);
  if (cursor !== undefined) {
    if (cursor === '') {
      issues.push({ path: 'cursor', code: 'INVALID_VALUE', message: 'The cursor is empty.' });
    } else result.cursor = cursor;
  }

  const limit = single(query.limit);
  if (limit !== undefined) {
    const parsed = /^\d{1,4}$/.test(limit) ? Number(limit) : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      issues.push({
        path: 'limit',
        code: 'INVALID_VALUE',
        message: 'The limit is a whole number from 1 to 100.',
      });
    } else result.limit = parsed;
  }

  const unread = single(query.unread);
  if (unread !== undefined) {
    if (!withUnread) {
      issues.push({
        path: 'unread',
        code: 'UNKNOWN_FIELD',
        message: 'This parameter is not allowed.',
      });
    } else if (unread === 'true' || unread === 'false') result.unread = unread === 'true';
    else {
      issues.push({ path: 'unread', code: 'INVALID_VALUE', message: 'Use true or false.' });
    }
  }

  if (issues.length > 0) fail(issues, 'The query is not valid.');
  return result;
}

const CHANNELS = new Set(['EMAIL', 'IN_APP', 'SMS', 'WHATSAPP']);

/** `NotificationPreferencesUpdate`: `{ preferences: [{ eventCode, channel, muted }, ...] }`, 1 to 100 items. */
export function parsePreferencesUpdate(body: unknown): PreferenceItem[] {
  const issues: ProblemIssue[] = [];
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(
      [{ path: '', code: 'INVALID_TYPE', message: 'The body must be a JSON object.' }],
      'The request body is not valid.',
    );
  }
  const object = body as Record<string, unknown>;
  for (const key of Object.keys(object)) {
    if (key !== 'preferences') {
      issues.push({ path: key, code: 'UNKNOWN_FIELD', message: 'This field is not allowed.' });
    }
  }
  const list = object.preferences;
  if (!Array.isArray(list) || list.length < 1 || list.length > 100) {
    issues.push({
      path: 'preferences',
      code: 'INVALID_VALUE',
      message: 'Give 1 to 100 preferences.',
    });
    return fail(issues, 'The request body is not valid.');
  }
  const items: PreferenceItem[] = [];
  list.forEach((entry: unknown, index) => {
    const at = `preferences[${String(index)}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      issues.push({ path: at, code: 'INVALID_TYPE', message: 'Each preference is an object.' });
      return;
    }
    const preference = entry as Record<string, unknown>;
    for (const key of Object.keys(preference)) {
      if (!['eventCode', 'channel', 'muted'].includes(key)) {
        issues.push({
          path: `${at}.${key}`,
          code: 'UNKNOWN_FIELD',
          message: 'This field is not allowed.',
        });
      }
    }
    const { eventCode, channel, muted } = preference;
    if (typeof eventCode !== 'string' || eventCode.length < 1 || eventCode.length > 100) {
      issues.push({
        path: `${at}.eventCode`,
        code: 'INVALID_VALUE',
        message: 'Give an event code of up to 100 characters.',
      });
    }
    if (typeof channel !== 'string' || !CHANNELS.has(channel)) {
      issues.push({
        path: `${at}.channel`,
        code: 'INVALID_VALUE',
        message: 'The channel is EMAIL, IN_APP, SMS or WHATSAPP.',
      });
    }
    if (typeof muted !== 'boolean') {
      issues.push({
        path: `${at}.muted`,
        code: 'INVALID_TYPE',
        message: 'muted is true or false.',
      });
    }
    if (
      typeof eventCode === 'string' &&
      typeof channel === 'string' &&
      typeof muted === 'boolean' &&
      CHANNELS.has(channel)
    ) {
      items.push({ eventCode, channel: channel as PreferenceItem['channel'], muted });
    }
  });
  if (issues.length > 0) fail(issues, 'The request body is not valid.');
  return items;
}
