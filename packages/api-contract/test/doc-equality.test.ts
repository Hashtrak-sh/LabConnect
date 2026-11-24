import { describe, expect, it } from 'vitest';
import { allowedKeys, compareWithContract, parseSection } from './catalogue.js';
import { listOperations, loadBundledDocument, parametersOf, readRepoFile } from './helpers.js';

// API_CONTRACTS.md is the endpoint catalogue. Each section listed here must match the contract
// in both directions: every row exists in the contract, and the contract has no operation under
// a first path segment of a covered section (`/auth`, `/me`, `/public`, …) that no covered row
// allows. How cells are read is in catalogue.ts and pinned by catalogue.test.ts.
//
// To cover another section, add one line: its heading prefix, its number of table rows, and the
// number of `METHOD /path` combinations its rows allow. A wrong count fails with the real one.
const coveredSections: [heading: string, rows: number, operations: number][] = [
  ['## 1. Auth and identity', 10, 14],
  ['## 2. Public', 10, 10],
  ['## 10. Admin', 25, 83],
];

const markdown = readRepoFile('docs/04-api/API_CONTRACTS.md');
const sections = coveredSections.map(([heading]) => parseSection(markdown, heading));
const doc = loadBundledDocument();
const operations = listOperations(doc);

describe('API_CONTRACTS.md and the contract', () => {
  it.each(coveredSections)('parses the table of "%s"', (heading, rows, combinations) => {
    // A change here means the table changed: review the contract against it.
    const section = sections.find((s) => s.heading === heading);
    expect(section?.rows).toBe(rows);
    expect(new Set(section?.groups.flatMap(allowedKeys)).size).toBe(combinations);
  });

  it('has every documented operation and no undocumented one', () => {
    const { missing, extra } = compareWithContract(
      sections,
      operations.map((o) => o.key),
    );
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it('declares the query parameters the catalogue shows', () => {
    for (const group of sections.flatMap((s) => s.groups)) {
      for (const key of allowedKeys(group)) {
        const op = operations.find((o) => o.key === key);
        if (!op) continue; // reported by the test above
        const names = parametersOf(doc, op.operation)
          .filter((p) => p.in === 'query')
          .map((p) => p.name);
        for (const name of group.queryNames) expect(names, key).toContain(name);
      }
    }
  });

  it('keeps the health endpoint that apps/api serves', () => {
    expect(operations.map((o) => o.key)).toContain('GET /health');
  });
});
