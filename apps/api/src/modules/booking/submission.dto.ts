import type { EditBookingInput, SubmitBookingInput, TrfInput } from '@labconnect/core';
import { validateTrfForm } from '@labconnect/validation';
import { DomainError, type ProblemIssue } from '../../common/domain-error.js';

// Bodies of the booking writes and pre-checks (`paths/bookings.yaml`: estimate, duplicate-check,
// createBooking, updateBooking), checked by hand against the contract. The TRF form is checked
// with its schema version from `packages/validation` (trf.v1). No field names an organisation.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Body = Record<string, unknown>;

const isRecord = (value: unknown): value is Body =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function fail(issues: ProblemIssue[]): never {
  throw new DomainError('VALIDATION_FAILED', {
    detail: 'Some fields are missing or not valid.',
    errors: issues,
  });
}

function object(body: unknown): Body {
  if (!isRecord(body)) fail([{ path: '', code: 'INVALID_TYPE', message: 'Send a JSON object.' }]);
  return body;
}

function unknownFields(body: Body, allowed: readonly string[], issues: ProblemIssue[]): void {
  for (const field of Object.keys(body)) {
    if (!allowed.includes(field)) {
      issues.push({ path: field, code: 'UNKNOWN_FIELD', message: 'This field is not allowed.' });
    }
  }
}

function uuid(
  body: Body,
  field: string,
  issues: ProblemIssue[],
  required = true,
): string | undefined {
  const value = body[field];
  if (value === undefined && !required) return undefined;
  if (typeof value === 'string' && UUID.test(value)) return value.toLowerCase();
  issues.push({
    path: field,
    code: value === undefined ? 'REQUIRED' : 'INVALID_VALUE',
    message: 'Give a UUID.',
  });
  return undefined;
}

function date(
  body: Body,
  field: string,
  issues: ProblemIssue[],
  required = true,
): string | undefined {
  const value = body[field];
  if (value === undefined && !required) return undefined;
  if (
    typeof value === 'string' &&
    DATE.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    // A real calendar date: 2026-02-31 does not round-trip.
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  ) {
    return value;
  }
  issues.push({
    path: field,
    code: value === undefined ? 'REQUIRED' : 'INVALID_VALUE',
    message: 'A date (YYYY-MM-DD).',
  });
  return undefined;
}

function text(body: Body, field: string, max: number, issues: ProblemIssue[]): string | undefined {
  const value = body[field];
  if (typeof value === 'string' && value.trim() !== '' && value.length <= max) return value.trim();
  issues.push({
    path: field,
    code: value === undefined ? 'REQUIRED' : 'INVALID_VALUE',
    message: `1 to ${String(max)} characters.`,
  });
  return undefined;
}

function packageCount(body: Body, issues: ProblemIssue[], required = true): number | undefined {
  const value = body.declaredPackageCount;
  if (value === undefined && !required) return undefined;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 50)
    return value;
  issues.push({
    path: 'declaredPackageCount',
    code: value === undefined ? 'REQUIRED' : 'INVALID_VALUE',
    message: 'A whole number from 1 to 50.',
  });
  return undefined;
}

/** `BookingLineRefs`: 1 to 100 `{ scopeLineId }`, each once. */
function lines(body: Body, issues: ProblemIssue[], required = true): string[] | undefined {
  const value = body.lines;
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    issues.push({
      path: 'lines',
      code: value === undefined ? 'REQUIRED' : 'INVALID_VALUE',
      message: 'One to 100 tests.',
    });
    return undefined;
  }
  const ids: string[] = [];
  value.forEach((item: unknown, index) => {
    const path = `lines[${String(index)}]`;
    if (!isRecord(item) || Object.keys(item).some((key) => key !== 'scopeLineId')) {
      issues.push({ path, code: 'INVALID_VALUE', message: 'An object with scopeLineId only.' });
      return;
    }
    const id = item.scopeLineId;
    if (typeof id !== 'string' || !UUID.test(id)) {
      issues.push({ path: `${path}.scopeLineId`, code: 'INVALID_VALUE', message: 'Give a UUID.' });
      return;
    }
    if (ids.includes(id.toLowerCase())) {
      issues.push({
        path: `${path}.scopeLineId`,
        code: 'DUPLICATE',
        message: 'A test may appear once.',
      });
      return;
    }
    ids.push(id.toLowerCase());
  });
  return ids;
}

/** `BookingTrfInput`, with `form` checked against its schema version. */
function trf(body: Body, issues: ProblemIssue[], required = true): TrfInput | undefined {
  const value = body.trf;
  if (value === undefined && !required) return undefined;
  if (!isRecord(value)) {
    issues.push({
      path: 'trf',
      code: value === undefined ? 'REQUIRED' : 'INVALID_TYPE',
      message: 'The test request form.',
    });
    return undefined;
  }
  const unknown: ProblemIssue[] = [];
  unknownFields(value, ['schemaVersion', 'form', 'conformityRequired', 'decisionRule'], unknown);
  issues.push(...unknown.map((issue) => ({ ...issue, path: `trf.${issue.path}` })));
  const { schemaVersion, form, conformityRequired, decisionRule } = value;
  if (typeof schemaVersion !== 'string' || !/^trf\.v[0-9]+$/.test(schemaVersion)) {
    issues.push({
      path: 'trf.schemaVersion',
      code: 'INVALID_VALUE',
      message: 'A form version such as trf.v1.',
    });
  }
  if (typeof conformityRequired !== 'boolean') {
    issues.push({ path: 'trf.conformityRequired', code: 'REQUIRED', message: 'true or false.' });
  }
  if (
    decisionRule !== undefined &&
    decisionRule !== null &&
    (typeof decisionRule !== 'string' || decisionRule.length > 2000)
  ) {
    issues.push({
      path: 'trf.decisionRule',
      code: 'INVALID_VALUE',
      message: 'At most 2000 characters.',
    });
  }
  if (typeof schemaVersion !== 'string') return undefined;
  const checked = validateTrfForm(schemaVersion, form);
  if (!checked.ok) {
    for (const issue of checked.issues) {
      issues.push(
        checked.versionUnknown === true
          ? { path: 'trf.schemaVersion', code: 'INVALID_VALUE', message: 'Unknown form version.' }
          : {
              path: `trf.form${issue.path === '' ? '' : `.${issue.path}`}`,
              code: 'INVALID_VALUE',
              message: issue.message,
            },
      );
    }
    return undefined;
  }
  if (typeof conformityRequired !== 'boolean') return undefined;
  return {
    schemaVersion,
    form: checked.form,
    conformityRequired,
    decisionRule:
      typeof decisionRule === 'string' && decisionRule.trim() !== '' ? decisionRule.trim() : null,
  };
}

export function parseEstimate(raw: unknown): {
  labSiteId: string;
  scopeLineIds: string[];
  slotId?: string;
} {
  const body = object(raw);
  const issues: ProblemIssue[] = [];
  unknownFields(body, ['labSiteId', 'lines', 'slotId'], issues);
  const labSiteId = uuid(body, 'labSiteId', issues);
  const scopeLineIds = lines(body, issues);
  const slotId = uuid(body, 'slotId', issues, false);
  if (issues.length > 0 || labSiteId === undefined || scopeLineIds === undefined) fail(issues);
  return { labSiteId, scopeLineIds, ...(slotId === undefined ? {} : { slotId }) };
}

export function parseDuplicateCheck(raw: unknown): {
  itemName: string;
  batchNo: string;
  scopeLineIds: string[];
} {
  const body = object(raw);
  const issues: ProblemIssue[] = [];
  unknownFields(body, ['itemName', 'batchNo', 'lines'], issues);
  const itemName = text(body, 'itemName', 200, issues);
  const batchNo = text(body, 'batchNo', 100, issues);
  const scopeLineIds = lines(body, issues);
  if (
    issues.length > 0 ||
    itemName === undefined ||
    batchNo === undefined ||
    scopeLineIds === undefined
  )
    fail(issues);
  return { itemName, batchNo, scopeLineIds };
}

/**
 * `BookingCreate`. `onBehalfOf` (Ops booking for a customer) is not built yet: 403, as the
 * contract answers it from any membership but Platform Ops (decided 2026-11-29).
 */
export function parseBookingCreate(raw: unknown): SubmitBookingInput {
  const body = object(raw);
  if (body.onBehalfOf !== undefined) {
    throw new DomainError('FORBIDDEN', {
      detail: 'Booking on behalf of a customer is not available yet.',
    });
  }
  const issues: ProblemIssue[] = [];
  unknownFields(
    body,
    [
      'labSiteId',
      'customerSiteId',
      'slotId',
      'preferredDropDate',
      'declaredPackageCount',
      'lines',
      'trf',
    ],
    issues,
  );
  const labSiteId = uuid(body, 'labSiteId', issues);
  const customerSiteId = uuid(body, 'customerSiteId', issues, false);
  const slotId = uuid(body, 'slotId', issues);
  const preferredDropDate = date(body, 'preferredDropDate', issues);
  const declaredPackageCount = packageCount(body, issues);
  const scopeLineIds = lines(body, issues);
  const form = trf(body, issues);
  if (
    issues.length > 0 ||
    labSiteId === undefined ||
    slotId === undefined ||
    preferredDropDate === undefined ||
    declaredPackageCount === undefined ||
    scopeLineIds === undefined ||
    form === undefined
  ) {
    fail(issues);
  }
  return {
    labSiteId,
    ...(customerSiteId === undefined ? {} : { customerSiteId }),
    slotId,
    preferredDropDate,
    declaredPackageCount,
    scopeLineIds,
    trf: form,
  };
}

/** `BookingUpdate`: at least one field; `customerSiteId` may be `null` (no billing site). */
export function parseBookingUpdate(raw: unknown): EditBookingInput {
  const body = object(raw);
  const issues: ProblemIssue[] = [];
  const allowed = [
    'customerSiteId',
    'slotId',
    'preferredDropDate',
    'declaredPackageCount',
    'lines',
    'trf',
  ];
  unknownFields(body, allowed, issues);
  if (Object.keys(body).length === 0) {
    issues.push({ path: '', code: 'REQUIRED', message: 'Change at least one field.' });
  }
  const result: EditBookingInput = {};
  if (body.customerSiteId === null) result.customerSiteId = null;
  else {
    const site = uuid(body, 'customerSiteId', issues, false);
    if (site !== undefined) result.customerSiteId = site;
  }
  const slotId = uuid(body, 'slotId', issues, false);
  if (slotId !== undefined) result.slotId = slotId;
  const dropDate = date(body, 'preferredDropDate', issues, false);
  if (dropDate !== undefined) result.preferredDropDate = dropDate;
  const packages = packageCount(body, issues, false);
  if (packages !== undefined) result.declaredPackageCount = packages;
  const scopeLineIds = lines(body, issues, false);
  if (scopeLineIds !== undefined) result.scopeLineIds = scopeLineIds;
  const form = trf(body, issues, false);
  if (form !== undefined) result.trf = form;
  if (issues.length > 0) fail(issues);
  return result;
}
