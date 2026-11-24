import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBundledDocument, packageDir, schemaStructure } from './helpers.js';

// How the contract is organised (openapi/openapi.yaml, API_CONVENTIONS.md §1): every component is
// defined once, registered once under its own name, used, and not a copy of another one.

const doc = loadBundledDocument();
const openapiDir = join(packageDir, 'openapi');
const root = readFileSync(join(openapiDir, 'openapi.yaml'), 'utf8').replace(/\r\n/g, '\n');

/** Top-level definition names of a component or path file, in file order. */
function definitions(file: string): string[] {
  const text = readFileSync(join(openapiDir, file), 'utf8');
  return [...text.matchAll(/^([A-Za-z][\w-]*):/gm)].map((m) => m[1] ?? '');
}

/** `name: $ref` pairs of a section of openapi.yaml, at the given indentation. */
function registrations(section: string, indent: string): { name: string; ref: string }[] {
  const start = root.indexOf(`\n${section}:\n`);
  if (start === -1) throw new Error(`No section ${section}`);
  const lines = root.slice(start + section.length + 3).split('\n');
  const end = lines.findIndex((line) => line !== '' && !line.startsWith(indent));
  const body = lines.slice(0, end === -1 ? undefined : end).join('\n');
  const pattern = new RegExp(`^${indent}(\\S+):\\n${indent}  \\$ref: '([^']+)'$`, 'gm');
  return [...body.matchAll(pattern)].map((m) => ({ name: m[1] ?? '', ref: m[2] ?? '' }));
}

/**
 * The order of the schema files in `components.schemas` (see the top of openapi.yaml): shared
 * files first, then one per module in the order of the API_CONTRACTS.md sections.
 */
const schemaFileOrder = [
  'common.yaml',
  'errors.yaml',
  'enums.yaml',
  'files.yaml',
  'auth.yaml',
  'me.yaml',
  'public-search.yaml',
  'public-lab-sites.yaml',
  'public-reports.yaml',
  'customer.yaml',
  'bookings.yaml',
  'payments.yaml',
  'lab-onboarding.yaml',
  'lab-site-settings.yaml',
  'lab-price-lists.yaml',
  'lab-inbox.yaml',
  'custody.yaml',
  'reports.yaml',
  'disputes.yaml',
  'admin-operations.yaml',
  'admin-onboarding.yaml',
  'admin-master-data.yaml',
  'admin-imports.yaml',
  'admin-finance.yaml',
  'admin-platform.yaml',
  'health.yaml',
];

/**
 * Component schemas that are structurally identical on purpose: different things whose JSON
 * happens to have the same shape today. Each entry says why they stay apart.
 */
const intendedDuplicates: { names: string[]; reason: string }[] = [
  {
    names: ['OtpCode', 'Pincode'],
    reason: 'A one-time code and a postal code: both are six digits, and unrelated.',
  },
  {
    names: ['QrPayload', 'SearchText'],
    reason: 'A scanned QR and a search query: both are free text of 1 to 200 characters.',
  },
  {
    names: ['LabClaimOtpVerify', 'MfaCodeRequest'],
    reason:
      'Two credentials of the same six-digit form: the OTP emailed to the NABL address of a ' +
      'claimed lab, and the TOTP code of the signed-in user.',
  },
  {
    names: ['LabClaimManual', 'LabPriceListImportCreate'],
    reason:
      'Two commands whose only input today is an uploaded file: the claim letterhead, and a ' +
      'price-list import file.',
  },
];

/** Component schemas no operation uses, with the reason they are kept. */
const unusedSchemas: Record<string, string> = {
  CustodyIntendedSite:
    'Documents `meta.intendedSite` of the `QR_WRONG_SITE` problem; `Problem.meta` is free-form, ' +
    'so no operation references it.',
};

describe('component schemas', () => {
  it('are structurally distinct, except the intended duplicates', () => {
    const byStructure = new Map<string, string[]>();
    for (const name of Object.keys(doc.components.schemas)) {
      const key = JSON.stringify(schemaStructure(doc, { $ref: `#/components/schemas/${name}` }));
      byStructure.set(key, [...(byStructure.get(key) ?? []), name]);
    }
    const duplicates = [...byStructure.values()]
      .filter((names) => names.length > 1)
      .map((names) => [...names].sort().join(' = '))
      .sort();
    const intended = intendedDuplicates.map(({ names }) => [...names].sort().join(' = ')).sort();
    expect(duplicates).toEqual(intended);
  });

  it('are each registered once, under the name and in the order of their file', () => {
    const registered = registrations('  schemas', '    ');
    const expected = schemaFileOrder.flatMap((file) =>
      definitions(join('components', 'schemas', file)).map((name) => ({
        name,
        ref: `./components/schemas/${file}#/${name}`,
      })),
    );
    expect(registered).toEqual(expected);
    expect(new Set(registered.map((r) => r.name)).size).toBe(registered.length);
  });

  it('come from the files of the documented order only', () => {
    const files = readdirSync(join(openapiDir, 'components', 'schemas')).filter((f) =>
      f.endsWith('.yaml'),
    );
    expect([...files].sort()).toEqual([...schemaFileOrder].sort());
  });

  it('are each used by an operation, except the listed ones', () => {
    const used = new Set<string>();
    const walk = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === '$ref' && typeof value === 'string') {
          const name = /^#\/components\/schemas\/(.+)$/.exec(value)?.[1];
          if (name !== undefined && !used.has(name)) {
            used.add(name);
            walk(doc.components.schemas[name]);
          }
          // Shared parameters, headers and responses lead to schemas too.
          const other = /^#\/components\/(parameters|headers|responses)\/(.+)$/.exec(value);
          if (other) walk(doc.components[other[1] as 'parameters'][other[2] ?? '']);
        } else walk(value);
      }
    };
    walk(doc.paths);
    const unused = Object.keys(doc.components.schemas).filter((name) => !used.has(name));
    expect(unused.sort()).toEqual(Object.keys(unusedSchemas).sort());
  });
});

describe('other components and paths', () => {
  it.each([
    ['parameters', 'components/parameters.yaml'],
    ['headers', 'components/headers.yaml'],
    ['responses', 'components/responses.yaml'],
  ])('registers every one of %s once, under its own name', (section, file) => {
    const registered = registrations(`  ${section}`, '    ');
    expect(registered).toEqual(
      definitions(file).map((name) => ({ name, ref: `./${file}#/${name}` })),
    );
  });

  it('lists every path item of paths/ exactly once', () => {
    const listed = registrations('paths', '  ').map((r) => r.ref);
    const files = readdirSync(join(openapiDir, 'paths')).filter((f) => f.endsWith('.yaml'));
    const defined = files.flatMap((file) =>
      definitions(join('paths', file)).map((item) => `./paths/${file}#/${item}`),
    );
    expect([...listed].sort()).toEqual([...defined].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });
});
