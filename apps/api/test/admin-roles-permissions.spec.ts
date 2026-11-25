// The contract's `x-roles` (roles named per /admin operation) against the permission map of
// packages/shared (who holds which permission). They are two statements of the same rule, and
// nothing ties an operation to a permission code yet, so the match is found by shape: an
// operation "agrees" when some permission is held, in any form, by exactly the platform roles
// that `x-roles` names.
//
// This is a REPORT, not a gate (P3-04): differences are printed as a summary and never fail the
// run. Neither side is changed silently. When an admin endpoint is built it declares its
// permission with `@Authorised({ permission })`, and the difference listed here for that
// operation is settled first (the API contract and ROLES_AND_PERMISSIONS are shared documents).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  PERMISSION_CODES,
  type PermissionCode,
  ROLE_CODES,
  ROLES,
  type RoleCode,
  grantOf,
} from '@labconnect/shared';
import { describe, expect, it } from 'vitest';

interface Operation {
  operationId?: string;
  'x-roles'?: string[];
}
const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

const require = createRequire(import.meta.url);
const document = JSON.parse(
  readFileSync(require.resolve('@labconnect/api-contract/openapi.json'), 'utf8'),
) as { paths: Record<string, Partial<Record<(typeof METHODS)[number], Operation>>> };

const PLATFORM_ROLES = ROLE_CODES.filter((role) => ROLES[role].orgType === 'PLATFORM');

/** The platform roles that hold a permission in any form (✔, ○, ◐). */
function platformHolders(permission: PermissionCode): RoleCode[] {
  return PLATFORM_ROLES.filter((role) => grantOf(role, permission) !== undefined);
}

interface Row {
  operation: string;
  operationId: string;
  roles: RoleCode[];
  agrees: boolean;
  /** Permissions held by exactly these roles. */
  exact: PermissionCode[];
  /** Otherwise the closest permissions, with what differs. */
  nearest: {
    permission: PermissionCode;
    rolesWithoutPermission: RoleCode[];
    extraRoles: RoleCode[];
  }[];
}

function compare(): Row[] {
  const rows: Row[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    if (!path.startsWith('/admin/')) continue;
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const roles = (operation['x-roles'] ?? []) as RoleCode[];
      const exact = PERMISSION_CODES.filter((permission) => {
        const holders = platformHolders(permission);
        return holders.length === roles.length && roles.every((role) => holders.includes(role));
      });
      const scored = PERMISSION_CODES.map((permission) => {
        const holders = platformHolders(permission);
        return {
          permission,
          rolesWithoutPermission: roles.filter((role) => !holders.includes(role)),
          extraRoles: holders.filter((role) => !roles.includes(role)),
        };
      })
        .filter((candidate) => candidate.rolesWithoutPermission.length < roles.length)
        .sort(
          (a, b) =>
            a.rolesWithoutPermission.length +
            a.extraRoles.length -
            (b.rolesWithoutPermission.length + b.extraRoles.length),
        );
      rows.push({
        operation: `${method.toUpperCase()} ${path}`,
        operationId: operation.operationId ?? '',
        roles,
        agrees: exact.length > 0,
        exact,
        nearest: exact.length > 0 ? [] : scored.slice(0, 2),
      });
    }
  }
  return rows;
}

describe('x-roles of the contract against the permission map (report, not a gate)', () => {
  const rows = compare();

  it('reads every /admin operation and only roles of the platform', () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.roles.length, row.operation).toBeGreaterThan(0);
      for (const role of row.roles) expect(PLATFORM_ROLES, row.operation).toContain(role);
    }
  });

  it('prints the operations where the two statements differ', () => {
    const different = rows.filter((row) => !row.agrees);
    const lines = different.map((row) => {
      const best = row.nearest
        .map(
          (n) =>
            `${n.permission}${n.rolesWithoutPermission.length > 0 ? ` (x-roles not in map: ${n.rolesWithoutPermission.join('+')})` : ''}${n.extraRoles.length > 0 ? ` (map roles not in x-roles: ${n.extraRoles.join('+')})` : ''}`,
        )
        .join(' | ');
      return `  ${row.operation} [${row.roles.join(', ')}] -> ${best || 'no permission is held by any of these roles'}`;
    });
    console.info(
      `x-roles vs permission map: ${String(rows.length - different.length)} of ${String(rows.length)} /admin operations agree with some permission; ${String(different.length)} do not.\n${lines.join('\n')}`,
    );
    expect(different.length).toBeLessThanOrEqual(rows.length);
  });
});
