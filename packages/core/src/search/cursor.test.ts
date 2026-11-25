import { describe, expect, it } from 'vitest';
import { cursorBackend, decodeCursor, encodeCursor } from './cursor.js';
import { SearchCursorError } from './errors.js';

describe('cursors', () => {
  it('round-trips a position and names the backend that issued it', () => {
    const cursor = encodeCursor('postgres', { k: -0.75, id: 'site-1' });
    expect(cursor.startsWith('pg1.')).toBe(true);
    expect(cursorBackend(cursor)).toBe('postgres');
    expect(decodeCursor('postgres', cursor)).toEqual({ k: -0.75, id: 'site-1' });
    const os = encodeCursor('opensearch', { k: 1, id: 'x', s: [1.5, 'x', 'y'] });
    expect(decodeCursor('opensearch', os)).toEqual({ k: 1, id: 'x', s: [1.5, 'x', 'y'] });
  });

  it("refuses another backend's cursor, garbage and a cursor with the wrong content", () => {
    const pg = encodeCursor('postgres', { k: 1, id: 'a' });
    expect(() => decodeCursor('opensearch', pg)).toThrow(SearchCursorError);
    expect(() => decodeCursor('postgres', 'whatever')).toThrow(SearchCursorError);
    expect(() => decodeCursor('postgres', 'pg1.%%%')).toThrow(SearchCursorError);
    const wrong = `pg1.${Buffer.from(JSON.stringify({ k: 'x', id: 1 })).toString('base64url')}`;
    expect(() => decodeCursor('postgres', wrong)).toThrow(SearchCursorError);
    const badSort = `os1.${Buffer.from(JSON.stringify({ k: 1, id: 'a', s: [{}] })).toString('base64url')}`;
    expect(() => decodeCursor('opensearch', badSort)).toThrow(SearchCursorError);
  });

  it('holds no search text, location or user data', () => {
    const cursor = encodeCursor('postgres', { k: 0, id: 'site-1' });
    const decoded = Buffer.from(cursor.slice(4), 'base64url').toString('utf8');
    expect(Object.keys(JSON.parse(decoded) as object).sort()).toEqual(['id', 'k']);
  });
});
