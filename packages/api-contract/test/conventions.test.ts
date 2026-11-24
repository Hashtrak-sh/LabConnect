import { describe, expect, it } from 'vitest';
import {
  backticked,
  describeResponse,
  errorCatalogue,
  isRef,
  listOperations,
  loadBundledDocument,
  parametersOf,
  readRepoFile,
  requiresHeader,
  resolve,
  type Response,
  type Schema,
} from './helpers.js';

// Conventions from API_CONVENTIONS.md and ERROR_HANDLING.md, checked on every operation. Rules a
// single module adds are in that module's test file (lab, bookings, custody-reports,
// payments-disputes, admin, public-boundary); enums and booking transitions have their own files.

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
  'PATCH /admin/leads/{id}':
    'lead_request has no lock_version (SCHEMA_SPECIFICATION §6.3), so there is no ETag to match. ' +
    'Each field is set to the value sent. Raised in the P2-06b report.',
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

/** Every key of every `properties` object anywhere in the document, `$ref`s not followed. */
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
      .filter(({ operation }) => !requiresHeader(doc, operation, 'Idempotency-Key'))
      .map((o) => o.key);
    expect(missing).toEqual([]);
  });

  it('require If-Match on every PATCH and PUT (API_CONVENTIONS §4)', () => {
    const missing = operations
      .filter((o) => (o.method === 'patch' || o.method === 'put') && !(o.key in ifMatchExemptions))
      .filter(({ operation }) => !requiresHeader(doc, operation, 'If-Match'))
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
        for (const code of backticked(describeResponse(doc, value)).filter((c) =>
          catalogue.has(c),
        )) {
          expect(String(catalogue.get(code)), `${key}: ${code}`).toBe(status);
        }
      }
    }
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
