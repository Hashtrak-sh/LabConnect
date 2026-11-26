import type { components } from '@labconnect/api-contract';
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { type PublicTaxonomyQuery, TaxonomyDirectory } from '@labconnect/core';
import { DomainError, type ProblemIssue } from '../../common/domain-error.js';

type PublicTaxonomyNodeList = components['schemas']['PublicTaxonomyNodeList'];

const TAXONOMY_CODE = /^[A-Z][A-Z0-9_]*$/;
const ALLOWED = new Set(['parent', 'cursor', 'limit']);
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * The path code and the query string of `listTaxonomyNodes` (`paths/public-search.yaml`). An
 * unknown, repeated or empty parameter, a malformed code or a limit out of range is 422.
 */
export function parseTaxonomyRequest(
  code: string,
  query: Record<string, unknown>,
): PublicTaxonomyQuery {
  const issues: ProblemIssue[] = [];
  if (code.length > 50 || !TAXONOMY_CODE.test(code)) {
    issues.push({ path: 'code', code: 'INVALID_VALUE', message: 'Give a taxonomy code.' });
  }
  const values = new Map<string, string>();
  for (const [name, raw] of Object.entries(query)) {
    if (!ALLOWED.has(name)) {
      issues.push({ path: name, code: 'UNKNOWN_FIELD', message: 'This parameter is not allowed.' });
    } else if (typeof raw !== 'string') {
      issues.push({ path: name, code: 'INVALID_VALUE', message: 'Give this parameter once.' });
    } else if (raw.length === 0) {
      issues.push({ path: name, code: 'INVALID_VALUE', message: 'This parameter is empty.' });
    } else values.set(name, raw);
  }
  const parent = values.get('parent') ?? null;
  if (parent !== null && parent.length > 100) {
    issues.push({ path: 'parent', code: 'INVALID_VALUE', message: 'Give a node code.' });
  }
  let limit = DEFAULT_LIMIT;
  const rawLimit = values.get('limit');
  if (rawLimit !== undefined) {
    const parsed = /^\d{1,4}$/.test(rawLimit) ? Number(rawLimit) : Number.NaN;
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_LIMIT) limit = parsed;
    else {
      issues.push({
        path: 'limit',
        code: 'INVALID_VALUE',
        message: `The limit is a whole number from 1 to ${String(MAX_LIMIT)}.`,
      });
    }
  }
  if (issues.length > 0) {
    throw new DomainError('VALIDATION_FAILED', {
      detail: 'The request is not valid.',
      errors: issues,
    });
  }
  return { parent, cursor: values.get('cursor') ?? null, limit };
}

/**
 * Public filter values under `/v1/public/taxonomies` (API_CONTRACTS.md section 2, FR-DIS-03,
 * I1-CUS-06). No authentication: taxonomies are public reference data.
 */
@Controller('public/taxonomies')
export class PublicTaxonomiesController {
  constructor(@Inject(TaxonomyDirectory) private readonly taxonomies: TaxonomyDirectory) {}

  /** `listTaxonomyNodes`: the top level, or the children of `parent`, by name. */
  @Get(':code/nodes')
  async listTaxonomyNodes(
    @Param('code') code: string,
    @Query() query: Record<string, unknown>,
  ): Promise<PublicTaxonomyNodeList> {
    const request = parseTaxonomyRequest(code, query);
    const page = await this.taxonomies.listPublicNodes(code, request);
    if (page === null) {
      throw new DomainError('NOT_FOUND', {
        detail: 'No active taxonomy with this code, or no active parent node in it.',
      });
    }
    return {
      data: page.nodes,
      page: { nextCursor: page.nextCursor, limit: request.limit },
    };
  }
}
