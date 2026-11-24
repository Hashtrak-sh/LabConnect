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
  transitionIds,
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

/** The transition ids of packages/shared, read as text (no package dependency). */
function sharedTransitionIds(): string[] {
  const source = readRepoFile('packages/shared/src/booking-state-machine.ts');
  const block = /TRANSITION_IDS = \[([^\]]*)\]/.exec(source)?.[1] ?? '';
  return [...block.matchAll(/'(T-\d{2})'/g)].map((m) => m[1] ?? '');
}

/**
 * Every schema node reachable from a schema, following `$ref`s, with the property name it sits
 * under (if any). Examples are skipped.
 */
function reachableNodes(
  node: unknown,
  at: string,
  seen = new Set<string>(),
): { property?: string; schema: Schema; at: string }[] {
  if (typeof node !== 'object' || node === null) return [];
  if (isRef(node)) {
    if (seen.has(node.$ref)) return [];
    seen.add(node.$ref);
    return reachableNodes(resolve(doc, node), node.$ref, seen);
  }
  const found: { property?: string; schema: Schema; at: string }[] = [
    { schema: node as Schema, at },
  ];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'examples' || key === 'example') continue;
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
        found.push({ property: name, schema: {}, at });
        found.push(...reachableNodes(child, `${at}/properties/${name}`, seen));
      }
      continue;
    }
    found.push(...reachableNodes(value, `${at}/${key}`, seen));
  }
  return found;
}

describe('custody and reports (API_CONTRACTS.md §7 and §8)', () => {
  const moduleTags = new Set(['Custody', 'Reports']);
  const moduleOperations = operations.filter((o) =>
    (o.operation.tags ?? []).some((t) => moduleTags.has(t)),
  );

  /** Operations that need a fresh step-up MFA (AUTHENTICATION_AND_AUTHORISATION.md §2). */
  const stepUpOperations = ['POST /report-versions/{id}/publish'];

  /** Checker decisions on a Maker's record (CD-23, ROLES_AND_PERMISSIONS note 6). */
  const makerCheckerDecisions = [
    'POST /receipts/{id}/approve',
    'POST /receipts/{id}/confirm-discrepancy',
    'POST /receipts/{id}/reject-unfit',
    'POST /reprint-requests/{id}/approve',
    'POST /report-versions/{id}/return',
    'POST /report-versions/{id}/publish',
  ];

  /** Lab-internal fields the customer's report view must not carry (FILES_AND_REPORTS §3). */
  const labOnlyReportFields = [
    'reviewComments',
    'makerUserId',
    'checkerUserId',
    'originalSha256',
    'amendmentReason',
    'boundPackage',
  ];

  const responseNodes = (operation: (typeof operations)[number]['operation']) =>
    Object.entries(operation.responses)
      .filter(([status]) => status.startsWith('2'))
      .flatMap(([status, value]) =>
        Object.entries(resolve<Response>(doc, value).content ?? {}).map(([type, media]) => ({
          status,
          type,
          schema: media.schema,
        })),
      );

  it('covers the module operations', () => {
    // 9 operations of §7 and 9 of §8 (share links: create and revoke).
    expect(moduleOperations.length).toBe(18);
  });

  it('name only transition ids that packages/shared defines', () => {
    const known = new Set(sharedTransitionIds());
    expect(known.size).toBe(28);
    const unknown = operations.flatMap(({ key, operation }) =>
      transitionIds(operation.description ?? '')
        .filter((id) => !known.has(id))
        .map((id) => `${key}: ${id}`),
    );
    expect(unknown).toEqual([]);
  });

  it('require If-Match on every command that performs a booking transition', () => {
    const missing = moduleOperations
      .filter((o) => o.method === 'post' && transitionIds(o.operation.description ?? '').length > 0)
      .filter(({ operation }) => {
        const p = parametersOf(doc, operation).find((x) => x.name === 'If-Match');
        return p?.in !== 'header' || p.required !== true;
      })
      .map((o) => o.key);
    expect(missing).toEqual([]);
  });

  it('return JSON only, with no file bytes and no object key', () => {
    const forbiddenNames = new Set(['objectkey', 'bucket', 'objectversionid', 'content', 'bytes']);
    const problems: string[] = [];
    for (const { key, operation } of moduleOperations) {
      for (const { status, type, schema } of responseNodes(operation)) {
        if (type !== 'application/json') problems.push(`${key} ${status}: ${type}`);
        for (const node of reachableNodes(schema, key)) {
          if (node.property !== undefined && forbiddenNames.has(node.property.toLowerCase())) {
            problems.push(`${key} ${status}: property ${node.property} (${node.at})`);
          }
          const s = node.schema;
          if (s.format === 'binary' || s.format === 'byte' || 'contentEncoding' in s) {
            problems.push(`${key} ${status}: binary schema (${node.at})`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('declare STEP_UP_REQUIRED where a step-up is needed', () => {
    for (const key of stepUpOperations) {
      const op = operations.find((o) => o.key === key);
      expect(op, key).toBeDefined();
      const unauthorised = op?.operation.responses['401'];
      expect(unauthorised, key).toBeDefined();
      if (unauthorised) {
        expect(backticked(describeResponse(unauthorised)), key).toContain('STEP_UP_REQUIRED');
      }
    }
  });

  it('declare SELF_APPROVAL_FORBIDDEN on every Checker decision', () => {
    for (const key of makerCheckerDecisions) {
      const op = operations.find((o) => o.key === key);
      expect(op, key).toBeDefined();
      const forbidden = op?.operation.responses['403'];
      expect(forbidden, key).toBeDefined();
      if (forbidden) {
        expect(backticked(describeResponse(forbidden)), key).toContain('SELF_APPROVAL_FORBIDDEN');
      }
    }
  });

  it('keep lab-internal report fields out of the customer view', () => {
    const view = { $ref: '#/components/schemas/CustomerReportView' };
    const leaked = reachableNodes(view, 'CustomerReportView')
      .filter((n) => n.property !== undefined && labOnlyReportFields.includes(n.property))
      .map((n) => `${n.property ?? ''} (${n.at})`);
    expect(leaked).toEqual([]);
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
    ['BookingStatus', 'BookingStatus', false],
    ['BookingLineStatus', 'BookingLineStatus', false],
    ['PackageStatus', 'PackageStatus', false],
    ['CustodyScanEventType', 'CustodyEventType', true],
    ['ReceiptDecision', 'ReceiptDecision', false],
    ['ReportStatus', 'ReportStatus', false],
    ['ReportVersionStatus', 'ReportVersionStatus', false],
    ['ConformityResult', 'ConformityResult', false],
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
