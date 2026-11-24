import { describe, expect, it } from 'vitest';
import {
  backticked,
  bodySchemas,
  describeResponse,
  listOperations,
  loadBundledDocument,
  prismaEnums,
  reachableProperties,
} from './helpers.js';

// Rules the admin module introduces (P2-06b, API_CONTRACTS.md §10). Platform staff access is
// role-based (TENANT_ISOLATION §2 rule 6): every `/admin` operation names its roles in the
// extension `x-roles`, which only `/admin` operations use.

const doc = loadBundledDocument();
const operations = listOperations(doc);

describe('admin operations (/admin)', () => {
  const adminOperations = operations.filter((o) => o.path.startsWith('/admin/'));
  const xRoles = (operation: object): unknown => (operation as { 'x-roles'?: unknown })['x-roles'];
  const descriptionOf = (operation: object): string =>
    (operation as { description?: string }).description ?? '';

  /** The /admin operations that need a fresh MFA (AUTHENTICATION §2 step-up list). */
  const stepUp = [
    'POST /admin/break-glass/report-access/{id}/approve', // break-glass access
    'POST /admin/break-glass/report-access/{id}/download-url', // break-glass access
    'POST /admin/payouts/{id}/release', // payout release
    'POST /admin/refunds/{id}/approve', // refund approval above the threshold
    'POST /admin/users', // platform role changes (grant)
    'PATCH /admin/users/{id}', // platform role changes (status)
    'PUT /admin/users/{id}/platform-roles', // platform role changes
  ];

  /**
   * Properties no /admin response may contain, at any depth: secrets, full numbers that are
   * stored encrypted, one-time codes, tokens, storage locations, and report files or contents
   * (platform staff see report metadata only; files need break-glass). Matching ignores case.
   */
  const adminDenyList = [
    'accountNumber',
    'accountNumberCiphertext',
    'pan',
    'panCiphertext',
    'otp',
    'otpCode',
    'codeHash',
    'token',
    'tokenHash',
    'accessToken',
    'refreshToken',
    'secret',
    'secretCiphertext',
    'recoveryCodes',
    'payloadCiphertext',
    'bucket',
    'objectKey',
    'originalFileId',
    'stampedFileId',
    'results',
  ].map((name) => name.toLowerCase());

  it('exist', () => {
    expect(adminOperations.length).toBeGreaterThan(0);
  });

  it('require authentication and declare 401 and 403', () => {
    for (const { key, operation } of adminOperations) {
      expect((operation.security ?? doc.security ?? []).length, key).toBeGreaterThan(0);
      expect(Object.keys(operation.responses), key).toEqual(expect.arrayContaining(['401', '403']));
    }
  });

  it('name at least one platform role in x-roles, and only roles of RoleCode', () => {
    const roleCodes = prismaEnums().get('RoleCode') ?? [];
    expect(roleCodes).not.toEqual([]);
    for (const { key, operation } of adminOperations) {
      const roles = xRoles(operation);
      expect(Array.isArray(roles), `${key}: x-roles`).toBe(true);
      const list = roles as unknown[];
      expect(list.length, key).toBeGreaterThan(0);
      expect(new Set(list).size, key).toBe(list.length);
      for (const role of list) {
        expect(roleCodes, key).toContain(role);
        expect(String(role), key).toMatch(/^PLATFORM_/);
        expect(descriptionOf(operation), `${key}: description names ${String(role)}`).toContain(
          `\`${String(role)}\``,
        );
      }
    }
  });

  it('use x-roles nowhere else', () => {
    const elsewhere = operations
      .filter((o) => !o.path.startsWith('/admin/') && xRoles(o.operation) !== undefined)
      .map((o) => o.key);
    expect(elsewhere).toEqual([]);
  });

  it('declare STEP_UP_REQUIRED exactly on the step-up actions', () => {
    const declaring = adminOperations
      .filter(({ operation }) => {
        const unauthorised = operation.responses['401'];
        return (
          unauthorised !== undefined &&
          backticked(describeResponse(doc, unauthorised)).includes('STEP_UP_REQUIRED')
        );
      })
      .map((o) => o.key);
    expect([...declaring].sort()).toEqual([...stepUp].sort());
  });

  it('return no secret, full account number, PAN, OTP, token, object key or report file', () => {
    const leaks: string[] = [];
    for (const { key, operation } of adminOperations) {
      for (const schema of bodySchemas(doc, operation, 'response')) {
        for (const { name } of reachableProperties(doc, schema)) {
          if (adminDenyList.includes(name.toLowerCase())) leaks.push(`${key}: ${name}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });
});
