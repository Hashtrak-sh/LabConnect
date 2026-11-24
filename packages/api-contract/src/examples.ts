// Contract examples as mock data for "the other side" (COLLABORATION_GUIDE.md §2): a consumer
// that is not built yet can be stood in for by the example the contract documents. Node only (it
// reads the bundled document from disk), so it is a separate entry point:
// `@labconnect/api-contract/examples`.
import { readFileSync } from 'node:fs';
import { openApiDocumentUrl } from './index.js';

interface Reference {
  $ref: string;
}
interface MediaType {
  schema?: unknown;
  example?: unknown;
  examples?: Record<string, { value?: unknown } | Reference>;
}
interface ResponseObject {
  content?: Record<string, MediaType>;
}
interface Operation {
  operationId?: string;
  responses?: Record<string, ResponseObject | Reference>;
}
interface Document {
  paths: Record<string, Record<string, unknown>>;
}

const methods = ['get', 'put', 'post', 'delete', 'patch'];

let cached: Document | undefined;
function contractDocument(): Document {
  cached ??= JSON.parse(readFileSync(openApiDocumentUrl, 'utf8')) as Document;
  return cached;
}

function isReference(value: unknown): value is Reference {
  return typeof value === 'object' && value !== null && '$ref' in value;
}

function follow<T>(doc: Document, value: T | Reference): T {
  let current: unknown = value;
  for (let hops = 0; isReference(current); hops += 1) {
    if (hops > 32) throw new Error(`Reference loop at ${current.$ref}`);
    let node: unknown = doc;
    for (const raw of current.$ref.replace(/^#\//, '').split('/')) {
      const key = decodeURIComponent(raw).replaceAll('~1', '/').replaceAll('~0', '~');
      node = (node as Record<string, unknown> | undefined)?.[key];
    }
    current = node;
  }
  return current as T;
}

function operations(doc: Document): Operation[] {
  return Object.values(doc.paths).flatMap((item) =>
    methods.map((m) => item[m] as Operation | undefined).filter((op) => op !== undefined),
  );
}

function firstExample(
  doc: Document,
  media: MediaType,
  status: string,
): { value: unknown } | undefined {
  if (media.example !== undefined) return { value: media.example };
  const first = Object.values(media.examples ?? {})[0];
  if (first !== undefined) {
    const example = follow(doc, first);
    if (example.value !== undefined) return { value: example.value };
  }
  // A schema-level example describes the schema, not this response. It is used only for
  // success responses: the shared error schema's example has its own `status`.
  if (status.startsWith('2') && media.schema !== undefined) {
    const schema = follow(doc, media.schema as { examples?: unknown[] } | Reference);
    if (Array.isArray(schema.examples) && schema.examples.length > 0) {
      return { value: schema.examples[0] };
    }
  }
  return undefined;
}

/**
 * The first example the contract documents for a response, to use as mock data.
 * Looks at the media type's `example`, then its `examples`, then (2xx only) the schema's
 * `examples`. Throws if the contract has none, so a missing example is visible.
 */
export function contractExample(
  operationId: string,
  status: number | string,
  mediaType?: string,
): unknown {
  const doc = contractDocument();
  const operation = operations(doc).find((op) => op.operationId === operationId);
  if (!operation) throw new Error(`${operationId} is not an operationId in the contract`);
  const code = String(status);
  const responses = operation.responses ?? {};
  const key = [code, `${code[0] ?? ''}XX`, 'default'].find((k) => k in responses);
  if (key === undefined) {
    throw new Error(
      `${operationId} declares no ${code} response (has ${Object.keys(responses).join(', ')})`,
    );
  }
  const content = follow(doc, responses[key] as ResponseObject | Reference).content ?? {};
  const type = mediaType ?? Object.keys(content)[0];
  const media = type === undefined ? undefined : content[type];
  if (type === undefined || !media) {
    throw new Error(
      `${operationId} ${key} has no ${mediaType ?? 'content'} to take an example from`,
    );
  }
  const example = firstExample(doc, media, key);
  if (!example) {
    throw new Error(
      `The contract has no example for ${operationId} ${key} ${type}. Add one to ` +
        'packages/api-contract/openapi (an `example` on the media type).',
    );
  }
  return structuredClone(example.value);
}

/** Operations whose first success response has content but no example (for the gap report). */
export function operationsWithoutSuccessExample(): string[] {
  const doc = contractDocument();
  return operations(doc)
    .filter((op) => {
      const responses = op.responses ?? {};
      const success = Object.keys(responses)
        .filter((k) => k.startsWith('2'))
        .sort()[0];
      if (success === undefined) return true;
      const content = follow(doc, responses[success] as ResponseObject | Reference).content ?? {};
      const entries = Object.values(content);
      if (entries.length === 0) return false; // 204 and the like: nothing to mock.
      return !entries.some((media) => firstExample(doc, media, success) !== undefined);
    })
    .map((op) => op.operationId ?? '(no operationId)')
    .sort();
}
