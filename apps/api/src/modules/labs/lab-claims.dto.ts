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

/**
 * `KycDocumentUploadUrlRequest`: `{ fileName?, contentType, sizeBytes }`. Only the shape is checked
 * here; the allowed types and the 10 MB limit are the `KYC_DOCUMENT` rule of the file service,
 * the one place that knows them (`422 VALIDATION_FAILED` from `LabClaimsService`).
 */
export function parseLetterheadUploadRequest(body: unknown): {
  fileName?: string;
  contentType: string;
  sizeBytes: number;
} {
  const object = asObject(body);
  const issues = noOtherFields(object, ['fileName', 'contentType', 'sizeBytes']);
  const { fileName, contentType, sizeBytes } = object;
  if (
    fileName !== undefined &&
    (typeof fileName !== 'string' || fileName.length < 1 || fileName.length > 255)
  ) {
    issues.push({
      path: 'fileName',
      code: 'INVALID_VALUE',
      message: 'Give the file name, 1 to 255 characters, or leave it out.',
    });
  }
  if (typeof contentType !== 'string' || contentType === '') {
    issues.push({ path: 'contentType', code: 'INVALID_VALUE', message: 'Give the content type.' });
  }
  if (typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    issues.push({
      path: 'sizeBytes',
      code: 'INVALID_VALUE',
      message: 'Give the size in bytes, a whole number of at least 1.',
    });
  }
  if (issues.length > 0) fail(issues);
  return {
    ...(typeof fileName === 'string' && { fileName }),
    contentType: contentType as string,
    sizeBytes: sizeBytes as number,
  };
}

/** `LabClaimManual`: `{ fileId }`, a UUID. */
export function parseLabClaimManual(body: unknown): { fileId: string } {
  const object = asObject(body);
  const issues = noOtherFields(object, ['fileId']);
  const value = object.fileId;
  let fileId = '';
  if (typeof value !== 'string' || !UUID.test(value)) {
    issues.push({ path: 'fileId', code: 'INVALID_VALUE', message: 'Give the file id, a UUID.' });
  } else {
    fileId = value.toLowerCase();
  }
  if (issues.length > 0) fail(issues);
  return { fileId };
}

function single(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : '';
}

/**
 * `cursor` and `limit` (1 to 100) of `listMyLabClaims`. A repeated, empty or malformed parameter
 * is `422 VALIDATION_FAILED`; the cursor's content is checked by the core, which owns its format.
 * No filter and no `status`: the operation lists every claim of the caller, newest first.
 */
export function parsePageQuery(query: Record<string, unknown>): {
  cursor?: string;
  limit?: number;
} {
  const issues: ProblemIssue[] = [];
  const result: { cursor?: string; limit?: number } = {};

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

  if (issues.length > 0) {
    throw new DomainError('VALIDATION_FAILED', {
      detail: 'The query is not valid.',
      errors: issues,
    });
  }
  return result;
}
