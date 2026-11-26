import { DomainError, type ProblemIssue } from '../../common/domain-error.js';

// Request bodies of the lab claim operations, checked by hand against the contract schemas
// `LabClaimCreate` and `LabClaimOtpVerify` (`components/schemas/lab-onboarding.yaml`): both are
// `additionalProperties: false`. There is deliberately no field for an address or an organisation:
// the code goes only to the NABL-imported address, and the organisation comes from the
// certificate number (AUTHENTICATION_AND_AUTHORISATION.md section 5, TENANT_ISOLATION section 2).

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

/** A path id that is not a UUID is `422 VALIDATION_FAILED` (API_CONVENTIONS section 2). */
export function requireClaimId(id: string): string {
  if (UUID.test(id)) return id.toLowerCase();
  throw new DomainError('VALIDATION_FAILED', {
    detail: 'The claim id is not valid.',
    errors: [{ path: 'id', code: 'INVALID_VALUE', message: 'Give a UUID.' }],
  });
}

/** `LabClaimCreate`: `{ certificateNo }`, 1 to 50 characters. */
export function parseLabClaimCreate(body: unknown): { certificateNo: string } {
  const object = asObject(body);
  const issues = noOtherFields(object, ['certificateNo']);
  const value = object.certificateNo;
  let certificateNo = '';
  if (typeof value !== 'string' || value.length < 1 || value.length > 50) {
    issues.push({
      path: 'certificateNo',
      code: 'INVALID_VALUE',
      message: 'Give the certificate number, 1 to 50 characters.',
    });
  } else {
    certificateNo = value.trim();
    if (certificateNo === '') {
      issues.push({
        path: 'certificateNo',
        code: 'INVALID_VALUE',
        message: 'Give the certificate number, 1 to 50 characters.',
      });
    }
  }
  if (issues.length > 0) fail(issues);
  return { certificateNo };
}

/** `LabClaimOtpVerify`: `{ code }`, 6 digits. */
export function parseLabClaimOtpVerify(body: unknown): { code: string } {
  const object = asObject(body);
  const issues = noOtherFields(object, ['code']);
  const value = object.code;
  let code = '';
  if (typeof value !== 'string' || !/^[0-9]{6}$/.test(value)) {
    issues.push({ path: 'code', code: 'INVALID_CODE', message: 'The code is 6 digits.' });
  } else {
    code = value;
  }
  if (issues.length > 0) fail(issues);
  return { code };
}
