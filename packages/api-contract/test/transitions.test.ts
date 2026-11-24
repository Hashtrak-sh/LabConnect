import { describe, expect, it } from 'vitest';
import { allowedKeys, firstTable, parseRow } from './catalogue.js';
import {
  bookingStateMachineSource,
  listOperations,
  loadBundledDocument,
  markdownSection,
  readRepoFile,
  requiresHeader,
  sharedTransitionIds,
  transitionIds,
} from './helpers.js';

// Booking transitions (BOOKING_STATE_MACHINE.md §3). An operation that performs transitions lists
// them in `x-transitions`. packages/shared is read as text: api-contract does not depend on it.

const doc = loadBundledDocument();
const operations = listOperations(doc);

describe('booking transitions', () => {
  const sharedIds = sharedTransitionIds();
  /** Transitions that create the aggregate (`from: []`), so there is no version to match. */
  const creating = new Set(
    [...bookingStateMachineSource().matchAll(/id: '(T-\d{2})',\s*from: \[\]/g)].map(
      (m) => m[1] ?? '',
    ),
  );
  const performing = operations.filter((o) => (o.operation['x-transitions'] ?? []).length > 0);

  /** T-ids named in a cell: `T-03`, `T-07 / T-08`, `T-25/26/27`, `T-16 or REPLACE/CANCEL`. */
  function transitionsInCell(cell: string): string[] {
    return [...cell.matchAll(/T-\d{2}(?:\s*\/\s*(?:T-)?\d{2})*/g)].flatMap((m) =>
      [...m[0].matchAll(/\d{2}/g)].map((d) => `T-${d[0]}`),
    );
  }

  it('reads the transition ids of packages/shared', () => {
    expect(sharedIds.length).toBeGreaterThan(0);
    expect(creating).toEqual(new Set(['T-01']));
  });

  it('has the same ids in BookingTransitionId as packages/shared', () => {
    expect(doc.components.schemas.BookingTransitionId?.enum).toEqual(sharedIds);
  });

  it('are declared only with ids of packages/shared', () => {
    const unknown = performing.flatMap(({ key, operation }) =>
      (operation['x-transitions'] ?? [])
        .filter((id) => !sharedIds.includes(id))
        .map((id) => `${key}: ${id}`),
    );
    expect(performing.length).toBeGreaterThan(0);
    expect(unknown).toEqual([]);
  });

  it('are each named in the operation description', () => {
    const unnamed = performing.flatMap(({ key, operation }) =>
      (operation['x-transitions'] ?? [])
        .filter((id) => !(operation.description ?? '').includes(id))
        .map((id) => `${key}: ${id}`),
    );
    expect(unnamed).toEqual([]);
  });

  it('name only transition ids that packages/shared defines', () => {
    // In the description of any operation, whether it performs a transition or not.
    const known = new Set(sharedIds);
    expect(known.size).toBe(28);
    const unknown = operations.flatMap(({ key, operation }) =>
      transitionIds(operation.description ?? '')
        .filter((id) => !known.has(id))
        .map((id) => `${key}: ${id}`),
    );
    expect(unknown).toEqual([]);
  });

  it('require If-Match unless they create the aggregate (API_CONVENTIONS §4)', () => {
    const missing = performing
      .filter(({ operation }) => (operation['x-transitions'] ?? []).some((id) => !creating.has(id)))
      .filter(({ operation }) => !requiresHeader(doc, operation, 'If-Match'))
      .map((o) => o.key);
    expect(missing).toEqual([]);
  });

  it('match the Transition column of API_CONTRACTS.md for every documented operation', () => {
    // Every T-id a row names is performed by one of the row's operations, and a row that names
    // none has no operation that performs one. Rows whose operations are not in the contract yet
    // are skipped here; doc-equality.test.ts reports them for covered sections.
    const markdown = readRepoFile('docs/04-api/API_CONTRACTS.md');
    const byKey = new Map(operations.map((o) => [o.key, o.operation]));
    const problems: string[] = [];
    let checked = 0;
    for (const heading of markdown.split(/\r?\n/).filter((line) => line.startsWith('## '))) {
      const { header, rows } = (() => {
        try {
          return firstTable(markdownSection(markdown, heading));
        } catch {
          return { header: [], rows: [] };
        }
      })();
      const column = header.indexOf('Transition');
      if (column === -1) continue;
      const [methodColumn, pathColumn] = [header.indexOf('Method'), header.indexOf('Path')];
      for (const row of rows) {
        const keys = parseRow(row[methodColumn] ?? '', row[pathColumn] ?? '')
          .flatMap(allowedKeys)
          .filter((key) => byKey.has(key));
        if (keys.length === 0) continue;
        checked += 1;
        const named = transitionsInCell(row[column] ?? '');
        const performed = new Set(keys.flatMap((key) => byKey.get(key)?.['x-transitions'] ?? []));
        if (named.length === 0 && performed.size > 0) {
          problems.push(
            `${keys.join(', ')}: performs ${[...performed].join(', ')}, row names none`,
          );
        }
        for (const id of named.filter((t) => !performed.has(t))) {
          problems.push(`${keys.join(', ')}: row names ${id}, no operation declares it`);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
