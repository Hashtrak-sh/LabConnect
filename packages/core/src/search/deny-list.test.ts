import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { searchDocument } from '../../test/support/search-documents.js';
import { PUBLIC_BOUNDARY_DENY_LIST, deniedFieldPaths } from './deny-list.js';
import { toSource } from './opensearch-mapping.js';
import { INDEX_MAPPINGS } from './opensearch-mapping.js';
import { documentToSite } from './result-mapping.js';

const normalise = (name: string): string => name.replaceAll('_', '').toLowerCase();

/** Every property name of a mapping, at any depth. */
function mappingFields(properties: Record<string, unknown>): string[] {
  return Object.entries(properties).flatMap(([name, definition]) => {
    const nested = (definition as { properties?: Record<string, unknown> }).properties;
    return [name, ...(nested ? mappingFields(nested) : [])];
  });
}

describe('the public boundary deny-list', () => {
  it('has every name of the contract test it mirrors', () => {
    const source = readFileSync(
      new URL('../../../api-contract/test/public-boundary.test.ts', import.meta.url),
      'utf8',
    );
    const block = /const denyList: Record<string, string> = \{([\s\S]*?)\n\};/.exec(source)?.[1];
    expect(block).toBeDefined();
    const names = [...(block ?? '').matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1] ?? '');
    expect(names.length).toBeGreaterThan(40);
    expect(PUBLIC_BOUNDARY_DENY_LIST.map(normalise).sort()).toEqual(names.map(normalise).sort());
  });

  it('finds a denied field at any depth, in any spelling', () => {
    expect(deniedFieldPaths({ a: [{ lab_org_id: 1 }], b: { contactEmail: 'x' }, ok: 1 })).toEqual([
      'a[0].lab_org_id',
      'b.contactEmail',
    ]);
    expect(deniedFieldPaths({ nested: { deeper: { Capacity: 3 } } })).toEqual([
      'nested.deeper.Capacity',
    ]);
    expect(deniedFieldPaths(new Date('2026-11-25T00:00:00Z'))).toEqual([]);
  });

  it('is not hit by the document, its index form, or the fields of the index mapping', () => {
    const doc = searchDocument();
    expect(deniedFieldPaths(doc)).toEqual([]);
    expect(deniedFieldPaths(toSource(doc))).toEqual([]);
    expect(deniedFieldPaths(documentToSite(doc, []))).toEqual([]);
    const denied = new Set(PUBLIC_BOUNDARY_DENY_LIST.map(normalise));
    for (const field of mappingFields(INDEX_MAPPINGS.properties)) {
      expect(denied.has(normalise(field)), field).toBe(false);
    }
  });

  it('catches a document that leaks a field (the check has teeth)', () => {
    const leaky = { ...searchDocument(), labOrgId: 'org-1', responsiveness_score: 0.9 };
    expect(deniedFieldPaths(leaky)).toEqual(['labOrgId', 'responsiveness_score']);
    const withContact = {
      ...toSource(searchDocument()),
      accreditation: { ...toSource(searchDocument()).accreditation, contact_email: 'x@y' },
    };
    expect(deniedFieldPaths(withContact)).toEqual(['accreditation.contact_email']);
  });

  it('keeps unknown fields out of the index (dynamic: strict)', () => {
    expect(INDEX_MAPPINGS.dynamic).toBe('strict');
  });
});
