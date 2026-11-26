import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Source scan (TENANT_ISOLATION.md section 3, OQ-30): `system` sees every tenant's rows, so the
// code that may open it is a short, reviewed list. A new caller fails this test and shows up in
// the diff: add it to the list below, and say why in the review.

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'generated', '.next', '.turbo']);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) || entry.name === 'test'
        ? []
        : sourceFiles(join(directory, entry.name));
    }
    return /\.tsx?$/.test(entry.name) && !/\.(spec|test)\.tsx?$/.test(entry.name)
      ? [join(directory, entry.name)]
      : [];
  });
}

/** Code without comments, so prose about `runAsSystem(` does not count. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function scan(roots: string[], pattern: RegExp): Record<string, number> {
  const found: Record<string, number> = {};
  for (const root of roots) {
    for (const file of sourceFiles(join(ROOT, root))) {
      const count = (codeOf(file).match(pattern) ?? []).length;
      if (count > 0) found[relative(ROOT, file).replaceAll('\\', '/')] = count;
    }
  }
  return found;
}

const ALL_SOURCES = ['apps', 'packages'];

describe('who may open the system database context', () => {
  it('lists every call of TenantScope.runAsSystem, with how many', () => {
    expect(scan(ALL_SOURCES, /\.runAsSystem\s*(?:<[^>]*>)?\(/g)).toEqual({
      // Before a user is known: OTP request, OTP verification and sign-in, refresh by token, and
      // the session lookup of AuthGuard. Each call states its reason.
      'apps/api/src/modules/identity/identity.service.ts': 4,
      // Lab claim start and verify (I1-LAB-01, I1-LAB-02): the claimant is a signed-in user who
      // belongs to no organisation, so the policies of lab_claim_request and lab_site_private
      // (app_is_org) hide those rows from them, and otp_challenge is platform/system only. A tenant
      // context carrying the claimed organisation would open every table of that organisation and
      // take its id from a lookup, not a membership; so the core functions run as `system` in one
      // transaction and scope each query by hand (requested_by_user_id = the caller). One call each.
      // Lab claim letterhead upload URL and submit (I1-LAB-03, I1-LAB-04), same reason, and also:
      // the letterhead `file_object` has no owning organisation (owner_org_id NULL), so its row
      // policy lets only the platform or the system insert and read it, and no tenant can reach it.
      // Every query is by claim + caller (+ uploader, purpose and file_link for the file). Two more.
      'apps/api/src/modules/labs/lab-claims.service.ts': 4,
      // The gateway's server-to-server callback: no user, and no tenant until it is matched.
      'apps/api/src/modules/payments/payment-webhook.controller.ts': 1,
    });
  });

  it('lists every direct use of withDbContext (the worker-side platform services and the scope)', () => {
    expect(scan(ALL_SOURCES, /\bwithDbContext\s*(?:<[^>]*>)?\(/g)).toEqual({
      // The one place that sets the policy settings.
      'packages/database/src/db-context.ts': 1,
      // The scope: tenant, platform (also on behalf), user-only and the named system method.
      'packages/core/src/identity/tenant-scope.ts': 4,
      // Anonymous public reads (search, lab directory): the `public` kind, read-only. Never the system context.
      'packages/core/src/platform/public-context.ts': 1,
      // Worker and job services that run as SYSTEM with an explicit scope (TENANT_ISOLATION rule 7).
      'packages/core/src/platform/audit-chain.ts': 3,
      'packages/core/src/platform/relay.ts': 1,
      'packages/core/src/platform/timers.ts': 2,
      // The worker's scan processor: decides a file from its scan result (P3-06). The dev-only
      // scan job finds pending uploads; it refuses to run outside development and test.
      'packages/core/src/files/scan-processor.ts': 3,
      'packages/core/src/files/dev-scan.ts': 1,
      // The worker's notification consumer (one transaction per event) and email delivery pass
      // (claim, mark sent, mark failed), P3-08. Notification rows of every user are written and read.
      'packages/core/src/notifications/dispatch.ts': 1,
      // The booking adapter of the context port: reads the booking row of an event's aggregate in
      // the system context, because the consumer must resolve bookings of every organisation.
      'packages/core/src/notifications/booking-context.ts': 1,
      'packages/core/src/notifications/delivery.ts': 3,
      // The worker's job that processes stored gateway notifications (P3-09).
      'packages/core/src/payments/service.ts': 1,
    });
  });

  it('keeps the API from building a system context by hand', () => {
    expect(scan(['apps/api/src'], /kind\s*:\s*['"]system['"]/g)).toEqual({});
    expect(scan(['apps/api/src'], /\bwithDbContext\b/g)).toEqual({});
  });

  it('lists every place that spells out the system context', () => {
    expect(scan(ALL_SOURCES, /kind\s*:\s*['"]system['"]/g)).toEqual({
      'packages/database/src/db-context.ts': 1,
      'packages/core/src/identity/tenant-scope.ts': 1,
      'packages/core/src/platform/audit-chain.ts': 3,
      'packages/core/src/platform/relay.ts': 1,
      'packages/core/src/platform/timers.ts': 2,
      'packages/core/src/files/scan-processor.ts': 3,
      'packages/core/src/files/dev-scan.ts': 1,
      // The worker's notification consumer (one transaction per event) and email delivery pass
      // (claim, mark sent, mark failed), P3-08. Notification rows of every user are written and read.
      'packages/core/src/notifications/dispatch.ts': 1,
      // The booking adapter of the context port: reads the booking row of an event's aggregate in
      // the system context, because the consumer must resolve bookings of every organisation.
      'packages/core/src/notifications/booking-context.ts': 1,
      'packages/core/src/notifications/delivery.ts': 3,
      // The worker's job that processes stored gateway notifications (P3-09).
      'packages/core/src/payments/service.ts': 1,
    });
  });
});
