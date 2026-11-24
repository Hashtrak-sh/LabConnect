import { describe, expect, it } from 'vitest';
import {
  backticked,
  bodySchemas,
  describeResponse,
  listOperations,
  loadBundledDocument,
  parametersOf,
  type PropertyEntry,
  reachableProperties,
  resolve,
  type Schema,
  type Operation,
} from './helpers.js';

// Lab operations (API_CONTRACTS.md §6).

const doc = loadBundledDocument();
const operations = listOperations(doc);

describe('lab operations (API_CONTRACTS §6)', () => {
  const labOperations = operations.filter((o) => o.path.startsWith('/lab/'));

  /** Properties of the request body of an operation. */
  function requestProperties(operation: Operation): PropertyEntry[] {
    return bodySchemas(doc, operation, 'request').flatMap((s) => reachableProperties(doc, s));
  }

  /** Property names of the 2xx responses of an operation. */
  function responseProperties(operation: Operation): string[] {
    return bodySchemas(doc, operation, 'response').flatMap((s) =>
      reachableProperties(doc, s).map((p) => p.name),
    );
  }

  // Secrets that no lab response may carry (SECURITY_AND_PRIVACY §2, CLAUDE.md §5): a full bank
  // account number (only `accountNumberLast4` is returned), a PAN, an OTP, a token or a secret.
  // (`code` alone is not listed: it is the code of a master-data value.)
  const secret =
    /^(accountNumber|accountNumberCiphertext|pan|panCiphertext|otp|otpCode|codeHash|token|tokenHash|secret|secretCiphertext)$/i;

  it('cover the lab section', () => {
    expect(labOperations.length).toBeGreaterThan(0);
  });

  it('all require authentication', () => {
    const open = labOperations
      .filter(({ operation }) => (operation.security ?? doc.security ?? []).length === 0)
      .map((o) => o.key);
    expect(open).toEqual([]);
  });

  it('return no full account number, PAN, OTP, token or secret', () => {
    const leaks = labOperations.flatMap(({ key, operation }) =>
      responseProperties(operation)
        .filter((name) => secret.test(name))
        .map((name) => `${key}: ${name}`),
    );
    expect(leaks).toEqual([]);
  });

  it('accept a bank account number only as a write-only field', () => {
    const accountNumbers = labOperations.flatMap(({ key, operation }) =>
      requestProperties(operation)
        .filter((p) => p.name === 'accountNumber')
        .map((p) => ({ key, writeOnly: resolve<Schema>(doc, p.schema as Schema).writeOnly })),
    );
    expect(accountNumbers).not.toEqual([]);
    for (const { key, writeOnly } of accountNumbers) expect(writeOnly, key).toBe(true);
  });

  it('take no organisation id from the client (TENANT_ISOLATION §2)', () => {
    const orgId = /^(organisationId|organizationId|orgId|labOrgId|customerOrgId)$/i;
    const taken = labOperations.flatMap(({ key, operation }) => [
      ...requestProperties(operation)
        .filter((p) => orgId.test(p.name))
        .map((p) => `${key}: body ${p.name}`),
      ...parametersOf(doc, operation)
        .filter((p) => orgId.test(p.name))
        .map((p) => `${key}: ${p.in} ${p.name}`),
    ]);
    expect(taken).toEqual([]);
  });

  it('require a step-up MFA to add bank details (AUTHENTICATION §2)', () => {
    const stepUp = ['POST /lab/bank-accounts'];
    for (const key of stepUp) {
      const op = labOperations.find((o) => o.key === key);
      const unauthenticated = op?.operation.responses['401'];
      expect(unauthenticated, key).toBeDefined();
      if (!unauthenticated) continue;
      expect(backticked(describeResponse(doc, unauthenticated)), key).toContain('STEP_UP_REQUIRED');
    }
  });

  it('act as the active lab membership, except a claim, which comes before one', () => {
    for (const { key, path, operation } of labOperations) {
      const names = parametersOf(doc, operation).map((p) => p.name);
      if (path.startsWith('/lab/claims')) expect(names, key).not.toContain('X-Active-Membership');
      else expect(names, key).toContain('X-Active-Membership');
    }
  });
});
