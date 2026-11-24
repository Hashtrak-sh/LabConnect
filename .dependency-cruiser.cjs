// Module rules from docs/02-architecture/MODULE_BOUNDARIES.md, enforced in CI.
// Paths match both apps/api/src/modules/<module> and apps/worker/src/modules/<module>.
const moduleDir = (names) => `^apps/(api|worker)/src/modules/(${names})/`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make modules impossible to reason about or test alone.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'platform-depends-on-nothing',
      severity: 'error',
      comment: 'Rule 1: platform depends on no other module. Everything may depend on platform.',
      from: { path: moduleDir('platform') },
      to: { path: moduleDir('[^/]+'), pathNot: moduleDir('platform') },
    },
    {
      name: 'identity-and-files-only-on-platform',
      severity: 'error',
      comment: 'Rule 2: identity and files depend only on platform.',
      from: { path: moduleDir('identity|files') },
      to: {
        path: moduleDir('[^/]+'),
        pathNot: [moduleDir('platform'), '^apps/(api|worker)/src/modules/$2/'],
      },
    },
    {
      name: 'booking-never-calls-payments-custody-reports',
      severity: 'error',
      comment:
        'Rule 3: booking must never call payments, custody or reports. Those modules call BookingEngine.transition() instead.',
      from: { path: moduleDir('booking') },
      to: { path: moduleDir('payments|custody|reports') },
    },
    {
      name: 'notifications-and-search-are-consumers-only',
      severity: 'error',
      comment: 'Rule 5: nothing calls notifications or search synchronously. They react to events.',
      from: { path: moduleDir('[^/]+'), pathNot: moduleDir('notifications|search') },
      to: { path: moduleDir('notifications|search') },
    },
    {
      name: 'packages-never-import-apps',
      severity: 'error',
      comment: 'Shared packages are consumed by apps, never the other way round.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'apps-never-import-each-other',
      severity: 'error',
      comment: 'web, api and worker share code only through packages/*.',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|\\.next|\\.turbo|coverage|node_modules|generated)/' },
    tsPreCompilationDeps: true,
  },
};
