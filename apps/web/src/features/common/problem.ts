/**
 * What the screens need from an API error (ERROR_HANDLING §1): the status, the stable `code`, the
 * wait from `Retry-After`, and the two `meta` fields the claim operations use. `detail` is left
 * out on purpose: screens show their own text from `messages/en.json`, never the API's.
 */
export interface Problem {
  status: number;
  code?: string;
  /** Seconds from `Retry-After`, when the header holds a positive number of seconds. */
  retryAfterSeconds?: number;
  /** `meta.currentState` of a 409 INVALID_STATE_TRANSITION. */
  currentState?: string;
  /** `meta.reason` of a 422 VALIDATION_FAILED the claim review uses. */
  reason?: string;
}

interface Envelope {
  code?: unknown;
  meta?: { currentState?: unknown; reason?: unknown } | null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The seconds of a `Retry-After` header; the HTTP-date form is not used by the API. */
export function retryAfterSeconds(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}

/** Reads a problem from a response status, its headers and its (already parsed) JSON body. */
export function readProblem(
  response: { status: number; headers: { get(name: string): string | null } },
  body: unknown,
): Problem {
  const envelope = (typeof body === 'object' && body !== null ? body : {}) as Envelope;
  const code = text(envelope.code);
  const currentState = text(envelope.meta?.currentState);
  const reason = text(envelope.meta?.reason);
  const wait = retryAfterSeconds(response.headers.get('retry-after'));
  return {
    status: response.status,
    ...(code === undefined ? {} : { code }),
    ...(wait === undefined ? {} : { retryAfterSeconds: wait }),
    ...(currentState === undefined ? {} : { currentState }),
    ...(reason === undefined ? {} : { reason }),
  };
}

/** `"3"`: the strong ETag / `If-Match` form of a lock version (API_CONVENTIONS §4). */
export function etagOf(lockVersion: number): string {
  return `"${String(lockVersion)}"`;
}

/** A value from a hidden `etag` field: only a strong `"<digits>"` is passed on to the API. */
export function cleanEtag(raw: unknown): string | null {
  return typeof raw === 'string' && /^"\d{1,9}"$/.test(raw) ? raw : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value from a form or an address is a UUID (an id is never passed on otherwise). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * The idempotency key of a form: the one the server made when it rendered the form (a hidden
 * field), so a double submit of one form is one operation. A missing or malformed value gets a
 * new key rather than none.
 */
export function formKey(value: unknown): string {
  return typeof value === 'string' && UUID.test(value) ? value : crypto.randomUUID();
}
