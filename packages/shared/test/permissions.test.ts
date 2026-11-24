import { describe, expect, it } from 'vitest';

import {
  grantOf,
  grantsFor,
  hasPermission,
  hasUnconditionalPermission,
  isPermissionCode,
  isRoleCode,
  PERMISSION_CODES,
  PERMISSION_CONDITIONS,
  PERMISSION_MATRIX,
  permissionsOf,
  ROLE_CODES,
  ROLES,
  roleRequiresMfa,
} from '../src/permissions.js';

describe('roles', () => {
  it('have unique abbreviations', () => {
    const abbreviations = ROLE_CODES.map((code) => ROLES[code].abbreviation);
    expect(new Set(abbreviations).size).toBe(ROLE_CODES.length);
  });

  it('require MFA for finance, lab checker and every platform role only', () => {
    expect(ROLE_CODES.filter(roleRequiresMfa)).toEqual([
      'CUSTOMER_FINANCE',
      'LAB_CHECKER',
      'PLATFORM_OPS',
      'PLATFORM_DATA_STEWARD',
      'PLATFORM_FINANCE',
      'PLATFORM_ADMIN',
    ]);
  });

  it('isRoleCode accepts only role codes', () => {
    expect(isRoleCode('LAB_MAKER')).toBe(true);
    expect(isRoleCode('lab_maker')).toBe(false);
    expect(isRoleCode(undefined)).toBe(false);
  });
});

describe('permission matrix', () => {
  it('uses every named condition at least once', () => {
    const used = new Set(
      PERMISSION_CODES.flatMap((code) =>
        Object.values(PERMISSION_MATRIX[code]).flatMap((grant) =>
          grant.access === 'CONDITIONAL' ? [grant.condition] : [],
        ),
      ),
    );
    expect([...used].sort()).toEqual(Object.keys(PERMISSION_CONDITIONS).sort());
  });

  it('keeps Maker and Checker work apart', () => {
    expect(hasPermission(['LAB_MAKER'], 'receipt.record')).toBe(true);
    expect(hasPermission(['LAB_CHECKER'], 'receipt.record')).toBe(false);
    expect(hasPermission(['LAB_MAKER'], 'receipt.approve')).toBe(false);
    expect(hasPermission(['LAB_MAKER'], 'report.publish')).toBe(false);
    expect(grantOf('LAB_CHECKER', 'report.publish')).toEqual({
      access: 'CONDITIONAL',
      condition: 'NOT_ON_OWN_MAKER_ITEM',
    });
  });

  it('never lets Ops approve a receipt or a report (RR-7)', () => {
    expect(hasPermission(['PLATFORM_OPS'], 'receipt.approve')).toBe(false);
    expect(hasPermission(['PLATFORM_OPS'], 'report.publish')).toBe(false);
  });
});

describe('hasPermission and grantsFor', () => {
  it('is false for no roles', () => {
    expect(hasPermission([], 'lab.search')).toBe(false);
    expect(grantsFor([], 'lab.search')).toEqual([]);
  });

  it('is true for any grant, and keeps the qualifier of each grant', () => {
    expect(hasPermission(['CUSTOMER_REQUESTER'], 'booking.pay')).toBe(true);
    expect(hasUnconditionalPermission(['CUSTOMER_REQUESTER'], 'booking.pay')).toBe(false);
    expect(grantsFor(['CUSTOMER_REQUESTER'], 'booking.pay')).toEqual([
      {
        role: 'CUSTOMER_REQUESTER',
        grant: { access: 'CONDITIONAL', condition: 'REQUESTER_CAN_PAY_SETTING' },
      },
    ]);
    expect(grantsFor(['CUSTOMER_REQUESTER'], 'report.download')).toEqual([
      { role: 'CUSTOMER_REQUESTER', grant: { access: 'OWN' } },
    ]);
  });

  it('combines several customer roles (RR-1)', () => {
    const roles = ['CUSTOMER_REQUESTER', 'CUSTOMER_FINANCE'] as const;
    expect(hasUnconditionalPermission(roles, 'booking.pay')).toBe(true);
    expect(grantsFor(roles, 'booking.pay').map((g) => g.role)).toEqual([
      'CUSTOMER_REQUESTER',
      'CUSTOMER_FINANCE',
    ]);
    expect(hasPermission(roles, 'dispute.decide')).toBe(false);
  });

  it('permissionsOf lists what a role holds', () => {
    expect(permissionsOf('PLATFORM_DATA_STEWARD')).toEqual([
      'lab.search',
      'masterdata.changeset.prepare',
      'masterdata.changeset.approve',
      'audit_log.view',
    ]);
    expect(permissionsOf('LAB_MAKER')).toContain('report.submit');
  });

  it('isPermissionCode accepts only permission codes', () => {
    expect(isPermissionCode('booking.decide')).toBe(true);
    expect(isPermissionCode('booking.approve')).toBe(false);
    expect(isPermissionCode('toString')).toBe(false);
    expect(isPermissionCode(42)).toBe(false);
  });
});
