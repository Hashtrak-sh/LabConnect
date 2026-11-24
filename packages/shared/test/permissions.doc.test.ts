// Doc-equality: src/permissions.ts against ROLES_AND_PERMISSIONS.md (§1 roles, §2 matrix and
// notes), the Prisma enum RoleCode and the OpenAPI RoleCode enum.
import { describe, expect, it } from 'vitest';

import {
  PERMISSION_CODES,
  PERMISSION_CONDITIONS,
  PERMISSION_MATRIX,
  PERMISSIONS,
  type PermissionGrant,
  ROLE_CODES,
  ROLES,
} from '../src/permissions.js';
import {
  backticked,
  markdownSection,
  markdownTable,
  prismaEnum,
  readRepoFile,
  yamlEnum,
} from './helpers.js';

const doc = readRepoFile('docs/01-product/ROLES_AND_PERMISSIONS.md');

const MFA_CELLS: Record<string, string> = {
  'Optional (recommended)': 'OPTIONAL_RECOMMENDED',
  Optional: 'OPTIONAL',
  '**Required**': 'REQUIRED',
};

const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** A matrix cell as ALL, OWN, NONE or `CONDITIONAL:<note>`. */
function parseCell(cell: string): string {
  if (cell === '✔') return 'ALL';
  if (cell === '○') return 'OWN';
  if (cell === '—') return 'NONE';
  const conditional = /^◐([⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/u.exec(cell);
  if (conditional) {
    const note = (conditional[1] ?? '').replace(/./gu, (c) => String(SUPERSCRIPTS.indexOf(c)));
    return `CONDITIONAL:${note}`;
  }
  throw new Error(`Unknown matrix cell: ${cell}`);
}

function describeGrant(grant: PermissionGrant | undefined): string {
  if (!grant) return 'NONE';
  if (grant.access === 'CONDITIONAL') {
    return `CONDITIONAL:${String(PERMISSION_CONDITIONS[grant.condition].note)}`;
  }
  return grant.access;
}

describe('ROLES_AND_PERMISSIONS.md', () => {
  it('§1: the roles, org types and MFA column equal ROLES', () => {
    const { header, rows } = markdownTable(markdownSection(doc, '## 1. Roles'));
    expect(header).toEqual(['Code', 'Org type', 'Description', 'MFA']);
    const documented = rows.map(([code = '', orgType = '', , mfa = '']) => [
      backticked(code).join(),
      orgType.toUpperCase(),
      MFA_CELLS[mfa] ?? `unknown MFA cell: ${mfa}`,
    ]);
    expect(documented).toEqual(
      ROLE_CODES.map((code) => [code, ROLES[code].orgType, ROLES[code].mfa]),
    );
  });

  it('§2: the matrix columns are the role abbreviations, in ROLE_CODES order', () => {
    const { header } = markdownTable(markdownSection(doc, '## 2. Permission matrix'));
    expect(header).toEqual(['Capability', ...ROLE_CODES.map((code) => ROLES[code].abbreviation)]);
  });

  it('§2: every row and cell of the matrix equals PERMISSION_MATRIX', () => {
    const { rows } = markdownTable(markdownSection(doc, '## 2. Permission matrix'));
    const documented = rows.map(([capability = '', ...cells]) => [
      capability,
      ...cells.map(parseCell),
    ]);
    const implemented = PERMISSION_CODES.map((code) => [
      PERMISSIONS[code].capability,
      ...ROLE_CODES.map((role) => describeGrant(PERMISSION_MATRIX[code][role])),
    ]);
    expect(implemented).toEqual(documented);
    expect(documented).toHaveLength(31);
  });

  it('§2: every condition points at a numbered note, and every note has a condition', () => {
    const notes = markdownSection(doc, '## 2. Permission matrix')
      .map((line) => /^(\d+)\. /.exec(line)?.[1])
      .filter((note) => note !== undefined)
      .map(Number);
    expect(notes).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    const referenced = new Set(Object.values(PERMISSION_CONDITIONS).map((c) => c.note));
    expect([...referenced].sort((a, b) => a - b)).toEqual(notes);
  });

  it('§2: anonymous access and step-up MFA follow the capability text', () => {
    for (const code of PERMISSION_CODES) {
      const definition: { capability: string; anonymous?: true; stepUpMfa?: true } =
        PERMISSIONS[code];
      expect(definition.anonymous === true, code).toBe(
        definition.capability.includes('(also anonymous)'),
      );
      expect(definition.stepUpMfa === true, code).toBe(definition.capability.includes('(MFA)'));
    }
  });
});

describe('role codes', () => {
  it('equal the Prisma enum RoleCode', () => {
    expect(ROLE_CODES).toEqual(prismaEnum('RoleCode'));
  });

  it('equal the OpenAPI RoleCode enum', () => {
    expect(ROLE_CODES).toEqual(
      yamlEnum('packages/api-contract/openapi/components/schemas/enums.yaml', 'RoleCode'),
    );
  });
});
