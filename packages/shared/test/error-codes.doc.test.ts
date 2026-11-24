// Doc-equality: src/error-codes.ts against ERROR_HANDLING.md §2 and the OpenAPI ErrorCode enum.
import { describe, expect, it } from 'vitest';

import { ERROR_CODE_LIST, ERROR_CODES } from '../src/error-codes.js';
import { backticked, markdownSection, markdownTable, readRepoFile, yamlEnum } from './helpers.js';

function documentedCatalogue(): [string, number][] {
  const doc = readRepoFile('docs/04-api/ERROR_HANDLING.md');
  const { header, rows } = markdownTable(markdownSection(doc, '## 2. Error codes'));
  expect(header).toEqual(['Code', 'HTTP', 'Meaning']);
  // One row can name several codes: `OTP_INVALID` / `OTP_EXPIRED` / `OTP_LOCKED` | 422/422/429.
  return rows.flatMap(([codeCell = '', httpCell = '']) => {
    const codes = backticked(codeCell);
    const statuses = httpCell.split('/').map(Number);
    expect(statuses, codeCell).toHaveLength(codes.length);
    return codes.map((code, i): [string, number] => [code, statuses[i] ?? Number.NaN]);
  });
}

describe('error codes', () => {
  it('equal the catalogue in ERROR_HANDLING.md §2 (codes, order and HTTP status)', () => {
    const documented = documentedCatalogue();
    expect(ERROR_CODE_LIST.map((code) => [code, ERROR_CODES[code].status])).toEqual(documented);
    expect(documented).toHaveLength(32);
  });

  it('equal the OpenAPI ErrorCode enum', () => {
    expect(ERROR_CODE_LIST).toEqual(
      yamlEnum('packages/api-contract/openapi/components/schemas/errors.yaml', 'ErrorCode'),
    );
  });
});
