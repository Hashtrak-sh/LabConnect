// Typed API client for consumers of the contract (the web app, tests). It is `openapi-fetch`
// over the generated `paths` type: paths, parameters, bodies and responses are checked by the
// compiler. Deliberately minimal: no auth handling, no retries.
import createClient, { type Client } from 'openapi-fetch';
import type { paths } from './generated/types.js';

export type ApiClient = Client<paths>;

export interface ApiClientOptions {
  /** The API base including the `/v1` server prefix, e.g. `http://localhost:3001/v1`. */
  baseUrl: string;
  /** A fetch implementation (default: the global `fetch`). Tests pass a stub. */
  fetch?: (request: Request) => Promise<Response>;
  /** Headers sent with every request. */
  headers?: Record<string, string>;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  return createClient<paths>({
    baseUrl: options.baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  });
}
