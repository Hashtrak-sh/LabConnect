import type { CustomerOrganisationInput, PostalAddressInput } from '@labconnect/core';
import { DomainError, type ProblemIssue } from '../../common/domain-error.js';

// The body of `createCustomerOrganisation` (`CustomerOrganisationCreate`,
// `components/schemas/customer.yaml`), checked by hand against the contract: objects have
// `additionalProperties: false`, and no field names an organisation or a user.

const SEGMENTS = new Set(['INDIVIDUAL', 'BUSINESS', 'INDUSTRY', 'GOVERNMENT']);
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PINCODE = /^[0-9]{6}$/;
const BODY_FIELDS = new Set([
  'customerSegment',
  'legalName',
  'displayName',
  'gstin',
  'registeredAddress',
]);
const ADDRESS_FIELDS = new Set(['line1', 'line2', 'city', 'district', 'stateCode', 'pincode']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A trimmed text of `min` to `max` characters, or `null` with an issue. */
function text(
  value: unknown,
  path: string,
  min: number,
  max: number,
  issues: ProblemIssue[],
): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : null;
  if (trimmed !== null && trimmed.length >= min && trimmed.length <= max) return trimmed;
  issues.push({
    path,
    code: typeof value === 'string' ? 'INVALID_LENGTH' : 'INVALID_TYPE',
    message: `Give ${String(min)} to ${String(max)} characters.`,
  });
  return null;
}

function optionalText(
  value: unknown,
  path: string,
  max: number,
  issues: ProblemIssue[],
): string | null {
  // `undefined`: missing, already reported as REQUIRED.
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return text(value, path, 1, max, issues);
}

function address(raw: unknown, issues: ProblemIssue[]): PostalAddressInput | null {
  if (!isObject(raw)) {
    issues.push({
      path: 'registeredAddress',
      code: 'INVALID_TYPE',
      message: 'registeredAddress is an object.',
    });
    return null;
  }
  for (const field of Object.keys(raw)) {
    if (!ADDRESS_FIELDS.has(field)) {
      issues.push({
        path: `registeredAddress.${field}`,
        code: 'UNKNOWN_FIELD',
        message: 'This field is not allowed.',
      });
    }
  }
  for (const field of ADDRESS_FIELDS) {
    if (!(field in raw)) {
      issues.push({
        path: `registeredAddress.${field}`,
        code: 'REQUIRED',
        message: 'This field is required (null where it may be empty).',
      });
    }
  }
  const line1 = text(raw.line1, 'registeredAddress.line1', 1, 200, issues);
  const line2 = optionalText(raw.line2, 'registeredAddress.line2', 200, issues);
  const city = text(raw.city, 'registeredAddress.city', 1, 100, issues);
  const district = optionalText(raw.district, 'registeredAddress.district', 100, issues);
  const stateCode = text(raw.stateCode, 'registeredAddress.stateCode', 2, 4, issues);
  let pincode: string | null = null;
  if (typeof raw.pincode === 'string' && PINCODE.test(raw.pincode)) pincode = raw.pincode;
  else {
    issues.push({
      path: 'registeredAddress.pincode',
      code: 'INVALID_FORMAT',
      message: 'A PIN code has 6 digits.',
    });
  }
  if (line1 === null || city === null || stateCode === null || pincode === null) return null;
  return { line1, line2, city, district, stateCode: stateCode.toUpperCase(), pincode };
}

/**
 * Checks a `CustomerOrganisationCreate` body. Every problem is reported at once as `422
 * VALIDATION_FAILED` with the field named; a non-object body is the same. GSTIN is required for
 * every segment but `INDIVIDUAL` (FR-ONB-01).
 */
export function parseCustomerOrganisationCreate(body: unknown): CustomerOrganisationInput {
  const issues: ProblemIssue[] = [];
  if (!isObject(body)) {
    throw new DomainError('VALIDATION_FAILED', {
      detail: 'The body is a JSON object.',
      errors: [{ path: '', code: 'INVALID_TYPE', message: 'The body is a JSON object.' }],
    });
  }
  for (const field of Object.keys(body)) {
    if (!BODY_FIELDS.has(field)) {
      issues.push({ path: field, code: 'UNKNOWN_FIELD', message: 'This field is not allowed.' });
    }
  }

  const segment = body.customerSegment;
  if (typeof segment !== 'string' || !SEGMENTS.has(segment)) {
    issues.push({
      path: 'customerSegment',
      code: segment === undefined ? 'REQUIRED' : 'INVALID_VALUE',
      message: 'The segment is INDIVIDUAL, BUSINESS, INDUSTRY or GOVERNMENT.',
    });
  }
  const legalName = text(body.legalName, 'legalName', 1, 200, issues);
  const displayName = text(body.displayName, 'displayName', 1, 100, issues);

  let gstin: string | undefined;
  if (body.gstin !== undefined) {
    if (typeof body.gstin === 'string' && GSTIN.test(body.gstin)) gstin = body.gstin;
    else {
      issues.push({
        path: 'gstin',
        code: 'INVALID_FORMAT',
        message: 'A GSTIN has 15 characters in upper case, for example 09AAAAA0000A1Z5.',
      });
    }
  } else if (typeof segment === 'string' && segment !== 'INDIVIDUAL' && SEGMENTS.has(segment)) {
    issues.push({
      path: 'gstin',
      code: 'REQUIRED',
      message: 'An organisation needs a GSTIN; it is optional only for an individual.',
    });
  }

  const registeredAddress =
    body.registeredAddress === undefined ? undefined : address(body.registeredAddress, issues);

  if (issues.length > 0 || legalName === null || displayName === null) {
    throw new DomainError('VALIDATION_FAILED', {
      detail: 'Some fields are missing or not valid.',
      errors: issues,
    });
  }
  return {
    customerSegment: segment as CustomerOrganisationInput['customerSegment'],
    legalName,
    displayName,
    ...(gstin !== undefined && { gstin }),
    ...(registeredAddress !== undefined && registeredAddress !== null && { registeredAddress }),
  };
}
