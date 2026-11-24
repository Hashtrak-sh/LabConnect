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
