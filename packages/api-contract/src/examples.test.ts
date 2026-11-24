import { describe, expect, it } from 'vitest';
import { contractExample, operationsWithoutSuccessExample } from './examples.js';

describe('contractExample', () => {
  it('returns a copy of the first example documented for a response', () => {
    // refreshSession documents an example for its 200 response (schema-level `examples`).
    const first = contractExample('refreshSession', 200);
    expect(first).toHaveProperty('accessToken');
    const second = contractExample('refreshSession', 200);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it('fails clearly when the contract has no example', () => {
    expect(() => contractExample('getHealth', 200)).toThrow(
      'The contract has no example for getHealth 200 application/json',
    );
    // The shared error schema's own example is not used for a specific error response.
    expect(() => contractExample('refreshSession', 401)).toThrow(
      /has no example for refreshSession 401/,
    );
  });

  it('fails clearly for an unknown operation or an undeclared status', () => {
    expect(() => contractExample('noSuchOperation', 200)).toThrow(
      'noSuchOperation is not an operationId in the contract',
    );
    expect(() => contractExample('getHealth', 418)).toThrow('getHealth declares no 418 response');
  });

  it('reports how many operations have no example for their success response', async ({
    annotate,
  }) => {
    const missing = operationsWithoutSuccessExample();
    // A report, not a gate: mocks for the other side need these examples (COLLABORATION_GUIDE §2).
    // Printed (shown unless the run is silent) and annotated (a notice in the GitHub reporter).
    const first = missing.length > 0 ? ` First ones: ${missing.slice(0, 10).join(', ')}.` : '';
    const report = `Contract examples: ${String(missing.length)} operations have no example for their success response.${first}`;
    console.info(report);
    await annotate(report, 'notice');
    expect(missing).toEqual([...missing].sort());
  });
});
