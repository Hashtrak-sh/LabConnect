import { type ApiClient, createApiClient } from '@labconnect/api-contract';

/**
 * The typed API client for server code (pages, route handlers, server actions). The browser never
 * calls the API directly: it talks to this Next.js server (BFF, API_CONVENTIONS §4).
 *
 * `API_BASE_URL` includes the `/v1` prefix; on a developer machine it defaults to the local API.
 */
export function api(): ApiClient {
  return createApiClient({ baseUrl: process.env.API_BASE_URL ?? 'http://localhost:3001/v1' });
}
