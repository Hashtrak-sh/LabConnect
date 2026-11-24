// The bundled OpenAPI 3.1 contract, indexed for the contract-test harness (task P2-08).
// Everything here is keyed by operations (method, path, operationId) and by JSON pointers into
// the bundled document. Nothing depends on the names of component schemas.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const httpMethods = ['get', 'put', 'post', 'delete', 'patch'] as const;
export type HttpMethod = (typeof httpMethods)[number];

export interface Reference {
  $ref: string;
}
export type SchemaObject = Record<string, unknown>;
export interface ParameterObject {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  required?: boolean;
  style?: string;
  explode?: boolean;
  schema?: SchemaObject | Reference;
}
export interface MediaTypeObject {
  schema?: SchemaObject | Reference;
}
export interface HeaderObject {
  required?: boolean;
  schema?: SchemaObject | Reference;
}
export interface ResponseObject {
  description?: string;
  headers?: Record<string, HeaderObject | Reference>;
  content?: Record<string, MediaTypeObject>;
}
export interface RequestBodyObject {
  required?: boolean;
  content?: Record<string, MediaTypeObject>;
}
export interface OperationObject {
  operationId?: string;
  parameters?: (ParameterObject | Reference)[];
  requestBody?: RequestBodyObject | Reference;
  responses?: Record<string, ResponseObject | Reference>;
}
export type PathItemObject = Partial<Record<HttpMethod, OperationObject>> & {
  parameters?: (ParameterObject | Reference)[];
};
export interface OpenApiDocument {
  openapi: string;
  servers?: { url: string }[];
  paths: Record<string, PathItemObject>;
}

/** A JSON pointer as a list of unescaped segments, from the document root. */
export type Pointer = readonly string[];

/** A value of the document together with the pointer where it lives (after following refs). */
export interface Located<T> {
  value: T;
  pointer: Pointer;
}

export interface ContractOperation {
  operationId: string;
  /** Upper case, as in a request line: `GET`. */
  method: string;
  /** The template under `paths`, for example `/bookings/{id}/accept`. */
  pathTemplate: string;
  /** The template as served, with the server prefix: `/v1/bookings/{id}/accept`. */
  servedPath: string;
  operation: OperationObject;
  pointer: Pointer;
  /** Path-item and operation parameters, merged (the operation wins), refs followed. */
  parameters: Located<ParameterObject>[];
  /** Methods and served paths whose parameters are all `{}`: `GET /v1/bookings/{}`. */
  routeKey: string;
  matcher: RegExp;
  pathParameterNames: string[];
  /** Literal path segments. With several matches, the most literal template wins. */
  literalSegments: number;
}

/** `GET /v1/x` → readable label used in every failure message. */
export function describeOperation(op: ContractOperation): string {
  return `${op.operationId} (${op.method} ${op.servedPath})`;
}

export function isReference(value: unknown): value is Reference {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<Reference>).$ref === 'string'
  );
}

export function pointerToString(pointer: Pointer): string {
  return `#/${pointer.map((s) => s.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
}

function pointerFromRef(ref: string): Pointer {
  if (!ref.startsWith('#/')) {
    throw new Error(`The bundled contract has a non-local reference: ${ref}`);
  }
  return ref
    .slice(2)
    .split('/')
    .map((s) => decodeURIComponent(s).replaceAll('~1', '/').replaceAll('~0', '~'));
}

/** Turns `/bookings/{id}` (contract) or `/bookings/:id` (Express) into `/bookings/{}`. */
export function routeSkeleton(path: string): string {
  return path.replace(/\{[^}/]+\}/g, '{}').replace(/:[A-Za-z0-9_]+/g, '{}');
}

const SCHEMA_REGISTRY_KEY = 'labconnect-contract.json';

export class Contract {
  readonly operations: readonly ContractOperation[];
  readonly serverPrefix: string;
  /** Pointer to the shared problem schema and its error-code catalogue. */
  readonly problem: { pointer: Pointer; catalogue: ReadonlySet<string> };
  private readonly ajv: Ajv2020;
  private readonly validators = new Map<string, ValidateFunction>();

  constructor(readonly document: OpenApiDocument) {
    this.serverPrefix = serverPrefixOf(document);
    this.operations = this.indexOperations();
    this.ajv = new Ajv2020({
      allErrors: true,
      // The OpenAPI 3.1 dialect adds keywords (`discriminator`, `example`, `x-…`) that are
      // annotations for validation. Redocly lints the schemas themselves; here they only validate.
      strict: false,
      validateFormats: true,
    });
    addFormats.default(this.ajv);
    this.assertFormatsKnown();
    // The whole document is registered once; schemas are compiled on first use by pointer, so
    // `#/components/...` references resolve against the bundle.
    this.ajv.addSchema(document, SCHEMA_REGISTRY_KEY, undefined, false);
    this.problem = this.findProblemSchema();
  }

  byOperationId(operationId: string): ContractOperation | undefined {
    return this.operations.find((op) => op.operationId === operationId);
  }

  /** The operation a concrete request path (as called, without query) is routed to. */
  match(
    method: string,
    path: string,
  ): { operation: ContractOperation; pathParameters: Record<string, string> } | undefined {
    const upper = method.toUpperCase();
    const candidates = this.operations
      .filter((op) => op.method === upper)
      .map((op) => ({ op, match: op.matcher.exec(path) }))
      .filter((c): c is { op: ContractOperation; match: RegExpExecArray } => c.match !== null)
      .sort((a, b) => b.op.literalSegments - a.op.literalSegments);
    const best = candidates[0];
    if (!best) return undefined;
    const pathParameters: Record<string, string> = {};
    best.op.pathParameterNames.forEach((name, i) => {
      pathParameters[name] = decodeURIComponent(best.match[i + 1] ?? '');
    });
    return { operation: best.op, pathParameters };
  }

  /** Follows `$ref`s from a value at `pointer` to the object they name. */
  follow<T>(value: T | Reference, pointer: Pointer): Located<T> {
    let current: unknown = value;
    let at = pointer;
    const seen = new Set<string>();
    while (isReference(current)) {
      if (seen.has(current.$ref)) throw new Error(`Circular reference: ${current.$ref}`);
      seen.add(current.$ref);
      at = pointerFromRef(current.$ref);
      current = this.at(at);
    }
    return { value: current as T, pointer: at };
  }

  /** The value at a pointer, or undefined. */
  at(pointer: Pointer): unknown {
    let node: unknown = this.document;
    for (const segment of pointer) {
      if (typeof node !== 'object' || node === null) return undefined;
      node = (node as Record<string, unknown>)[segment];
    }
    return node;
  }

  /** A compiled JSON Schema 2020-12 validator for the schema at `pointer`. */
  validator(pointer: Pointer): ValidateFunction {
    const key = pointerToString(pointer);
    let validate = this.validators.get(key);
    if (!validate) {
      const fragment = pointer.map((s) =>
        encodeURIComponent(s.replaceAll('~', '~0').replaceAll('/', '~1')),
      );
      const found = this.ajv.getSchema(`${SCHEMA_REGISTRY_KEY}#/${fragment.join('/')}`);
      if (!found) throw new Error(`No schema at ${key} in the contract`);
      validate = found;
      this.validators.set(key, validate);
    }
    return validate;
  }

  private indexOperations(): ContractOperation[] {
    const operations: ContractOperation[] = [];
    for (const [pathTemplate, pathItem] of Object.entries(this.document.paths)) {
      for (const method of httpMethods) {
        const operation = pathItem[method];
        if (!operation) continue;
        const pointer = ['paths', pathTemplate, method];
        if (!operation.operationId) {
          throw new Error(`${method.toUpperCase()} ${pathTemplate} has no operationId`);
        }
        const servedPath = `${this.serverPrefix}${pathTemplate}`;
        const pathParameterNames: string[] = [];
        const pattern = servedPath
          .split(/(\{[^}/]+\})/)
          .map((part) => {
            const param = /^\{([^}/]+)\}$/.exec(part);
            if (param?.[1]) {
              pathParameterNames.push(param[1]);
              return '([^/]+)';
            }
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          })
          .join('');
        operations.push({
          operationId: operation.operationId,
          method: method.toUpperCase(),
          pathTemplate,
          servedPath,
          operation,
          pointer,
          parameters: this.mergeParameters(pathItem, operation, pathTemplate, method),
          routeKey: `${method.toUpperCase()} ${routeSkeleton(servedPath)}`,
          matcher: new RegExp(`^${pattern}/?$`),
          pathParameterNames,
          literalSegments: servedPath.split('/').filter((s) => s !== '' && !s.includes('{')).length,
        });
      }
    }
    return operations;
  }

  private mergeParameters(
    pathItem: PathItemObject,
    operation: OperationObject,
    pathTemplate: string,
    method: HttpMethod,
  ): Located<ParameterObject>[] {
    const merged = new Map<string, Located<ParameterObject>>();
    const add = (list: (ParameterObject | Reference)[] | undefined, base: Pointer): void => {
      list?.forEach((p, i) => {
        const located = this.follow(p, [...base, 'parameters', String(i)]);
        const name =
          located.value.in === 'header' ? located.value.name.toLowerCase() : located.value.name;
        merged.set(`${located.value.in}:${name}`, located);
      });
    };
    add(pathItem.parameters, ['paths', pathTemplate]);
    add(operation.parameters, ['paths', pathTemplate, method]);
    return [...merged.values()];
  }

  /** Fails loudly if the contract uses a `format` that would otherwise be ignored. */
  private assertFormatsKnown(): void {
    const unknown = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node !== 'object' || node === null) return;
      for (const [key, value] of Object.entries(node)) {
        if (key === 'format' && typeof value === 'string' && !this.ajv.formats[value]) {
          unknown.add(value);
        }
        walk(value);
      }
    };
    walk(this.document);
    if (unknown.size > 0) {
      throw new Error(
        `The contract uses formats the validator does not know: ${[...unknown].join(', ')}. ` +
          'Register them in apps/api/test/support/contract/document.ts.',
      );
    }
  }

  /**
   * The shared problem shape (ERROR_HANDLING.md): the schema that most `application/problem+json`
   * responses use. Found by usage, not by name, so renaming the component does not break it.
   */
  private findProblemSchema(): { pointer: Pointer; catalogue: ReadonlySet<string> } {
    const counts = new Map<string, { pointer: Pointer; count: number }>();
    for (const op of this.operations) {
      for (const [status, response] of Object.entries(op.operation.responses ?? {})) {
        const located = this.follow(response, [...op.pointer, 'responses', status]);
        const media = located.value.content?.['application/problem+json'];
        if (!media?.schema) continue;
        const schemaPointer = [...located.pointer, 'content', 'application/problem+json', 'schema'];
        const target = this.follow(media.schema, schemaPointer).pointer;
        const key = pointerToString(target);
        const entry = counts.get(key) ?? { pointer: target, count: 0 };
        entry.count += 1;
        counts.set(key, entry);
      }
    }
    const best = [...counts.values()].sort((a, b) => b.count - a.count)[0];
    if (!best) throw new Error('The contract declares no application/problem+json response');
    const schema = this.at(best.pointer) as { properties?: Record<string, unknown> } | undefined;
    const code = schema?.properties?.code;
    const codeSchema =
      code === undefined
        ? undefined
        : this.follow(code as SchemaObject | Reference, [...best.pointer, 'properties', 'code'])
            .value;
    const values = codeSchema?.enum;
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(
        `The shared problem schema at ${pointerToString(best.pointer)} has no \`code\` enum ` +
          '(the error-code catalogue of ERROR_HANDLING.md).',
      );
    }
    return { pointer: best.pointer, catalogue: new Set(values.map(String)) };
  }
}

function serverPrefixOf(document: OpenApiDocument): string {
  const url = document.servers?.[0]?.url ?? '';
  const path = /^[a-z]+:\/\//i.test(url) ? new URL(url).pathname : url;
  return path.replace(/\/+$/, '');
}

let cached: Contract | undefined;

/**
 * The contract bundled by `pnpm contract:generate` (`@labconnect/api-contract/openapi.json`).
 * Loaded once per test worker.
 */
export function loadContract(): Contract {
  if (!cached) {
    const require = createRequire(import.meta.url);
    let text: string;
    try {
      text = readFileSync(require.resolve('@labconnect/api-contract/openapi.json'), 'utf8');
    } catch (cause) {
      throw new Error(
        'The bundled contract is missing. Run `pnpm contract:generate` (or `pnpm test:contract`).',
        { cause },
      );
    }
    cached = new Contract(JSON.parse(text) as OpenApiDocument);
  }
  return cached;
}
