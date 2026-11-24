// Request and response validation against the contract (task P2-08). Pure functions over the
// exchange, so they can be unit-tested without the app; contract-request.ts wires them to
// supertest.
import type { ErrorObject } from 'ajv/dist/2020.js';
import {
  type Contract,
  type ContractOperation,
  type HeaderObject,
  type Located,
  type MediaTypeObject,
  type ParameterObject,
  type Reference,
  type RequestBodyObject,
  type ResponseObject,
  type SchemaObject,
  describeOperation,
} from './document.js';

export interface ExchangeRequest {
  method: string;
  /** The path as called, query string included: `/v1/bookings?limit=10`. */
  path: string;
  headers?: Record<string, string>;
  /** JSON body, or undefined when none was sent. */
  body?: unknown;
}

export interface ExchangeResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  /** Parsed body (JSON) or raw body. */
  body: unknown;
  /** Raw text of the body, when it is text. */
  text?: string;
}

export interface Violation {
  /** What was checked: `response body`, `request header Idempotency-Key`, `status`… */
  subject: string;
  /** JSON pointer into the checked value (`/lines/0/qty`), or empty. */
  pointer: string;
  reason: string;
}

export const PROBLEM_MEDIA_TYPE = 'application/problem+json';

function isJsonMediaType(mediaType: string): boolean {
  return mediaType === 'application/json' || /^application\/[\w.-]+\+json$/.test(mediaType);
}

function mediaTypeOf(contentType: string | string[] | undefined): string | undefined {
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  return value?.split(';')[0]?.trim().toLowerCase() || undefined;
}

function mediaTypeMatches(declared: string, actual: string): boolean {
  const d = declared.toLowerCase();
  if (d === '*/*' || d === actual) return true;
  return d.endsWith('/*') && actual.startsWith(d.slice(0, -1));
}

function schemaErrors(subject: string, errors: ErrorObject[] | null | undefined): Violation[] {
  return (errors ?? []).map((error) => {
    const params = error.params as Record<string, unknown>;
    let reason = error.message ?? error.keyword;
    if (error.keyword === 'additionalProperties' || error.keyword === 'unevaluatedProperties') {
      reason += ` (${JSON.stringify(params.additionalProperty ?? params.unevaluatedProperty)})`;
    } else if (error.keyword === 'enum') {
      reason += ` (${JSON.stringify(params.allowedValues)})`;
    }
    return {
      subject,
      pointer: error.instancePath,
      reason: `${reason} [schema ${error.schemaPath}]`,
    };
  });
}

function validateAgainst(
  contract: Contract,
  subject: string,
  schema: Located<MediaTypeObject['schema']>,
  data: unknown,
): Violation[] {
  if (schema.value === undefined) return [];
  const validate = contract.validator(schema.pointer);
  return validate(data) ? [] : schemaErrors(subject, validate.errors);
}

/** Path, query and header values arrive as strings; convert them to the declared scalar type. */
function coerce(schema: Located<SchemaObject>, value: string): unknown {
  const type = schema.value.type;
  if (type === 'integer' || type === 'number') {
    return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  }
  if (type === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}

function parameterSchema(
  contract: Contract,
  parameter: Located<ParameterObject>,
): Located<SchemaObject> | undefined {
  const schema = parameter.value.schema;
  if (schema === undefined) return undefined;
  return contract.follow<SchemaObject>(schema, [...parameter.pointer, 'schema']);
}

function parameterValue(
  contract: Contract,
  parameter: Located<ParameterObject>,
  raw: string[],
): unknown {
  const schema = parameterSchema(contract, parameter);
  if (!schema) return raw[0];
  if (schema.value.type === 'array') {
    const explode = parameter.value.explode ?? (parameter.value.style ?? 'form') === 'form';
    const values =
      explode || parameter.value.in !== 'query' ? raw : raw.flatMap((v) => v.split(','));
    const items = schema.value.items as SchemaObject | Reference | undefined;
    if (items === undefined) return values;
    const itemSchema = contract.follow<SchemaObject>(items, [...schema.pointer, 'items']);
    return values.map((v) => coerce(itemSchema, v));
  }
  return coerce(schema, raw[0] ?? '');
}

/** Checks a request the test is about to send against the operation it is routed to. */
export function validateRequest(
  contract: Contract,
  operation: ContractOperation,
  pathParameters: Record<string, string>,
  request: ExchangeRequest,
): Violation[] {
  const violations: Violation[] = [];
  const url = new URL(request.path, 'http://contract.test');
  const headers = new Map(
    Object.entries(request.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const declaredQuery = new Set<string>();

  for (const parameter of operation.parameters) {
    const { name, in: location, required } = parameter.value;
    const subject = `${location} parameter ${name}`;
    let raw: string[];
    if (location === 'path') raw = name in pathParameters ? [pathParameters[name] ?? ''] : [];
    else if (location === 'query') {
      declaredQuery.add(name);
      raw = url.searchParams.getAll(name);
    } else if (location === 'header') {
      const value = headers.get(name.toLowerCase());
      raw = value === undefined ? [] : [value];
    } else continue; // Cookies are not sent by the harness.

    if (raw.length === 0) {
      if (required === true || location === 'path') {
        violations.push({
          subject,
          pointer: '',
          reason: 'is required by the contract but missing',
        });
      }
      continue;
    }
    const schema = parameterSchema(contract, parameter);
    if (raw.length > 1 && schema?.value.type !== 'array') {
      violations.push({ subject, pointer: '', reason: 'is sent more than once' });
      continue;
    }
    if (!schema) continue;
    const validate = contract.validator(schema.pointer);
    if (!validate(parameterValue(contract, parameter, raw))) {
      violations.push(...schemaErrors(subject, validate.errors));
    }
  }
  for (const name of new Set(url.searchParams.keys())) {
    if (!declaredQuery.has(name)) {
      violations.push({
        subject: `query parameter ${name}`,
        pointer: '',
        reason: 'is not declared by the operation',
      });
    }
  }

  const bodyRef = operation.operation.requestBody;
  if (bodyRef === undefined) {
    if (request.body !== undefined) {
      violations.push({
        subject: 'request body',
        pointer: '',
        reason: 'is sent, but the operation declares no request body',
      });
    }
    return violations;
  }
  const requestBody = contract.follow<RequestBodyObject>(bodyRef, [
    ...operation.pointer,
    'requestBody',
  ]);
  if (request.body === undefined) {
    if (requestBody.value.required === true) {
      violations.push({ subject: 'request body', pointer: '', reason: 'is required but missing' });
    }
    return violations;
  }
  const content = requestBody.value.content ?? {};
  const json = Object.keys(content).find(isJsonMediaType);
  if (json !== undefined) {
    const media = content[json];
    violations.push(
      ...validateAgainst(
        contract,
        'request body',
        {
          value: media?.schema,
          pointer: [...requestBody.pointer, 'content', json, 'schema'],
        },
        request.body,
      ),
    );
  } else if (!Object.keys(content).some((m) => mediaTypeMatches(m, 'application/json'))) {
    violations.push({
      subject: 'request body',
      pointer: '',
      reason: `is JSON, but the operation accepts only ${Object.keys(content).join(', ')}`,
    });
  }
  return violations;
}

function hasBody(response: ExchangeResponse): boolean {
  if (typeof response.text === 'string') return response.text.length > 0;
  if (Buffer.isBuffer(response.body)) return response.body.length > 0;
  return false;
}

/** Checks a response against what the operation declares for its status. */
export function validateResponse(
  contract: Contract,
  operation: ContractOperation,
  response: ExchangeResponse,
): Violation[] {
  const responses = operation.operation.responses ?? {};
  const status = String(response.status);
  const key = [status, `${status[0] ?? ''}XX`, 'default'].find((k) => k in responses);
  if (key === undefined) {
    return [
      {
        subject: 'status',
        pointer: '',
        reason: `${status} is not declared (declared: ${Object.keys(responses).join(', ')})`,
      },
    ];
  }
  const declared = contract.follow<ResponseObject>(responses[key] as ResponseObject | Reference, [
    ...operation.pointer,
    'responses',
    key,
  ]);
  const violations: Violation[] = [];

  // Headers. `Content-Type` is described by `content`, never by `headers` (OpenAPI 3.1).
  for (const [name, header] of Object.entries(declared.value.headers ?? {})) {
    if (name.toLowerCase() === 'content-type') continue;
    const located = contract.follow<HeaderObject>(header, [...declared.pointer, 'headers', name]);
    const raw = response.headers[name.toLowerCase()];
    const value = Array.isArray(raw) ? raw.join(', ') : raw;
    const subject = `response header ${name}`;
    if (value === undefined) {
      if (located.value.required === true) {
        violations.push({
          subject,
          pointer: '',
          reason: 'is required by the contract but missing',
        });
      }
      continue;
    }
    if (located.value.schema === undefined) continue;
    const schema = contract.follow<SchemaObject>(located.value.schema, [
      ...located.pointer,
      'schema',
    ]);
    const validate = contract.validator(schema.pointer);
    if (!validate(coerce(schema, value))) {
      violations.push(...schemaErrors(subject, validate.errors));
    }
  }

  // Content type and body.
  const content = declared.value.content;
  const mediaType = mediaTypeOf(response.headers['content-type']);
  if (content === undefined || Object.keys(content).length === 0) {
    if (hasBody(response)) {
      violations.push({
        subject: 'response body',
        pointer: '',
        reason: `is present (${mediaType ?? 'no content type'}), but ${key} declares no content`,
      });
    }
    return violations;
  }
  const declaredTypes = Object.keys(content);
  const matched =
    mediaType === undefined ? undefined : declaredTypes.find((m) => mediaTypeMatches(m, mediaType));
  if (mediaType === undefined || matched === undefined) {
    violations.push({
      subject: 'response content type',
      pointer: '',
      reason: `${mediaType ?? '(none)'} is not declared for ${key} (declared: ${declaredTypes.join(', ')})`,
    });
    return violations;
  }
  if (isJsonMediaType(mediaType)) {
    violations.push(
      ...validateAgainst(
        contract,
        'response body',
        {
          value: content[matched]?.schema,
          pointer: [...declared.pointer, 'content', matched, 'schema'],
        },
        response.body,
      ),
    );
  }
  if (response.status >= 400) violations.push(...validateProblem(contract, response));
  return violations;
}

/**
 * Every error response is the shared problem shape (ERROR_HANDLING.md): served as
 * `application/problem+json`, valid against the shared problem schema, with a `code` from the
 * catalogue and a `status` equal to the HTTP status.
 */
export function validateProblem(contract: Contract, response: ExchangeResponse): Violation[] {
  const mediaType = mediaTypeOf(response.headers['content-type']);
  if (mediaType !== PROBLEM_MEDIA_TYPE) {
    return [
      {
        subject: 'error response content type',
        pointer: '',
        reason: `is ${mediaType ?? '(none)'}, expected ${PROBLEM_MEDIA_TYPE}`,
      },
    ];
  }
  const validate = contract.validator(contract.problem.pointer);
  const violations = validate(response.body)
    ? []
    : schemaErrors('error response body', validate.errors).filter(
        // The catalogue check below says the same thing more plainly.
        (v) => v.pointer !== '/code' || !v.reason.startsWith('must be equal to one of'),
      );
  const body = response.body as { code?: unknown; status?: unknown } | null;
  if (typeof body?.code === 'string' && !contract.problem.catalogue.has(body.code)) {
    violations.push({
      subject: 'error response body',
      pointer: '/code',
      reason: `${JSON.stringify(body.code)} is not in the error-code catalogue (ERROR_HANDLING.md §2)`,
    });
  }
  if (typeof body?.status === 'number' && body.status !== response.status) {
    violations.push({
      subject: 'error response body',
      pointer: '/status',
      reason: `is ${String(body.status)} but the HTTP status is ${String(response.status)}`,
    });
  }
  return violations;
}

export function formatViolations(
  heading: string,
  violations: readonly Violation[],
  footer?: string,
): string {
  const lines = violations.map(
    (v) => `  - ${v.subject}${v.pointer ? ` at ${JSON.stringify(v.pointer)}` : ''}: ${v.reason}`,
  );
  return [heading, ...lines, ...(footer ? [footer] : [])].join('\n');
}

export function operationHeading(
  operation: ContractOperation,
  what: 'request' | 'response',
  status?: number,
): string {
  const suffix = status === undefined ? '' : ` → ${String(status)}`;
  return `Contract violation in the ${what} of ${describeOperation(operation)}${suffix}:`;
}
