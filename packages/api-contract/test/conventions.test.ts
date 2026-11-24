import { describe, expect, it } from 'vitest';
import {
  backticked,
  isRef,
  listOperations,
  loadBundledDocument,
  markdownSection,
  parametersOf,
  readRepoFile,
  resolve,
  type Response,
  type Schema,
  tableRows,
} from './helpers.js';

// Conventions from API_CONVENTIONS.md and ERROR_HANDLING.md, checked on every operation.
// Later modules (P2-02..06) get these checks for free.

const doc = loadBundledDocument();
const operations = listOperations(doc);
const problemRef = '#/components/schemas/Problem';

/**
 * POSTs that do not need `Idempotency-Key`. API_CONVENTIONS §4: "Required on every POST that
 * creates or changes something". Add an entry only with the reason the POST changes nothing.
 */
const idempotencyExemptions: Record<string, string> = {};

/**
 * PATCH/PUT operations that do not take `If-Match`. API_CONVENTIONS §4: "Required on PATCH/PUT
 * and on transition commands of mutable aggregates", with ETag = `"<lockVersion>"`.
 */
const ifMatchExemptions: Record<string, string> = {
  'PATCH /me/notification-preferences':
    'notification_preference has no lock_version, so there is no ETag to match. Each item sets ' +
    'an absolute value. Open question raised with P2-01.',
  'PATCH /admin/leads/{id}':
    'lead_request has no lock_version (SCHEMA_SPECIFICATION §6.3), so there is no ETag to match. ' +
    'Each field is set to the value sent. Raised in the P2-06b report.',
};

/** Effective response description: a `$ref` may override the shared one. */
function describeResponse(value: Response | { $ref: string; description?: string }): string {
  if (isRef(value)) return value.description ?? resolve<Response>(doc, value).description;
  return value.description;
}

/** The error catalogue of ERROR_HANDLING.md §2: code → HTTP status. */
function errorCatalogue(): Map<string, number> {
  const markdown = readRepoFile('docs/04-api/ERROR_HANDLING.md');
  const catalogue = new Map<string, number>();
  for (const [codeCell = '', statusCell = ''] of tableRows(
    markdownSection(markdown, '## 2. Error codes'),
  )) {
    const codes = backticked(codeCell);
    const statuses = statusCell.split('/').map(Number);
    codes.forEach((code, i) => {
      const status = statuses.length === 1 ? statuses[0] : statuses[i];
      if (status === undefined || Number.isNaN(status)) {
        throw new Error(`No status for ${code} in "${statusCell}"`);
      }
      catalogue.set(code, status);
    });
  }
  return catalogue;
}

/** Enum values by name from packages/database/prisma/schema/enums.prisma. */
function prismaEnums(): Map<string, string[]> {
  const source = readRepoFile('packages/database/prisma/schema/enums.prisma');
  const enums = new Map<string, string[]>();
  for (const match of source.matchAll(/enum (\w+) \{([^}]*)\}/g)) {
    const values = (match[2] ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[A-Z][A-Z0-9_]*$/.test(line));
    enums.set(match[1] ?? '', values);
  }
  return enums;
}

/** Every key of every `properties` object anywhere in the document. */
function propertyNames(node: unknown, path = '#'): { name: string; at: string }[] {
  if (typeof node !== 'object' || node === null) return [];
  const found: { name: string; at: string }[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'examples' || key === 'example') continue;
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      for (const name of Object.keys(value)) found.push({ name, at: `${path}/properties` });
    }
    found.push(...propertyNames(value, `${path}/${key}`));
  }
  return found;
}

describe('operations', () => {
  it('each have a unique operationId', () => {
    const ids = operations.map((o) => o.operation.operationId);
    expect(ids.filter((id) => id === undefined)).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each have at least one tag, declared at the top level', () => {
    const declared = new Set((doc.tags ?? []).map((t) => t.name));
    for (const { key, operation } of operations) {
      expect(operation.tags ?? [], key).not.toEqual([]);
      for (const tag of operation.tags ?? [])
        expect(declared.has(tag), `${key}: ${tag}`).toBe(true);
    }
  });

  it('require Idempotency-Key on every POST (API_CONVENTIONS §4)', () => {
    const missing = operations
      .filter((o) => o.method === 'post' && !(o.key in idempotencyExemptions))
      .filter(({ operation }) => {
        const p = parametersOf(doc, operation).find((x) => x.name === 'Idempotency-Key');
        return p?.in !== 'header' || p.required !== true;
      })
      .map((o) => o.key);
    expect(missing).toEqual([]);
  });

  it('require If-Match on every PATCH and PUT (API_CONVENTIONS §4)', () => {
    const missing = operations
      .filter((o) => (o.method === 'patch' || o.method === 'put') && !(o.key in ifMatchExemptions))
      .filter(({ operation }) => {
        const p = parametersOf(doc, operation).find((x) => x.name === 'If-Match');
        return p?.in !== 'header' || p.required !== true;
      })
      .map((o) => o.key);
    expect(missing).toEqual([]);
  });

  it('list only exemptions that match an operation', () => {
    const keys = new Set(operations.map((o) => o.key));
    for (const key of [...Object.keys(idempotencyExemptions), ...Object.keys(ifMatchExemptions)]) {
      expect(keys.has(key), key).toBe(true);
    }
  });

  it('declare 401 whenever they require authentication', () => {
    const missing = operations
      .filter(({ operation }) => (operation.security ?? doc.security ?? []).length > 0)
      .filter(({ operation }) => !('401' in operation.responses))
      .map((o) => o.key);
    expect(missing).toEqual([]);
  });

  it('under /public need no authentication and take no membership (API_CONVENTIONS §2)', () => {
    for (const { key, path, operation } of operations.filter((o) =>
      o.path.startsWith('/public/'),
    )) {
      expect(operation.security, key).toEqual([]);
      expect(
        parametersOf(doc, operation).map((p) => p.name),
        `${path}: X-Active-Membership`,
      ).not.toContain('X-Active-Membership');
    }
  });

  it('declare no 401 or 403 when they need no authentication', () => {
    const wrong = operations
      .filter(({ operation }) => operation.security?.length === 0)
      .filter(({ operation }) => '401' in operation.responses || '403' in operation.responses)
      .map((o) => o.key);
    expect(wrong).toEqual([]);
  });

  it('page every collection with cursor, limit and `{ data, page }` (API_CONVENTIONS §3)', () => {
    for (const { key, operation } of operations) {
      const params = parametersOf(doc, operation).filter((p) => p.in === 'query');
      const takesCursor = params.some((p) => p.name === 'cursor');
      const ok = operation.responses['200'];
      const schema = ok
        ? resolve<Schema>(
            doc,
            resolve<Response>(doc, ok).content?.['application/json']?.schema ?? {},
          )
        : undefined;
      const data = schema?.properties?.data;
      const returnsData = data !== undefined && resolve<Schema>(doc, data).type === 'array';
      expect(returnsData, `${key}: takes cursor ⇔ returns data[]`).toBe(takesCursor);
      if (!takesCursor) continue;
      expect(
        params.map((p) => p.name),
        key,
      ).toContain('limit');
      const page = schema?.properties?.page;
      expect(isRef(page) ? page.$ref : page, key).toBe('#/components/schemas/Page');
      expect(schema?.required ?? [], key).toEqual(expect.arrayContaining(['data', 'page']));
    }
  });

  it('accept X-Request-Id and return it on every response', () => {
    for (const { key, operation } of operations) {
      const names = parametersOf(doc, operation).map((p) => p.name);
      expect(names, key).toContain('X-Request-Id');
      for (const [status, value] of Object.entries(operation.responses)) {
        const response = resolve<Response>(doc, value);
        expect(Object.keys(response.headers ?? {}), `${key} ${status}`).toContain('X-Request-Id');
      }
    }
  });

  it('use the shared error schema for every non-2xx response', () => {
    for (const { key, operation } of operations) {
      for (const [status, value] of Object.entries(operation.responses)) {
        if (status.startsWith('2')) continue;
        const response = resolve<Response>(doc, value);
        expect(Object.keys(response.content ?? {}), `${key} ${status}`).toEqual([
          'application/problem+json',
        ]);
        const schema = response.content?.['application/problem+json']?.schema;
        expect(isRef(schema) ? schema.$ref : schema, `${key} ${status}`).toBe(problemRef);
      }
    }
  });

  it('send Retry-After with every 429', () => {
    for (const { key, operation } of operations) {
      const value = operation.responses['429'];
      if (!value) continue;
      expect(Object.keys(resolve<Response>(doc, value).headers ?? {}), key).toContain(
        'Retry-After',
      );
    }
  });

  it('put no personal data or OTPs in paths or query strings (CLAUDE.md §5)', () => {
    for (const { key, operation } of operations) {
      for (const p of parametersOf(doc, operation).filter(
        (x) => x.in === 'query' || x.in === 'path',
      )) {
        expect(p.name, key).not.toMatch(/email|phone|gstin|^pan$|fullName|otp/i);
      }
    }
  });
});

describe('naming', () => {
  it('uses camelCase for every schema property', () => {
    const bad = propertyNames(doc).filter(({ name }) => !/^[a-z][a-zA-Z0-9]*$/.test(name));
    expect(bad).toEqual([]);
  });

  it('uses camelCase for every query and path parameter', () => {
    for (const { key, operation } of operations) {
      for (const p of parametersOf(doc, operation).filter(
        (x) => x.in === 'query' || x.in === 'path',
      )) {
        expect(p.name, key).toMatch(/^[a-z][a-zA-Z0-9]*$/);
      }
    }
  });
});

describe('errors (ERROR_HANDLING.md)', () => {
  const catalogue = errorCatalogue();

  it('has the same codes in ErrorCode as the catalogue', () => {
    const inContract = doc.components.schemas.ErrorCode?.enum ?? [];
    expect([...inContract].sort()).toEqual([...catalogue.keys()].sort());
  });

  it('has the fields of the §1 envelope in Problem', () => {
    const markdown = readRepoFile('docs/04-api/ERROR_HANDLING.md');
    const example = /```json\r?\n([\s\S]*?)```/.exec(markdown)?.[1] ?? '{}';
    const envelope = JSON.parse(example) as Record<string, unknown> & { errors: object[] };
    const problem = doc.components.schemas.Problem?.properties ?? {};
    expect(Object.keys(problem).sort()).toEqual(Object.keys(envelope).sort());
    const issue = doc.components.schemas.ProblemIssue?.properties ?? {};
    expect(Object.keys(issue).sort()).toEqual(Object.keys(envelope.errors[0] ?? {}).sort());
  });

  it('mentions each code only under the HTTP status the catalogue gives it', () => {
    for (const { key, operation } of operations) {
      for (const [status, value] of Object.entries(operation.responses)) {
        for (const code of backticked(describeResponse(value)).filter((c) => catalogue.has(c))) {
          expect(String(catalogue.get(code)), `${key}: ${code}`).toBe(status);
        }
      }
    }
  });
});

describe('enums shared with the database', () => {
  const enums = prismaEnums();
  // Contract schema → Prisma enum, and whether the contract may accept a subset.
  const mirrored: [schema: string, prismaEnum: string, subset: boolean][] = [
    ['RoleCode', 'RoleCode', false],
    ['OrgType', 'OrgType', false],
    ['NotifChannel', 'NotifChannel', false],
    ['OtpRequestPurpose', 'OtpPurpose', true],
    ['AccreditationStatus', 'AccreditationStatus', false],
    ['PublicLabCategory', 'LabCategory', true],
    ['PublicListingStatus', 'ListingStatus', true],
    ['ScopeSiteType', 'ScopeSiteType', false],
    ['LeadKind', 'LeadKind', false],
    ['VerificationResult', 'VerificationResult', false],
    // P2-06b (admin)
    ['BookingStatus', 'BookingStatus', false],
    ['BookingLineStatus', 'BookingLineStatus', false],
    ['PartyType', 'PartyType', false],
    ['ReportStatus', 'ReportStatus', false],
    ['ReportVersionStatus', 'ReportVersionStatus', false],
    ['TimerType', 'TimerType', false],
    ['ClaimMethod', 'ClaimMethod', false],
    ['ClaimRequestStatus', 'ClaimRequestStatus', false],
    ['VerificationStatus', 'VerificationStatus', false],
    ['AdminVerificationDecision', 'VerificationStatus', true],
    ['GeocodeStatus', 'GeocodeStatus', false],
    ['AdminGeocodeQueueStatus', 'GeocodeStatus', true],
    ['MdStatus', 'MdStatus', false],
    ['MdDataType', 'MdDataType', false],
    ['ChangeSource', 'ChangeSource', false],
    ['ChangeSetStatus', 'ChangeSetStatus', false],
    ['MdTargetType', 'MdTargetType', false],
    ['ChangeOperation', 'ChangeOperation', false],
    ['ValidationStatus', 'ValidationStatus', false],
    ['ImportKind', 'ImportKind', false],
    ['ImportStatus', 'ImportStatus', false],
    ['ImportSourceFormat', 'ImportSourceFormat', false],
    ['ImportMatchResult', 'ImportMatchResult', false],
    ['ImportRowAction', 'ImportRowAction', false],
    ['LeadStatus', 'LeadStatus', false],
    ['DisputeStatus', 'DisputeStatus', false],
    ['DisputeOutcome', 'DisputeOutcome', false],
    ['RefundStatus', 'RefundStatus', false],
    ['PayoutStatus', 'PayoutStatus', false],
    ['PayoutMechanism', 'PayoutMechanism', false],
    ['PayoutHoldReason', 'PayoutHoldReason', false],
    ['AdminPayoutHoldPlaceReason', 'PayoutHoldReason', true],
    ['GatewayCode', 'GatewayCode', false],
    ['SettlementMatchStatus', 'SettlementMatchStatus', false],
    ['ConfigScope', 'ConfigScope', false],
    ['UserStatus', 'UserStatus', false],
    ['AdminUserStatusUpdate', 'UserStatus', true],
    ['AdminPlatformRoleCode', 'RoleCode', true],
  ];

  it.each(mirrored)('%s matches Prisma enum %s', (schema, prismaEnum, subset) => {
    const values = doc.components.schemas[schema]?.enum ?? [];
    const expected = enums.get(prismaEnum) ?? [];
    expect(expected).not.toEqual([]);
    if (subset) {
      expect(values).not.toEqual([]);
      for (const v of values) expect(expected).toContain(v);
    } else {
      expect(values).toEqual(expected);
    }
  });

  it('mirrors every contract enum that shares a name with a Prisma enum', () => {
    const covered = new Set(mirrored.map(([schema]) => schema));
    const unchecked = Object.entries(doc.components.schemas)
      .filter(([name, schema]) => schema.enum !== undefined && enums.has(name))
      .map(([name]) => name)
      .filter((name) => !covered.has(name));
    expect(unchecked).toEqual([]);
  });
});

// Rules the admin module introduces (P2-06b, API_CONTRACTS.md §10). Platform staff access is
// role-based (TENANT_ISOLATION §2 rule 6): every `/admin` operation names its roles in the
// extension `x-roles`, which only `/admin` operations use.
describe('admin operations (/admin)', () => {
  const adminOperations = operations.filter((o) => o.path.startsWith('/admin/'));
  const xRoles = (operation: object): unknown => (operation as { 'x-roles'?: unknown })['x-roles'];
  const descriptionOf = (operation: object): string =>
    (operation as { description?: string }).description ?? '';

  /** The /admin operations that need a fresh MFA (AUTHENTICATION §2 step-up list). */
  const stepUp = [
    'POST /admin/break-glass/report-access/{id}/approve', // break-glass access
    'POST /admin/break-glass/report-access/{id}/download-url', // break-glass access
    'POST /admin/payouts/{id}/release', // payout release
    'POST /admin/refunds/{id}/approve', // refund approval above the threshold
    'POST /admin/users', // platform role changes (grant)
    'PATCH /admin/users/{id}', // platform role changes (status)
    'PUT /admin/users/{id}/platform-roles', // platform role changes
  ];

  /**
   * Properties no /admin response may contain, at any depth: secrets, full numbers that are
   * stored encrypted, one-time codes, tokens, storage locations, and report files or contents
   * (platform staff see report metadata only; files need break-glass). Matching ignores case.
   */
  const adminDenyList = [
    'accountNumber',
    'accountNumberCiphertext',
    'pan',
    'panCiphertext',
    'otp',
    'otpCode',
    'codeHash',
    'token',
    'tokenHash',
    'accessToken',
    'refreshToken',
    'secret',
    'secretCiphertext',
    'recoveryCodes',
    'payloadCiphertext',
    'bucket',
    'objectKey',
    'originalFileId',
    'stampedFileId',
    'results',
  ].map((name) => name.toLowerCase());

  /** Property names reachable from a schema, following `$ref`s. */
  function reachable(node: unknown, seen = new Set<string>()): string[] {
    if (typeof node !== 'object' || node === null) return [];
    if (isRef(node)) {
      if (seen.has(node.$ref)) return [];
      seen.add(node.$ref);
      return reachable(resolve(doc, node), seen);
    }
    const names: string[] = [];
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'examples' || key === 'example') continue;
      if (key === 'properties' && typeof value === 'object' && value !== null) {
        names.push(...Object.keys(value));
      }
      names.push(...reachable(value, seen));
    }
    return names;
  }

  it('exist', () => {
    expect(adminOperations.length).toBeGreaterThan(0);
  });

  it('require authentication and declare 401 and 403', () => {
    for (const { key, operation } of adminOperations) {
      expect((operation.security ?? doc.security ?? []).length, key).toBeGreaterThan(0);
      expect(Object.keys(operation.responses), key).toEqual(expect.arrayContaining(['401', '403']));
    }
  });

  it('name at least one platform role in x-roles, and only roles of RoleCode', () => {
    const roleCodes = prismaEnums().get('RoleCode') ?? [];
    expect(roleCodes).not.toEqual([]);
    for (const { key, operation } of adminOperations) {
      const roles = xRoles(operation);
      expect(Array.isArray(roles), `${key}: x-roles`).toBe(true);
      const list = roles as unknown[];
      expect(list.length, key).toBeGreaterThan(0);
      expect(new Set(list).size, key).toBe(list.length);
      for (const role of list) {
        expect(roleCodes, key).toContain(role);
        expect(String(role), key).toMatch(/^PLATFORM_/);
        expect(descriptionOf(operation), `${key}: description names ${String(role)}`).toContain(
          `\`${String(role)}\``,
        );
      }
    }
  });

  it('use x-roles nowhere else', () => {
    const elsewhere = operations
      .filter((o) => !o.path.startsWith('/admin/') && xRoles(o.operation) !== undefined)
      .map((o) => o.key);
    expect(elsewhere).toEqual([]);
  });

  it('declare STEP_UP_REQUIRED exactly on the step-up actions', () => {
    const declaring = adminOperations
      .filter(({ operation }) => {
        const unauthorised = operation.responses['401'];
        return (
          unauthorised !== undefined &&
          backticked(describeResponse(unauthorised)).includes('STEP_UP_REQUIRED')
        );
      })
      .map((o) => o.key);
    expect([...declaring].sort()).toEqual([...stepUp].sort());
  });

  it('return no secret, full account number, PAN, OTP, token, object key or report file', () => {
    const leaks: string[] = [];
    for (const { key, operation } of adminOperations) {
      for (const [status, value] of Object.entries(operation.responses)) {
        if (!status.startsWith('2')) continue;
        for (const media of Object.values(resolve<Response>(doc, value).content ?? {})) {
          for (const name of reachable(media.schema)) {
            if (adminDenyList.includes(name.toLowerCase())) leaks.push(`${key}: ${name}`);
          }
        }
      }
    }
    expect(leaks).toEqual([]);
  });
});
