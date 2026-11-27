import { SearchCursorError } from './errors.js';
import type { SearchBackend } from './model.js';

/**
 * Cursors are opaque to the client (API_CONVENTIONS). Ours are base64url JSON, prefixed with the
 * backend that issued them: a cursor from OpenSearch means nothing to Postgres and the other way
 * round, so asking one backend with the other's cursor is refused (`SearchCursorError`) rather
 * than answered with a repeated or skipped page. The content is a sort position (a number and a
 * site id): no search text, no location and no user data (OQ-40).
 */
export interface PositionCursor {
  /** Sort key of the last site of the previous page; for OpenSearch, the offset of the next page. */
  k: number;
  /** Its site id. */
  id: string;
  /**
   * Its relevance (best text score, 0 without text), the tie-break between equal sort keys:
   * sites with the same price, turnaround or distance come best match first, then by id. Absent
   * in a cursor from before the tie-break (and on OpenSearch, which pages by offset).
   */
  r?: number;
}

const PREFIX: Record<SearchBackend, string> = {
  postgres: 'pg1.',
  opensearch: 'os1.',
  memory: 'mem1.',
};

export function encodeCursor(backend: SearchBackend, position: PositionCursor): string {
  return PREFIX[backend] + Buffer.from(JSON.stringify(position), 'utf8').toString('base64url');
}

/** The backend that issued the cursor, or `null` when it carries no known prefix. */
export function cursorBackend(cursor: string): SearchBackend | null {
  for (const [backend, prefix] of Object.entries(PREFIX)) {
    if (cursor.startsWith(prefix)) return backend as SearchBackend;
  }
  return null;
}

export function decodeCursor(backend: SearchBackend, cursor: string): PositionCursor {
  if (cursorBackend(cursor) !== backend) throw new SearchCursorError();
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor.slice(PREFIX[backend].length), 'base64url').toString('utf8'),
    );
    if (typeof parsed === 'object' && parsed !== null) {
      const { k, id, r } = parsed as Record<string, unknown>;
      if (typeof k === 'number' && Number.isFinite(k) && typeof id === 'string' && id.length > 0) {
        if (r === undefined) return { k, id };
        if (typeof r === 'number' && Number.isFinite(r)) return { k, id, r };
      }
    }
  } catch {
    // fall through
  }
  throw new SearchCursorError();
}
