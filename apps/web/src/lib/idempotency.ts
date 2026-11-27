import { randomUUID } from 'node:crypto';

/**
 * `Idempotency-Key` handling for the web forms that create something (API_CONVENTIONS §5). The
 * form carries one key in a hidden field, made on the server; it is sent until the API answers in
 * a way that says the attempt is over.
 */

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The key the form sent, or a new one when it sent none or a malformed one. */
export function formIdempotencyKey(form: FormData, field = 'idempotencyKey'): string {
  const sent = form.get(field);
  return typeof sent === 'string' && KEY.test(sent) ? sent : randomUUID();
}

/**
 * The key for the next submit after the API answered `status`:
 * - 409 (the same key still being worked on) and 5xx (the API, or a proxy in front of it, may
 *   have finished the work without the answer arriving; 5xx is never stored, so a retry with the
 *   same key either replays the stored success or runs once): keep it;
 * - anything else (stored 404, 409 and 422 answers are replayed for the same key, so a corrected
 *   form must not reuse it): a new one.
 */
export function idempotencyKeyAfter(status: number, key: string): string {
  return status === 409 || status >= 500 ? key : randomUUID();
}
