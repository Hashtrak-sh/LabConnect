import { describe, expect, it } from 'vitest';
import { allowedKeys, firstTable, parseRow } from './catalogue.js';
import {
  backticked,
  isRef,
  listOperations,
  loadBundledDocument,
  markdownSection,
  type MediaType,
  type Operation,
  parametersOf,
  readRepoFile,
  type Ref,
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
const idempotencyExemptions: Record<string, string> = {
  'POST /webhooks/payments/{gateway}':
    'Called by the payment gateway, not by a client of ours, so it cannot send the header. ' +
    'Repeats are deduplicated on the gateway event id instead (gateway_webhook_event unique ' +
    '(gateway, event_id), ICICI_PAYMENT_INTEGRATION §4).',
};

/**
 * PATCH/PUT operations that do not take `If-Match`. API_CONVENTIONS §4: "Required on PATCH/PUT
 * and on transition commands of mutable aggregates", with ETag = `"<lockVersion>"`.
 */
const ifMatchExemptions: Record<string, string> = {
  'PATCH /me/notification-preferences':
    'notification_preference has no lock_version, so there is no ETag to match. Each item sets ' +
    'an absolute value. Open question raised with P2-01.',
  'PUT /lab/sites/{siteId}/receiving-hours':
    'receiving_hours has no lock_version (SCHEMA_SPECIFICATION §5.10), so there is no ETag to ' +
    'match. The PUT replaces the whole weekly set. Reported with P2-04.',
  'PUT /lab/sites/{siteId}/slot-templates':
    'Creates or updates several slot_template rows, each with its own lock_version: every ' +
    'updated item carries its lockVersion in the body and a mismatch returns 412.',
  'PUT /lab/sites/{siteId}/retention-rules':
    'Sets several retention_rule rows, each with its own lock_version: every existing rule ' +
    'carries its lockVersion in the body and a mismatch returns 412.',
  'PATCH /lab/invitations/{id}':
    'invitation has no lock_version (SCHEMA_SPECIFICATION §2.6). The only change is a one-way ' +
    'revocation.',
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
    ['PartyType', 'PartyType', false],
    ['GatewayCode', 'GatewayCode', false],
    ['PaymentOrderStatus', 'PaymentOrderStatus', false],
    ['FinDocType', 'FinDocType', false],
    ['DisputeStatus', 'DisputeStatus', false],
    ['DisputeOutcome', 'DisputeOutcome', false],
    ['MessageVisibility', 'MessageVisibility', false],
    // P2-04 Lab
    ['BookingStatus', 'BookingStatus', false],
    ['ClaimStatus', 'ClaimStatus', false],
    ['VerificationStatus', 'VerificationStatus', false],
    ['MembershipStatus', 'MembershipStatus', false],
    ['ClaimMethod', 'ClaimMethod', false],
    ['ClaimRequestStatus', 'ClaimRequestStatus', false],
    ['ListingStatus', 'ListingStatus', false],
    ['GeocodeStatus', 'GeocodeStatus', false],
    ['PriceListStatus', 'PriceListStatus', false],
    ['SlotStatus', 'SlotStatus', false],
    ['ImportStatus', 'ImportStatus', false],
    ['ImportMatchResult', 'ImportMatchResult', false],
    ['ImportRowAction', 'ImportRowAction', false],
    ['ChangeSetStatus', 'ChangeSetStatus', false],
    ['LabRoleCode', 'RoleCode', true],
    ['LabMembershipSettableStatus', 'MembershipStatus', true],
    ['LabSlotSettableStatus', 'SlotStatus', true],
    ['LabScopeProposalOperation', 'ChangeOperation', false],
    ['BookingLineStatus', 'BookingLineStatus', false],
    ['PackageStatus', 'PackageStatus', false],
    ['CustodyScanEventType', 'CustodyEventType', true],
    ['ReceiptDecision', 'ReceiptDecision', false],
    ['ReportStatus', 'ReportStatus', false],
    ['ReportVersionStatus', 'ReportVersionStatus', false],
    ['ConformityResult', 'ConformityResult', false],
    ['CustomerSegment', 'CustomerSegment', false],
    ['OrgStatus', 'OrgStatus', false],
    ['CustomerRoleCode', 'RoleCode', true],
    ['CustomerSiteStatus', 'MdStatus', false],
    ['BookingLineTargetStatus', 'BookingLineStatus', true],
    ['CounterStatus', 'CounterStatus', false],
    ['HoldDecision', 'HoldDecision', false],
    ['HoldStatus', 'HoldStatus', false],
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

// Payments and disputes (P2-06a). CLAUDE.md §5 "Payments (ICICI)": the contract is
// adapter-level until the ICICI documentation exists (OQ-01), and the amount of a payment is
// never taken from the client (PAYMENTS_AND_LEDGER §2, SCHEMA_SPECIFICATION §10.1).

interface SchemaNode {
  /** The component name when the node was reached through `#/components/schemas/<name>`. */
  name: string | undefined;
  at: string;
  node: Record<string, unknown>;
}

/** Every schema object reachable from `node`, following `$ref`s once each. */
function schemaNodes(
  node: unknown,
  at: string,
  name?: string,
  seen = new Set<string>(),
): SchemaNode[] {
  if (typeof node !== 'object' || node === null) return [];
  if (isRef(node)) {
    if (seen.has(node.$ref)) return [];
    seen.add(node.$ref);
    const component = /^#\/components\/schemas\/([^/]+)$/.exec(node.$ref)?.[1];
    return schemaNodes(resolve(doc, node), node.$ref, component, seen);
  }
  const record = node as Record<string, unknown>;
  const found: SchemaNode[] = [{ name, at, node: record }];
  for (const [key, value] of Object.entries(record)) {
    if (key === 'examples' || key === 'example') continue;
    found.push(...schemaNodes(value, `${at}/${key}`, undefined, seen));
  }
  return found;
}

/**
 * Schemas of the request body, or of the success responses, of an operation. Error responses
 * all use the shared `Problem` schema, which is checked above.
 */
function bodySchemas(
  operation: (typeof operations)[number]['operation'],
  part: 'request' | 'response',
): unknown[] {
  const media: unknown[] = [];
  if (part === 'request') {
    const body = operation.requestBody as
      { content?: Record<string, { schema?: unknown }> } | undefined;
    for (const m of Object.values(body?.content ?? {})) media.push(m.schema);
  } else {
    for (const [status, value] of Object.entries(operation.responses)) {
      if (!status.startsWith('2')) continue;
      for (const m of Object.values(resolve<Response>(doc, value).content ?? {}))
        media.push(m.schema);
    }
  }
  return media;
}

const moduleOperations = operations.filter(({ operation }) =>
  (operation.tags ?? []).some((t) => t === 'Payments' || t === 'Disputes'),
);
const paymentOperations = moduleOperations.filter(({ operation }) =>
  (operation.tags ?? []).includes('Payments'),
);

/** Property names reachable from the given schemas. */
function reachableNames(schemas: unknown[], at: string): { name: string; at: string }[] {
  return schemas.flatMap((schema) =>
    schemaNodes(schema, at).flatMap(({ at: where, node }) =>
      Object.keys((node.properties as Record<string, unknown> | undefined) ?? {}).map((n) => ({
        name: n,
        at: where,
      })),
    ),
  );
}
describe('payments and disputes (P2-06a)', () => {
  it('covers the module', () => {
    expect(paymentOperations.length).toBeGreaterThan(0);
    expect(moduleOperations.length).toBeGreaterThan(paymentOperations.length);
  });

  it('never take an amount from the client in a payment operation', () => {
    const money = /amount|paise|total|price|money|currency|fee/i;
    const found = paymentOperations.flatMap(({ key, operation }) => [
      ...reachableNames(bodySchemas(operation, 'request'), key).filter((p) => money.test(p.name)),
      ...parametersOf(doc, operation)
        .filter((p) => money.test(p.name))
        .map((p) => ({ name: p.name, at: `${key} (${p.in})` })),
    ]);
    expect(found).toEqual([]);
  });

  it('allow additional properties only on the opaque gateway checkout', () => {
    const open = new Set<string>();
    for (const { key, operation } of moduleOperations) {
      for (const schema of [
        ...bodySchemas(operation, 'request'),
        ...bodySchemas(operation, 'response'),
      ]) {
        for (const { name, at, node } of schemaNodes(schema, key)) {
          if (node.additionalProperties === true) open.add(name ?? at);
        }
      }
    }
    expect([...open]).toEqual(['PaymentGatewayCheckout']);
  });

  it('keep the gateway-facing objects opaque (OQ-01)', () => {
    const checkout = doc.components.schemas.PaymentGatewayCheckout ?? {};
    expect(checkout.properties ?? {}).toEqual({});
    expect(checkout.required ?? []).toEqual([]);
    const webhook = doc.components.schemas.PaymentGatewayWebhookBody ?? {};
    expect(Object.keys(webhook).sort()).toEqual(['description']);
  });

  it('authenticate the webhook by the gateway only, naming no gateway header (OQ-01)', () => {
    const webhook = operations.find((o) => o.key === 'POST /webhooks/payments/{gateway}');
    expect(webhook).toBeDefined();
    if (!webhook) return;
    expect(webhook.operation.security).toEqual([]);
    expect(
      parametersOf(doc, webhook.operation)
        .filter((p) => p.in === 'header' || p.in === 'cookie')
        .map((p) => p.name),
    ).toEqual(['X-Request-Id']);
    expect(reachableNames(bodySchemas(webhook.operation, 'request'), webhook.key)).toEqual([]);
    // The 2xx answer reveals nothing: no body.
    for (const [status, value] of Object.entries(webhook.operation.responses)) {
      if (status.startsWith('2'))
        expect(resolve<Response>(doc, value).content, status).toBeUndefined();
    }
  });

  it('name no gateway vendor in a property or parameter', () => {
    const vendors = (doc.components.schemas.GatewayCode?.enum ?? []).filter((c) => c !== 'FAKE');
    expect(vendors).not.toEqual([]);
    const vendor = new RegExp(vendors.join('|'), 'i');
    const found = moduleOperations.flatMap(({ key, operation }) => [
      ...reachableNames(
        [...bodySchemas(operation, 'request'), ...bodySchemas(operation, 'response')],
        key,
      ).filter((p) => vendor.test(p.name)),
      ...parametersOf(doc, operation)
        .filter((p) => vendor.test(p.name))
        .map((p) => ({ name: p.name, at: key })),
    ]);
    expect(found).toEqual([]);
  });

  it('let no party request set the visibility of a dispute message (TENANT_ISOLATION §1)', () => {
    const found = moduleOperations.flatMap(({ key, operation }) =>
      reachableNames(bodySchemas(operation, 'request'), key).filter((p) =>
        /visibility/i.test(p.name),
      ),
    );
    expect(found).toEqual([]);
  });
});

describe('lab operations (API_CONTRACTS §6)', () => {
  const labOperations = operations.filter((o) => o.path.startsWith('/lab/'));

  /** Every property reachable from a schema, following `$ref`s, with its own schema. */
  function reachableProperties(
    node: unknown,
    seen = new Set<string>(),
  ): { name: string; schema: Schema | Ref }[] {
    if (typeof node !== 'object' || node === null) return [];
    if (isRef(node)) {
      if (seen.has(node.$ref)) return [];
      seen.add(node.$ref);
      return reachableProperties(resolve(doc, node), seen);
    }
    const found: { name: string; schema: Schema | Ref }[] = [];
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'examples' || key === 'example') continue;
      if (key === 'properties' && typeof value === 'object' && value !== null) {
        for (const [name, schema] of Object.entries(value as Record<string, Schema | Ref>)) {
          found.push({ name, schema });
        }
      }
      found.push(...reachableProperties(value, seen));
    }
    return found;
  }

  /** Properties of the JSON request body of an operation. */
  function requestProperties(operation: Operation): { name: string; schema: Schema | Ref }[] {
    const body = operation.requestBody as { content?: Record<string, MediaType> } | undefined;
    return Object.values(body?.content ?? {}).flatMap((m) => reachableProperties(m.schema));
  }

  /** Properties of the 2xx responses of an operation. */
  function responseProperties(operation: Operation): string[] {
    return Object.entries(operation.responses)
      .filter(([status]) => status.startsWith('2'))
      .flatMap(([, value]) => Object.values(resolve<Response>(doc, value).content ?? {}))
      .flatMap((m) => reachableProperties(m.schema).map((p) => p.name));
  }

  // Secrets that no lab response may carry (SECURITY_AND_PRIVACY §2, CLAUDE.md §5): a full bank
  // account number (only `accountNumberLast4` is returned), a PAN, an OTP, a token or a secret.
  // (`code` alone is not listed: it is the code of a master-data value.)
  const secret =
    /^(accountNumber|accountNumberCiphertext|pan|panCiphertext|otp|otpCode|codeHash|token|tokenHash|secret|secretCiphertext)$/i;

  it('cover the lab section', () => {
    expect(labOperations.length).toBeGreaterThan(0);
  });

  it('all require authentication', () => {
    const open = labOperations
      .filter(({ operation }) => (operation.security ?? doc.security ?? []).length === 0)
      .map((o) => o.key);
    expect(open).toEqual([]);
  });

  it('return no full account number, PAN, OTP, token or secret', () => {
    const leaks = labOperations.flatMap(({ key, operation }) =>
      responseProperties(operation)
        .filter((name) => secret.test(name))
        .map((name) => `${key}: ${name}`),
    );
    expect(leaks).toEqual([]);
  });

  it('accept a bank account number only as a write-only field', () => {
    const accountNumbers = labOperations.flatMap(({ key, operation }) =>
      requestProperties(operation)
        .filter((p) => p.name === 'accountNumber')
        .map((p) => ({ key, writeOnly: resolve<Schema>(doc, p.schema).writeOnly })),
    );
    expect(accountNumbers).not.toEqual([]);
    for (const { key, writeOnly } of accountNumbers) expect(writeOnly, key).toBe(true);
  });

  it('take no organisation id from the client (TENANT_ISOLATION §2)', () => {
    const orgId = /^(organisationId|organizationId|orgId|labOrgId|customerOrgId)$/i;
    const taken = labOperations.flatMap(({ key, operation }) => [
      ...requestProperties(operation)
        .filter((p) => orgId.test(p.name))
        .map((p) => `${key}: body ${p.name}`),
      ...parametersOf(doc, operation)
        .filter((p) => orgId.test(p.name))
        .map((p) => `${key}: ${p.in} ${p.name}`),
    ]);
    expect(taken).toEqual([]);
  });

  it('require a step-up MFA to add bank details (AUTHENTICATION §2)', () => {
    const stepUp = ['POST /lab/bank-accounts'];
    for (const key of stepUp) {
      const op = labOperations.find((o) => o.key === key);
      const unauthenticated = op?.operation.responses['401'];
      expect(unauthenticated, key).toBeDefined();
      if (!unauthenticated) continue;
      expect(backticked(describeResponse(unauthenticated)), key).toContain('STEP_UP_REQUIRED');
    }
  });

  it('act as the active lab membership, except a claim, which comes before one', () => {
    for (const { key, path, operation } of labOperations) {
      const names = parametersOf(doc, operation).map((p) => p.name);
      if (path.startsWith('/lab/claims')) expect(names, key).not.toContain('X-Active-Membership');
      else expect(names, key).toContain('X-Active-Membership');
    }
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
function reachablePropertyNames(node: unknown, seen = new Set<string>()): Set<string> {
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
      const names = reachablePropertyNames(schema);
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
