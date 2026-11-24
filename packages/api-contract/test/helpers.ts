import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const packageDir = fileURLToPath(new URL('..', import.meta.url));
export const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

export function readRepoFile(relativePath: string): string {
  return readFileSync(new URL(`../../../${relativePath}`, import.meta.url), 'utf8');
}

// Minimal shapes of the bundled OpenAPI document, enough for the convention checks.
export interface Ref {
  $ref: string;
  description?: string;
}
export interface Schema {
  type?: string | string[];
  enum?: string[];
  properties?: Record<string, Schema | Ref>;
  [key: string]: unknown;
}
export interface Parameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  required?: boolean;
}
export interface MediaType {
  schema?: Schema | Ref;
}
export interface Response {
  description: string;
  headers?: Record<string, unknown>;
  content?: Record<string, MediaType>;
}
export interface Operation {
  operationId?: string;
  description?: string;
  tags?: string[];
  /** Booking transitions (T-xx) the operation performs (BOOKING_STATE_MACHINE.md §3). */
  'x-transitions'?: string[];
  security?: Record<string, string[]>[];
  parameters?: (Parameter | Ref)[];
  requestBody?: unknown;
  responses: Record<string, Response | Ref>;
}
export const httpMethods = ['get', 'put', 'post', 'delete', 'patch'] as const;
export type HttpMethod = (typeof httpMethods)[number];
export type PathItem = Partial<Record<HttpMethod, Operation>>;
export interface OpenApiDocument {
  openapi: string;
  tags?: { name: string }[];
  security?: Record<string, string[]>[];
  paths: Record<string, PathItem>;
  components: {
    schemas: Record<string, Schema>;
    parameters: Record<string, Parameter>;
    headers: Record<string, unknown>;
    responses: Record<string, Response>;
  };
}

/** The bundled document written by `pnpm generate` (the test script runs it first). */
export function loadBundledDocument(): OpenApiDocument {
  const text = readFileSync(new URL('../src/generated/openapi.json', import.meta.url), 'utf8');
  return JSON.parse(text) as OpenApiDocument;
}

export function isRef(value: unknown): value is Ref {
  return typeof value === 'object' && value !== null && '$ref' in value;
}

/** Follows a local `#/components/...` reference. */
export function resolve<T>(doc: OpenApiDocument, value: T | Ref): T {
  if (!isRef(value)) return value;
  if (!value.$ref.startsWith('#/')) throw new Error(`Not a local reference: ${value.$ref}`);
  let node: unknown = doc;
  for (const segment of value.$ref.slice(2).split('/')) {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (typeof node !== 'object' || node === null || !(key in node)) {
      throw new Error(`Unresolvable reference: ${value.$ref}`);
    }
    node = (node as Record<string, unknown>)[key];
  }
  return resolve(doc, node as T | Ref);
}

export interface OperationEntry {
  method: HttpMethod;
  path: string;
  key: string;
  operation: Operation;
}

export function listOperations(doc: OpenApiDocument): OperationEntry[] {
  const entries: OperationEntry[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of httpMethods) {
      const operation = item[method];
      if (operation)
        entries.push({ method, path, key: `${method.toUpperCase()} ${path}`, operation });
    }
  }
  return entries;
}

export function parametersOf(doc: OpenApiDocument, operation: Operation): Parameter[] {
  return (operation.parameters ?? []).map((p) => resolve<Parameter>(doc, p));
}

/** Is a required `header` parameter of the operation named `name`? */
export function requiresHeader(doc: OpenApiDocument, operation: Operation, name: string): boolean {
  const p = parametersOf(doc, operation).find((x) => x.name === name);
  return p?.in === 'header' && p.required === true;
}

/** Effective response description: a `$ref` may override the shared one. */
export function describeResponse(doc: OpenApiDocument, value: Response | Ref): string {
  if (isRef(value)) return value.description ?? resolve<Response>(doc, value).description;
  return value.description;
}

/**
 * Schemas of the request body, or of the success (2xx) responses, of an operation. Error
 * responses all use the shared `Problem` schema, which conventions.test.ts checks.
 */
export function bodySchemas(
  doc: OpenApiDocument,
  operation: Operation,
  part: 'request' | 'response',
): unknown[] {
  if (part === 'request') {
    const body = operation.requestBody as { content?: Record<string, MediaType> } | undefined;
    return Object.values(body?.content ?? {}).map((m) => m.schema);
  }
  return Object.entries(operation.responses)
    .filter(([status]) => status.startsWith('2'))
    .flatMap(([, value]) => Object.values(resolve<Response>(doc, value).content ?? {}))
    .map((m) => m.schema);
}

// --- Walking schemas ---

export interface SchemaNode {
  node: Record<string, unknown>;
  /** Where the node is: the start label, then keys; a `$ref` restarts it at the reference. */
  at: string;
  /** The component name when the node was reached through `#/components/schemas/<name>`. */
  name: string | undefined;
}

/**
 * Every schema object reachable from `node`, following each `$ref` once. Examples are skipped.
 * The `properties` map itself is not a schema; each of its values is.
 */
export function schemaNodes(
  doc: OpenApiDocument,
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
    return schemaNodes(doc, resolve(doc, node), node.$ref, component, seen);
  }
  const record = node as Record<string, unknown>;
  const found: SchemaNode[] = [{ node: record, at, name }];
  for (const [key, value] of Object.entries(record)) {
    if (key === 'examples' || key === 'example') continue;
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      for (const [property, child] of Object.entries(value as Record<string, unknown>)) {
        found.push(...schemaNodes(doc, child, `${at}/properties/${property}`, undefined, seen));
      }
      continue;
    }
    found.push(...schemaNodes(doc, value, `${at}/${key}`, undefined, seen));
  }
  return found;
}

export interface PropertyEntry {
  name: string;
  /** The property's own schema, possibly a `$ref`. */
  schema: unknown;
  /** Where the object that declares the property is (see `SchemaNode.at`). */
  at: string;
}

/** Every property declared anywhere in the schemas reachable from `node`. */
export function reachableProperties(
  doc: OpenApiDocument,
  node: unknown,
  at = '#',
): PropertyEntry[] {
  return schemaNodes(doc, node, at).flatMap(({ node: n, at: where }) => {
    const properties = n.properties;
    if (typeof properties !== 'object' || properties === null) return [];
    return Object.entries(properties as Record<string, unknown>).map(([name, schema]) => ({
      name,
      schema,
      at: where,
    }));
  });
}

/** Names of the properties reachable from `node`, lower-cased. */
export function reachablePropertyNames(doc: OpenApiDocument, node: unknown): Set<string> {
  return new Set(reachableProperties(doc, node).map((p) => p.name.toLowerCase()));
}

/**
 * The structure of a schema with every `$ref` inlined and documentation dropped (`description`,
 * `title`, `examples`, `example`): two schemas with the same structure accept the same JSON. A
 * reference back into the schema being expanded becomes `{ $cycle: <depth> }`.
 */
export function schemaStructure(
  doc: OpenApiDocument,
  node: unknown,
  stack: string[] = [],
): unknown {
  if (Array.isArray(node)) return node.map((item) => schemaStructure(doc, item, stack));
  if (typeof node !== 'object' || node === null) return node;
  if (isRef(node)) {
    const depth = stack.indexOf(node.$ref);
    if (depth !== -1) return { $cycle: stack.length - depth };
    return schemaStructure(doc, resolve(doc, { $ref: node.$ref }), [...stack, node.$ref]);
  }
  const out: Record<string, unknown> = {};
  const entries = Object.entries(node as Record<string, unknown>);
  for (const [key, value] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    if (['description', 'title', 'examples', 'example'].includes(key)) continue;
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      // Property names are data, not keywords: keep every one, even `description`.
      out[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, child]) => [name, schemaStructure(doc, child, stack)]),
      );
      continue;
    }
    // `required` is a set: its order means nothing.
    out[key] =
      key === 'required' && Array.isArray(value)
        ? [...(value as string[])].sort()
        : schemaStructure(doc, value, stack);
  }
  return out;
}

// --- Other sources of truth, read as text (api-contract depends on no other package) ---

/** The error catalogue of ERROR_HANDLING.md §2: code → HTTP status. */
export function errorCatalogue(): Map<string, number> {
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
export function prismaEnums(): Map<string, string[]> {
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

/** packages/shared/src/booking-state-machine.ts, the source of the booking transitions. */
export function bookingStateMachineSource(): string {
  return readRepoFile('packages/shared/src/booking-state-machine.ts');
}

/** The transition ids `TRANSITION_IDS` of packages/shared, in order. */
export function sharedTransitionIds(): string[] {
  const block =
    /export const TRANSITION_IDS = \[([\s\S]*?)\] as const/.exec(
      bookingStateMachineSource(),
    )?.[1] ?? '';
  return [...block.matchAll(/'(T-\d{2})'/g)].map((m) => m[1] ?? '');
}

/** The lines of a markdown section, from its heading to the next heading of the same level. */
export function markdownSection(markdown: string, headingPrefix: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(headingPrefix));
  if (start === -1) throw new Error(`Heading not found: ${headingPrefix}`);
  const level = /^#+ /.exec(headingPrefix)?.[0] ?? '## ';
  const end = lines.findIndex((line, i) => i > start && line.startsWith(level));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

/** Body rows of the first markdown table in the given lines, split into trimmed cells. */
export function tableRows(lines: string[]): string[][] {
  const rows = lines
    .filter((line) => line.trimStart().startsWith('|'))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, '')
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim()),
    );
  // Drop the header row and the separator row.
  return rows.slice(2);
}

/**
 * Booking transition ids (BOOKING_STATE_MACHINE.md §3) named in a text, in order of appearance:
 * `T-13 / T-17` → T-13, T-17; `T-25/26/27` → T-25, T-26, T-27.
 */
export function transitionIds(text: string): string[] {
  return [...text.matchAll(/\bT-(\d{2})((?:\/\d{2})*)/g)].flatMap((m) => [
    `T-${m[1] ?? ''}`,
    ...(m[2] ?? '')
      .split('/')
      .filter((n) => n !== '')
      .map((n) => `T-${n}`),
  ]);
}

/** Backticked tokens in a markdown cell or description. */
export function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
}
