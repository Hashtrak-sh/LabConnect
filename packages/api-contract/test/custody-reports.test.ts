import { describe, expect, it } from 'vitest';
import {
  backticked,
  bodySchemas,
  describeResponse,
  listOperations,
  loadBundledDocument,
  reachableProperties,
  requiresHeader,
  resolve,
  type Response,
  schemaNodes,
  transitionIds,
} from './helpers.js';

// Custody and reports (API_CONTRACTS.md §7 and §8).

const doc = loadBundledDocument();
const operations = listOperations(doc);

describe('custody and reports (API_CONTRACTS.md §7 and §8)', () => {
  const moduleTags = new Set(['Custody', 'Reports']);
  const moduleOperations = operations.filter((o) =>
    (o.operation.tags ?? []).some((t) => moduleTags.has(t)),
  );

  /** Operations that need a fresh step-up MFA (AUTHENTICATION_AND_AUTHORISATION.md §2). */
  const stepUpOperations = ['POST /report-versions/{id}/publish'];

  /** Checker decisions on a Maker's record (CD-23, ROLES_AND_PERMISSIONS note 6). */
  const makerCheckerDecisions = [
    'POST /receipts/{id}/approve',
    'POST /receipts/{id}/confirm-discrepancy',
    'POST /receipts/{id}/reject-unfit',
    'POST /reprint-requests/{id}/approve',
    'POST /report-versions/{id}/return',
    'POST /report-versions/{id}/publish',
  ];

  /** Lab-internal fields the customer's report view must not carry (FILES_AND_REPORTS §3). */
  const labOnlyReportFields = [
    'reviewComments',
    'makerUserId',
    'checkerUserId',
    'originalSha256',
    'amendmentReason',
    'boundPackage',
  ];

  it('covers the module operations', () => {
    // 9 operations of §7 and 9 of §8 (share links: create and revoke).
    expect(moduleOperations.length).toBe(18);
  });

  it('require If-Match on every command that performs a booking transition', () => {
    const missing = moduleOperations
      .filter((o) => o.method === 'post' && transitionIds(o.operation.description ?? '').length > 0)
      .filter(({ operation }) => !requiresHeader(doc, operation, 'If-Match'))
      .map((o) => o.key);
    expect(missing).toEqual([]);
  });

  it('return JSON only, with no file bytes and no object key', () => {
    const forbiddenNames = new Set(['objectkey', 'bucket', 'objectversionid', 'content', 'bytes']);
    const problems: string[] = [];
    for (const { key, operation } of moduleOperations) {
      for (const [status, value] of Object.entries(operation.responses)) {
        if (!status.startsWith('2')) continue;
        for (const type of Object.keys(resolve<Response>(doc, value).content ?? {})) {
          if (type !== 'application/json') problems.push(`${key} ${status}: ${type}`);
        }
      }
      for (const schema of bodySchemas(doc, operation, 'response')) {
        for (const p of reachableProperties(doc, schema, key)) {
          if (forbiddenNames.has(p.name.toLowerCase())) {
            problems.push(`${key}: property ${p.name} (${p.at})`);
          }
        }
        for (const { node, at } of schemaNodes(doc, schema, key)) {
          if (node.format === 'binary' || node.format === 'byte' || 'contentEncoding' in node) {
            problems.push(`${key}: binary schema (${at})`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('declare STEP_UP_REQUIRED where a step-up is needed', () => {
    for (const key of stepUpOperations) {
      const op = operations.find((o) => o.key === key);
      expect(op, key).toBeDefined();
      const unauthorised = op?.operation.responses['401'];
      expect(unauthorised, key).toBeDefined();
      if (unauthorised) {
        expect(backticked(describeResponse(doc, unauthorised)), key).toContain('STEP_UP_REQUIRED');
      }
    }
  });

  it('declare SELF_APPROVAL_FORBIDDEN on every Checker decision', () => {
    for (const key of makerCheckerDecisions) {
      const op = operations.find((o) => o.key === key);
      expect(op, key).toBeDefined();
      const forbidden = op?.operation.responses['403'];
      expect(forbidden, key).toBeDefined();
      if (forbidden) {
        expect(backticked(describeResponse(doc, forbidden)), key).toContain(
          'SELF_APPROVAL_FORBIDDEN',
        );
      }
    }
  });

  it('keep lab-internal report fields out of the customer view', () => {
    const view = { $ref: '#/components/schemas/CustomerReportView' };
    const leaked = reachableProperties(doc, view, 'CustomerReportView')
      .filter((p) => labOnlyReportFields.includes(p.name))
      .map((p) => `${p.name} (${p.at})`);
    expect(leaked).toEqual([]);
  });
});
