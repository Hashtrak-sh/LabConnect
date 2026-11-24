// Unit tests of the validator against the real contract, with made-up exchanges. They show what
// the harness catches before endpoints exist to catch it on. Operations other than health are
// chosen by shape (not by name), so contract edits do not break these tests.
import { describe, expect, it } from 'vitest';
import {
  type ContractOperation,
  type ExchangeResponse,
  loadContract,
  validateProblem,
  validateRequest,
  validateResponse,
} from '../support/contract/index.js';

const contract = loadContract();

function operation(id: string): ContractOperation {
  const op = contract.byOperationId(id);
  if (!op) throw new Error(`${id} is not in the contract`);
  return op;
}

function find(
  description: string,
  predicate: (op: ContractOperation) => boolean,
): ContractOperation {
  const op = contract.operations.find(predicate);
  if (!op) throw new Error(`No contract operation ${description}`);
  return op;
}

function json(status: number, body: unknown, mediaType = 'application/json'): ExchangeResponse {
  return {
    status,
    headers: { 'content-type': `${mediaType}; charset=utf-8` },
    body,
    text: JSON.stringify(body),
  };
}

const reasons = (violations: { subject: string; pointer: string; reason: string }[]): string[] =>
  violations.map((v) => `${v.subject} ${v.pointer} ${v.reason}`);

const health = operation('getHealth');
const someCode = [...contract.problem.catalogue][0] ?? 'NOT_FOUND';
const problem = (status: number, code = someCode): Record<string, unknown> => ({
  type: 'https://labconnect/errors/example',
  title: 'Example',
  status,
  code,
  requestId: 'req-test',
});

describe('contract index', () => {
  it('routes concrete paths to operations under the server prefix', () => {
    expect(contract.serverPrefix).toBe('/v1');
    expect(contract.match('GET', '/v1/health')?.operation.operationId).toBe('getHealth');
    expect(contract.match('GET', '/health')).toBeUndefined();
    expect(contract.match('DELETE', '/v1/health')).toBeUndefined();
  });

  it('routes a concrete path of every operation back to that operation', () => {
    // Literal segments beat parameters: `/bookings/estimate` is not `/bookings/{id}`.
    const misrouted = contract.operations
      .map((op) => {
        const path = op.servedPath.replace(/\{[^}]+\}/g, '0190d6a2-7c4e-7a1b-9c3d-0123456789ab');
        return { op, got: contract.match(op.method, path)?.operation.operationId };
      })
      .filter(({ op, got }) => got !== op.operationId)
      .map(({ op, got }) => `${op.operationId} → ${got ?? 'nothing'}`);
    expect(misrouted).toEqual([]);
  });

  it('finds the shared problem schema and its error-code catalogue', () => {
    expect(contract.problem.catalogue.has('NOT_FOUND')).toBe(true);
    expect(contract.problem.catalogue.has('VALIDATION_FAILED')).toBe(true);
  });
});

describe('response validation', () => {
  it('accepts the documented health response', () => {
    expect(validateResponse(contract, health, json(200, { status: 'ok' }))).toEqual([]);
  });

  it('rejects an extra property, naming the pointer', () => {
    const violations = validateResponse(contract, health, json(200, { status: 'ok', extra: 1 }));
    expect(reasons(violations)).toEqual([
      expect.stringMatching(/^response body {2}must NOT have additional properties \("extra"\)/),
    ]);
  });

  it('rejects a value outside the enum', () => {
    const violations = validateResponse(contract, health, json(200, { status: 'degraded' }));
    expect(violations[0]).toMatchObject({ subject: 'response body', pointer: '/status' });
  });

  it('rejects an undeclared status', () => {
    const violations = validateResponse(contract, health, json(418, { status: 'ok' }));
    expect(reasons(violations)).toEqual([expect.stringContaining('418 is not declared')]);
  });

  it('rejects an undeclared content type', () => {
    const violations = validateResponse(
      contract,
      health,
      json(200, { status: 'ok' }, 'text/plain'),
    );
    expect(violations[0]?.subject).toBe('response content type');
  });

  it('checks declared response headers against their schema', () => {
    const op = find('with an ETag response header', (o) =>
      Object.values(o.operation.responses ?? {}).some((r) => JSON.stringify(r).includes('ETag')),
    );
    const [status] = Object.entries(op.operation.responses ?? {}).find(([, r]) =>
      JSON.stringify(r).includes('ETag'),
    ) ?? ['200'];
    const response: ExchangeResponse = {
      status: Number(status),
      headers: { etag: 'W/not-a-lock-version' },
      body: undefined,
      text: '',
    };
    const headerViolations = validateResponse(contract, op, response).filter(
      (v) => v.subject === 'response header ETag',
    );
    expect(headerViolations).not.toEqual([]);
  });

  it('rejects an error response that is not the problem shape', () => {
    const op = find('with a 404 response', (o) => '404' in (o.operation.responses ?? {}));
    const violations = validateResponse(
      contract,
      op,
      json(404, { message: 'Not Found', statusCode: 404 }),
    );
    expect(violations.map((v) => v.subject)).toContain('response content type');
  });

  it('accepts a problem with a catalogue code and checks its status', () => {
    const response = json(404, problem(404), 'application/problem+json');
    expect(validateProblem(contract, response)).toEqual([]);
    const mismatch = json(404, problem(409), 'application/problem+json');
    expect(reasons(validateProblem(contract, mismatch))).toEqual([
      expect.stringContaining('/status is 409 but the HTTP status is 404'),
    ]);
  });

  it('rejects a problem code outside the catalogue and a type that is not a URI', () => {
    const body = { ...problem(404, 'NOT_A_REAL_CODE'), type: 'not a uri' };
    const violations = validateProblem(contract, json(404, body, 'application/problem+json'));
    expect(reasons(violations)).toEqual([
      expect.stringMatching(/^error response body \/type must match format "uri"/),
      expect.stringContaining('"NOT_A_REAL_CODE" is not in the error-code catalogue'),
    ]);
  });
});

describe('request validation', () => {
  it('accepts the health request, with or without X-Request-Id', () => {
    expect(validateRequest(contract, health, {}, { method: 'get', path: '/v1/health' })).toEqual(
      [],
    );
    expect(
      validateRequest(
        contract,
        health,
        {},
        { method: 'get', path: '/v1/health', headers: { 'x-request-id': 'r1' } },
      ),
    ).toEqual([]);
  });

  it('rejects a body or a query parameter the operation does not declare', () => {
    const violations = validateRequest(
      contract,
      health,
      {},
      { method: 'get', path: '/v1/health?verbose=true', body: { a: 1 } },
    );
    expect(violations.map((v) => v.subject)).toEqual(['query parameter verbose', 'request body']);
  });

  it('rejects a missing required header and an invalid JSON body', () => {
    const op = find('POST with a required Idempotency-Key and required body fields', (o) => {
      if (o.method !== 'POST' || o.operation.requestBody === undefined) return false;
      if (!o.parameters.some((p) => p.value.name === 'Idempotency-Key' && p.value.required)) {
        return false;
      }
      const body = contract.follow(o.operation.requestBody, [...o.pointer, 'requestBody']);
      const schema = body.value.content?.['application/json']?.schema;
      if (schema === undefined) return false;
      const located = contract.follow(schema, [
        ...body.pointer,
        'content',
        'application/json',
        'schema',
      ]);
      return Array.isArray(located.value.required) && located.value.required.length > 0;
    });
    const path = op.servedPath.replace(/\{[^}]+\}/g, '0190d6a2-7c4e-7a1b-9c3d-0123456789ab');
    const matched = contract.match(op.method, path);
    expect(matched?.operation).toBe(op);
    const violations = validateRequest(contract, op, matched?.pathParameters ?? {}, {
      method: 'post',
      path,
      body: { notAField: true },
    });
    const subjects = violations.map((v) => v.subject);
    expect(subjects).toContain('header parameter Idempotency-Key');
    expect(subjects).toContain('request body');
  });

  it('checks path parameter formats', () => {
    const op = find('with a uuid path parameter', (o) =>
      o.parameters.some(
        (p) =>
          p.value.in === 'path' &&
          p.value.schema !== undefined &&
          JSON.stringify(contract.follow(p.value.schema, [...p.pointer, 'schema']).value).includes(
            '"format":"uuid"',
          ),
      ),
    );
    const path = op.servedPath.replace(/\{[^}]+\}/g, 'not-a-uuid');
    const matched = contract.match(op.method, path);
    expect(matched?.operation).toBe(op);
    const violations = validateRequest(contract, op, matched?.pathParameters ?? {}, {
      method: op.method,
      path,
    });
    expect(reasons(violations)).toContainEqual(expect.stringMatching(/must match format "uuid"/));
  });
});
