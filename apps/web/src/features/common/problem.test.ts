import { describe, expect, it } from 'vitest';
import { cleanEtag, etagOf, formKey, isUuid, readProblem, retryAfterSeconds } from './problem';

const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

describe('readProblem', () => {
  it('takes code, currentState and reason from the envelope', () => {
    const problem = readProblem(
      { status: 409, headers: headers({}) },
      { code: 'INVALID_STATE_TRANSITION', meta: { currentState: 'CLAIMED' }, detail: 'secret' },
    );
    expect(problem).toEqual({
      status: 409,
      code: 'INVALID_STATE_TRANSITION',
      currentState: 'CLAIMED',
    });
  });

  it('reads Retry-After as seconds and ignores anything else', () => {
    expect(retryAfterSeconds('30')).toBe(30);
    expect(retryAfterSeconds('0')).toBeUndefined();
    expect(retryAfterSeconds('Wed, 21 Oct 2026 07:28:00 GMT')).toBeUndefined();
    expect(retryAfterSeconds(null)).toBeUndefined();
    expect(readProblem({ status: 429, headers: headers({ 'retry-after': '90' }) }, {})).toEqual({
      status: 429,
      retryAfterSeconds: 90,
    });
  });

  it('survives a body that is not an envelope', () => {
    expect(readProblem({ status: 500, headers: headers({}) }, null)).toEqual({ status: 500 });
    expect(readProblem({ status: 500, headers: headers({}) }, 'oops')).toEqual({ status: 500 });
  });
});

describe('etags and ids', () => {
  it('formats and accepts only strong digit etags', () => {
    expect(etagOf(3)).toBe('"3"');
    expect(cleanEtag('"3"')).toBe('"3"');
    for (const bad of ['3', 'W/"3"', '"3", "4"', '"-1"', '', undefined, 3, '"1a"'])
      expect(cleanEtag(bad)).toBeNull();
  });

  it('recognises UUIDs', () => {
    expect(isUuid('01930000-0000-7000-8000-0000000000aa')).toBe(true);
    expect(isUuid('../admin')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe('form keys', () => {
  it('uses the key the server rendered into the form, so a double submit is one operation', () => {
    const key = '01930000-0000-7000-8000-0000000000aa';
    expect(formKey(key)).toBe(key);
    expect(formKey(key)).toBe(formKey(key));
  });

  it('makes a fresh key when the field is missing or not a UUID', () => {
    expect(isUuid(formKey(undefined))).toBe(true);
    expect(isUuid(formKey('not-a-key'))).toBe(true);
    expect(formKey(undefined)).not.toBe(formKey(undefined));
  });
});
