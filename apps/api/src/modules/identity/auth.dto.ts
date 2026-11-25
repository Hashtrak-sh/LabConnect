import { isPlausibleEmail, normaliseEmail } from '@labconnect/core';
import { DomainError, type ProblemIssue } from '../../common/domain-error.js';

// Request bodies of the identity operations, checked by hand against the contract schemas
// (`components/schemas/auth.yaml`, `me.yaml`): every object has `additionalProperties: false`.

function fail(issues: ProblemIssue[]): never {
  throw new DomainError('VALIDATION_FAILED', {
    detail: 'The request body is not valid.',
    errors: issues,
  });
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail([{ path: '', code: 'INVALID_TYPE', message: 'The body must be a JSON object.' }]);
  }
  return body as Record<string, unknown>;
}

function noOtherFields(
  object: Record<string, unknown>,
  allowed: readonly string[],
): ProblemIssue[] {
  return Object.keys(object)
    .filter((key) => !allowed.includes(key))
    .map((key) => ({ path: key, code: 'UNKNOWN_FIELD', message: 'This field is not allowed.' }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function emailField(object: Record<string, unknown>, issues: ProblemIssue[]): string {
  const value = object.email;
  if (typeof value !== 'string' || !isPlausibleEmail(value.trim())) {
    issues.push({ path: 'email', code: 'INVALID_EMAIL', message: 'Give a valid email address.' });
    return '';
  }
  return normaliseEmail(value);
}

function codeField(object: Record<string, unknown>, issues: ProblemIssue[]): string {
  const value = object.code;
  if (typeof value !== 'string' || !/^[0-9]{6}$/.test(value)) {
    issues.push({ path: 'code', code: 'INVALID_CODE', message: 'The code is 6 digits.' });
    return '';
  }
  return value;
}

/** `OtpRequest`: `{ email, purpose: 'LOGIN' }`. */
export function parseOtpRequest(body: unknown): { email: string } {
  const object = asObject(body);
  const issues = noOtherFields(object, ['email', 'purpose']);
  const email = emailField(object, issues);
  if (object.purpose !== 'LOGIN') {
    issues.push({ path: 'purpose', code: 'INVALID_VALUE', message: 'The purpose must be LOGIN.' });
  }
  if (issues.length > 0) fail(issues);
  return { email };
}

/** `OtpVerifyRequest`: `{ email, code }`. */
export function parseOtpVerify(body: unknown): { email: string; code: string } {
  const object = asObject(body);
  const issues = noOtherFields(object, ['email', 'code']);
  const email = emailField(object, issues);
  const code = codeField(object, issues);
  if (issues.length > 0) fail(issues);
  return { email, code };
}

/** `MfaCodeRequest`: `{ code }`. */
export function parseMfaCode(body: unknown): { code: string } {
  const object = asObject(body);
  const issues = noOtherFields(object, ['code']);
  const code = codeField(object, issues);
  if (issues.length > 0) fail(issues);
  return { code };
}

/** `ActiveMembershipRequest`: `{ membershipId }`. */
export function parseActiveMembership(body: unknown): { membershipId: string } {
  const object = asObject(body);
  const issues = noOtherFields(object, ['membershipId']);
  if (!isUuid(object.membershipId)) {
    issues.push({ path: 'membershipId', code: 'INVALID_UUID', message: 'Give a membership id.' });
  }
  if (issues.length > 0) fail(issues);
  return { membershipId: String(object.membershipId) };
}
