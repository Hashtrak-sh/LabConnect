// The reviewed allow-list of routes that need no sign-in (P3-05, rule A). A route without
// `AuthGuard` that is not listed here fails `test/permissions/declaration.real.spec.ts`; an entry
// whose route is not served fails it too. Add an entry in the same change as the route, with the
// reason, and the contract must say the same (`security: []`, or a non-bearer scheme).
import type { PublicRoute } from '../support/permissions/declaration-rules.js';

export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  {
    route: 'GET /v1/health',
    reason: 'Liveness probe for the load balancer and CI. Carries no data.',
  },
  {
    route: 'POST /v1/auth/otp/request',
    reason: 'Sign-in step 1: asks for an email code, so it cannot require a session.',
  },
  {
    route: 'POST /v1/auth/otp/verify',
    reason: 'Sign-in step 2: trades the email code for a session, so it cannot require one.',
  },
  {
    route: 'POST /v1/auth/refresh',
    reason:
      'Authenticated by the refresh cookie alone (contract security: refreshCookie), not a bearer token.',
  },
  {
    route: 'POST /v1/webhooks/payments/:gateway',
    reason:
      "The payment gateway's server-to-server callback: no user. The adapter authenticates it by its signature, and the answer never says whether a reference exists.",
  },
  {
    route: 'GET /v1/public/search/labs',
    reason:
      'Anonymous discovery (FR-DIS-01, AC-DIS-01, contract security: []). Reads only public reference data in a read-only transaction with no tenant (SEARCH.md section 4).',
  },
];
