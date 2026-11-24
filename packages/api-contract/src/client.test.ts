import { describe, expect, expectTypeOf, it } from 'vitest';
import { createApiClient } from './client.js';

describe('createApiClient', () => {
  it('calls GET /health under the base URL and returns the typed body', async () => {
    const requests: Request[] = [];
    const client = createApiClient({
      baseUrl: 'http://api.test/v1',
      headers: { 'X-Request-Id': 'req-client-0001' },
      fetch: (request) => {
        requests.push(request);
        return Promise.resolve(
          new Response(JSON.stringify({ status: 'ok' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      },
    });

    const { data, error, response } = await client.GET('/health');

    expectTypeOf(data).toEqualTypeOf<{ status: 'ok' } | undefined>();
    expect(data).toEqual({ status: 'ok' });
    expect(error).toBeUndefined();
    expect(response.status).toBe(200);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe('http://api.test/v1/health');
    expect(requests[0]?.headers.get('X-Request-Id')).toBe('req-client-0001');
  });

  it('rejects paths that are not in the contract at compile time', () => {
    const client = createApiClient({
      baseUrl: 'http://api.test/v1',
      fetch: () => Promise.resolve(new Response(null, { status: 404 })),
    });
    const neverCalled = (): unknown =>
      // @ts-expect-error `/no-such-route` is not a path of the contract.
      client.GET('/no-such-route');
    expect(neverCalled).toBeTypeOf('function');
  });
});
