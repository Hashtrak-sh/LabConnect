import { describe, expect, it } from 'vitest';
import {
  listOperations,
  loadBundledDocument,
  markdownSection,
  parametersOf,
  readRepoFile,
  tableRows,
} from './helpers.js';

// API_CONTRACTS.md §1 is the catalogue for auth and identity. Every row must exist in the
// contract, and the contract must not add /auth or /me operations the catalogue lacks.

interface DocEntry {
  key: string;
  queryNames: string[];
}

/**
 * Reads the §1 table. A method cell may list several methods (`GET/PATCH`). A path cell may
 * list several paths separated by `·`; a path may carry its own method (`POST /x`) and a query
 * string (`/x?unread=true`).
 */
function documentedAuthOperations(): { rows: number; entries: DocEntry[] } {
  const markdown = readRepoFile('docs/04-api/API_CONTRACTS.md');
  const rows = tableRows(markdownSection(markdown, '## 1. Auth and identity'));
  const entries: DocEntry[] = [];
  for (const [methodCell = '', pathCell = ''] of rows) {
    const rowMethods = methodCell.split('/').map((m) => m.trim());
    for (const part of pathCell.split('·')) {
      const match = /^(?:([A-Z/]+)\s+)?`([^`]+)`$/.exec(part.trim());
      if (!match?.[2]) throw new Error(`Cannot parse path cell part: "${part}"`);
      const methods = match[1] ? match[1].split('/') : rowMethods;
      const [path = '', query] = match[2].split('?');
      const queryNames = query ? query.split('&').map((pair) => pair.split('=')[0] ?? '') : [];
      for (const method of methods) entries.push({ key: `${method} ${path}`, queryNames });
    }
  }
  return { rows: rows.length, entries };
}

const doc = loadBundledDocument();
const operations = listOperations(doc);
const documented = documentedAuthOperations();

describe('API_CONTRACTS.md §1 and the contract', () => {
  it('parses the catalogue table', () => {
    // 10 rows expand to 14 operations. A change here means the table changed: review the contract.
    expect(documented.rows).toBe(10);
    expect(documented.entries).toHaveLength(14);
  });

  it('has every documented operation', () => {
    const inContract = new Set(operations.map((o) => o.key));
    const missing = documented.entries.map((e) => e.key).filter((k) => !inContract.has(k));
    expect(missing).toEqual([]);
  });

  it('has no /auth or /me operation that the catalogue does not list', () => {
    const inDoc = new Set(documented.entries.map((e) => e.key));
    const extra = operations
      .filter((o) => /^\/(auth|me)(\/|$)/.test(o.path))
      .map((o) => o.key)
      .filter((k) => !inDoc.has(k));
    expect(extra).toEqual([]);
  });

  it('declares the query parameters the catalogue shows', () => {
    for (const entry of documented.entries) {
      const op = operations.find((o) => o.key === entry.key);
      if (!op) continue; // reported by the test above
      const names = parametersOf(doc, op.operation)
        .filter((p) => p.in === 'query')
        .map((p) => p.name);
      for (const name of entry.queryNames) expect(names, entry.key).toContain(name);
    }
  });

  it('keeps the health endpoint that apps/api serves', () => {
    expect(operations.map((o) => o.key)).toContain('GET /health');
  });
});
