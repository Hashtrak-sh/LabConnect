import { type ApiClient, createApiClient } from '@labconnect/api-contract';

/** The API base including `/v1`; on a developer machine, the local API. */
export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? 'http://localhost:3001/v1';
}

/**
 * The typed API client for server code (pages, route handlers, server actions, the proxy). The
 * browser never calls the API directly: it talks to this Next.js server (BFF, API_CONVENTIONS §4).
 * With `accessToken`, calls are made as the signed-in user (`Authorization: Bearer`).
 */
export function api(accessToken?: string): ApiClient {
  return createApiClient({
    baseUrl: apiBaseUrl(),
    ...(accessToken === undefined ? {} : { headers: { Authorization: `Bearer ${accessToken}` } }),
  });
}
