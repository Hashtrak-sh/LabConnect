import { describe, expect, it } from 'vitest';
import { allowedKeys, firstTable, parseRow } from './catalogue.js';
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
    ['CustomerSegment', 'CustomerSegment', false],
    ['OrgStatus', 'OrgStatus', false],
    ['MembershipStatus', 'MembershipStatus', false],
    ['CustomerRoleCode', 'RoleCode', true],
    ['CustomerSiteStatus', 'MdStatus', false],
    ['BookingStatus', 'BookingStatus', false],
    ['BookingLineStatus', 'BookingLineStatus', false],
    ['BookingLineTargetStatus', 'BookingLineStatus', true],
    ['PartyType', 'PartyType', false],
    ['CounterStatus', 'CounterStatus', false],
    ['HoldDecision', 'HoldDecision', false],
    ['HoldStatus', 'HoldStatus', false],
    ['PackageStatus', 'PackageStatus', false],
    ['CustodyEventType', 'CustodyEventType', false],
    ['ScanStatus', 'ScanStatus', false],
    ['RatingDirection', 'RatingDirection', false],
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

/** Does the schema (through `$ref`, `allOf`, `oneOf`, `anyOf`) expose a `lockVersion` property? */
function exposesLockVersion(node: unknown, seen = new Set<string>()): boolean {
  if (typeof node !== 'object' || node === null) return false;
  if (isRef(node)) {
    if (seen.has(node.$ref)) return false;
    seen.add(node.$ref);
    return exposesLockVersion(resolve(doc, node), seen);
  }
  const schema = node as Schema & { allOf?: unknown[]; oneOf?: unknown[]; anyOf?: unknown[] };
  if (schema.properties && 'lockVersion' in schema.properties) return true;
  return [...(schema.allOf ?? []), ...(schema.oneOf ?? []), ...(schema.anyOf ?? [])].some((s) =>
    exposesLockVersion(s, seen),
  );
}

/** Every property name reachable from a schema, following `$ref`s, lower-cased. */
function reachableNames(node: unknown, seen = new Set<string>()): Set<string> {
  const names = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    if (isRef(value)) {
      if (seen.has(value.$ref)) return;
      seen.add(value.$ref);
      walk(resolve(doc, value));
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'examples' || key === 'example') continue;
      if (key === 'properties' && typeof child === 'object' && child !== null) {
        for (const name of Object.keys(child)) names.add(name.toLowerCase());
      }
      walk(child);
    }
  };
  walk(node);
  return names;
}

// A booking is shared, but each party's view leaves out what the other party must not read
// (TENANT_ISOLATION.md §1, SCHEMA_SPECIFICATION §2.12 and §5.17, OQ-29).
describe('booking views per party', () => {
  const privateTo: Record<string, string[]> = {
    // Customer-owned: the requester, customer sites, users and contacts, platform-only flags.
    BookingForLab: [
      'requester',
      'requesterUserId',
      'customerSite',
      'customerSiteId',
      'placedByPlatform',
      'onBehalfOf',
      'fullName',
      'userId',
      'email',
      'phone',
      'trustFlags',
      'panLast4',
    ],
    // Lab-owned: onboarding state, capacity, internal scores, bank and KYC data.
    BookingForCustomer: [
      'bookabilityReasons',
      'maxOpenJobs',
      'responsivenessScore',
      'capacity',
      'heldCount',
      'bookedCount',
      'bankAccount',
      'accountNumberLast4',
      'kycStatus',
      'trustFlags',
      'clockSkewFlag',
    ],
  };

  it.each(Object.entries(privateTo))(
    '%s reaches none of the other party’s fields',
    (name, deny) => {
      const schema = doc.components.schemas[name];
      expect(schema).toBeDefined();
      const names = reachableNames(schema);
      expect(deny.filter((field) => names.has(field.toLowerCase()))).toEqual([]);
    },
  );

  it('are the only shapes a booking is returned in', () => {
    const view = doc.components.schemas.BookingView as Schema & { oneOf?: unknown[] };
    expect((view.oneOf ?? []).map((s) => (isRef(s) ? s.$ref : s))).toEqual([
      '#/components/schemas/BookingForCustomer',
      '#/components/schemas/BookingForLab',
    ]);
  });
});

describe('aggregates (API_CONVENTIONS §4)', () => {
  it('return an ETag with every success response that carries a lockVersion', () => {
    const missing: string[] = [];
    for (const { key, operation } of operations) {
      for (const [status, value] of Object.entries(operation.responses)) {
        if (!status.startsWith('2')) continue;
        const response = resolve<Response>(doc, value);
        const schema = response.content?.['application/json']?.schema;
        if (exposesLockVersion(schema) && !Object.keys(response.headers ?? {}).includes('ETag')) {
          missing.push(`${key} ${status}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

// Booking transitions (BOOKING_STATE_MACHINE.md §3). An operation that performs transitions lists
// them in `x-transitions`. packages/shared is read as text: api-contract does not depend on it.
describe('booking transitions', () => {
  const shared = readRepoFile('packages/shared/src/booking-state-machine.ts');
  const transitionIds = [
    ...(/export const TRANSITION_IDS = \[([\s\S]*?)\] as const/.exec(shared)?.[1] ?? '').matchAll(
      /'(T-\d{2})'/g,
    ),
  ].map((m) => m[1] ?? '');
  /** Transitions that create the aggregate (`from: []`), so there is no version to match. */
  const creating = new Set(
    [...shared.matchAll(/id: '(T-\d{2})',\s*from: \[\]/g)].map((m) => m[1] ?? ''),
  );
  const performing = operations.filter((o) => (o.operation['x-transitions'] ?? []).length > 0);

  /** T-ids named in a cell: `T-03`, `T-07 / T-08`, `T-25/26/27`, `T-16 or REPLACE/CANCEL`. */
  function transitionsInCell(cell: string): string[] {
    return [...cell.matchAll(/T-\d{2}(?:\s*\/\s*(?:T-)?\d{2})*/g)].flatMap((m) =>
      [...m[0].matchAll(/\d{2}/g)].map((d) => `T-${d[0]}`),
    );
  }

  it('reads the transition ids of packages/shared', () => {
    expect(transitionIds.length).toBeGreaterThan(0);
    expect(creating).toEqual(new Set(['T-01']));
  });

  it('has the same ids in BookingTransitionId as packages/shared', () => {
    expect(doc.components.schemas.BookingTransitionId?.enum).toEqual(transitionIds);
  });

  it('are declared only with ids of packages/shared', () => {
    const unknown = performing.flatMap(({ key, operation }) =>
      (operation['x-transitions'] ?? [])
        .filter((id) => !transitionIds.includes(id))
        .map((id) => `${key}: ${id}`),
    );
    expect(performing.length).toBeGreaterThan(0);
    expect(unknown).toEqual([]);
  });

  it('are each named in the operation description', () => {
    const unnamed = performing.flatMap(({ key, operation }) =>
      (operation['x-transitions'] ?? [])
        .filter((id) => !(operation.description ?? '').includes(id))
        .map((id) => `${key}: ${id}`),
    );
    expect(unnamed).toEqual([]);
  });

  it('require If-Match unless they create the aggregate (API_CONVENTIONS §4)', () => {
    const missing = performing
      .filter(({ operation }) => (operation['x-transitions'] ?? []).some((id) => !creating.has(id)))
      .filter(({ operation }) => {
        const p = parametersOf(doc, operation).find((x) => x.name === 'If-Match');
        return p?.in !== 'header' || p.required !== true;
      })
      .map((o) => o.key);
    expect(missing).toEqual([]);
  });

  it('match the Transition column of API_CONTRACTS.md for every documented operation', () => {
    // Every T-id a row names is performed by one of the row's operations, and a row that names
    // none has no operation that performs one. Rows whose operations are not in the contract yet
    // are skipped here; doc-equality.test.ts reports them for covered sections.
    const markdown = readRepoFile('docs/04-api/API_CONTRACTS.md');
    const byKey = new Map(operations.map((o) => [o.key, o.operation]));
    const problems: string[] = [];
    let checked = 0;
    for (const heading of markdown.split(/\r?\n/).filter((line) => line.startsWith('## '))) {
      const { header, rows } = (() => {
        try {
          return firstTable(markdownSection(markdown, heading));
        } catch {
          return { header: [], rows: [] };
        }
      })();
      const column = header.indexOf('Transition');
      if (column === -1) continue;
      const [methodColumn, pathColumn] = [header.indexOf('Method'), header.indexOf('Path')];
      for (const row of rows) {
        const keys = parseRow(row[methodColumn] ?? '', row[pathColumn] ?? '')
          .flatMap(allowedKeys)
          .filter((key) => byKey.has(key));
        if (keys.length === 0) continue;
        checked += 1;
        const named = transitionsInCell(row[column] ?? '');
        const performed = new Set(keys.flatMap((key) => byKey.get(key)?.['x-transitions'] ?? []));
        if (named.length === 0 && performed.size > 0) {
          problems.push(
            `${keys.join(', ')}: performs ${[...performed].join(', ')}, row names none`,
          );
        }
        for (const id of named.filter((t) => !performed.has(t))) {
          problems.push(`${keys.join(', ')}: row names ${id}, no operation declares it`);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
