// The tenant-isolation registry (P3-05, TESTING_STRATEGY.md section 2 item 3). Every implemented
// route that is not public and takes an id in its path must have an entry here, and the entry
// can only be satisfied by a real test: `test/isolation/coverage.spec.ts` fails for a route with
// no entry, for an entry whose route is not served, for a spec file that does not exist or does
// not call `expectIsolated({ route: '<the route>', ... })`, and `expectIsolated` itself refuses a
// route that is not registered. Staged like `test/contract/not-implemented.txt`: the list only
// grows with real endpoints, and an entry cannot be added without its test.
//
// How to add an endpoint: put its case in a spec under `test/integration/isolation/`, add
// `{ route, spec }` to REAL_APP_CASES, run `pnpm test:isolation`.

export interface IsolationCase {
  /** `METHOD /v1/path/:id`, Express syntax, exactly as `describeRoutes()` prints it. */
  route: string;
  /** The spec file (from `apps/api`) that calls `expectIsolated` for the route. */
  spec: string;
}

export interface Exemption {
  route: string;
  /** Why the route has an id but touches no tenant data. Reviewed with the entry. */
  reason: string;
}

/** Cases for the routes of the real app. */
export const REAL_APP_CASES: readonly IsolationCase[] = [
  {
    route: 'GET /v1/bookings/:id',
    spec: 'test/integration/isolation/bookings.spec.ts',
  },
  {
    route: 'POST /v1/me/notifications/:id/read',
    spec: 'test/integration/isolation/notifications.spec.ts',
  },
  {
    route: 'GET /v1/lab/claims/:id',
    spec: 'test/integration/isolation/lab-claims.spec.ts',
  },
  {
    route: 'POST /v1/lab/claims/:id/verify-otp',
    spec: 'test/integration/isolation/lab-claims.spec.ts',
  },
  {
    route: 'POST /v1/lab/claims/:id/manual/upload-url',
    spec: 'test/integration/isolation/lab-claims.spec.ts',
  },
  {
    route: 'POST /v1/lab/claims/:id/manual',
    spec: 'test/integration/isolation/lab-claims.spec.ts',
  },
  // Platform-only routes: a tenant caller is refused with 403 (`refusal: 'FORBIDDEN'` in the kit).
  {
    route: 'GET /v1/admin/claims/:id',
    spec: 'test/integration/isolation/admin-lab-claims.spec.ts',
  },
  {
    route: 'POST /v1/admin/claims/:id/approve',
    spec: 'test/integration/isolation/admin-lab-claims.spec.ts',
  },
  {
    route: 'POST /v1/admin/claims/:id/reject',
    spec: 'test/integration/isolation/admin-lab-claims.spec.ts',
  },
  {
    route: 'POST /v1/admin/claims/:id/letterhead/download-url',
    spec: 'test/integration/isolation/admin-lab-claims.spec.ts',
  },
  {
    route: 'GET /v1/customer/sites/:id',
    spec: 'test/integration/isolation/customer-sites.spec.ts',
  },
  {
    route: 'PATCH /v1/customer/sites/:id',
    spec: 'test/integration/isolation/customer-sites.spec.ts',
  },
];

/** Routes with an id that touch no tenant data (for example a public reference lookup). */
export const REAL_APP_EXEMPTIONS: readonly Exemption[] = [];

/**
 * Cases for the test-only routes of `FixtureIsolationController`: they prove the harness, and
 * `coverage.spec.ts` runs the same coverage rule over them.
 */
export const FIXTURE_CASES: readonly IsolationCase[] = [
  { route: 'GET /v1/fx-iso/members/:id', spec: 'test/integration/isolation/harness.spec.ts' },
  {
    route: 'GET /v1/fx-iso/customer-sites/:id',
    spec: 'test/integration/isolation/harness.spec.ts',
  },
  { route: 'GET /v1/fx-iso/lab-sites/:id', spec: 'test/integration/isolation/harness.spec.ts' },
];

/**
 * Demonstrations that are not coverage: the negative control (a deliberately leaky route that the
 * kit must reject) and the real `/me` routes, which take no id in the path but do take a
 * membership id in the body or header.
 */
export const DEMONSTRATION_CASES: readonly IsolationCase[] = [
  {
    route: 'GET /v1/fx-iso-leaky/members/:id',
    spec: 'test/integration/isolation/negative.spec.ts',
  },
  { route: 'POST /v1/me/active-membership', spec: 'test/integration/isolation/me.spec.ts' },
  { route: 'GET /v1/me', spec: 'test/integration/isolation/me.spec.ts' },
];

/** What `expectIsolated` accepts. */
export const ISOLATION_CASES: readonly IsolationCase[] = [
  ...REAL_APP_CASES,
  ...FIXTURE_CASES,
  ...DEMONSTRATION_CASES,
];
