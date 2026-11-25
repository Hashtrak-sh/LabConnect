import type { Prisma, PrismaClient } from './generated/prisma/client.js';

/**
 * Who a unit of work runs as, for the row-level security policies
 * (docs/02-architecture/TENANT_ISOLATION.md section 3, ADR-005).
 *
 * - `tenant`: a member of a customer or lab organisation. `orgId` comes from the
 *   authenticated membership, never from the request.
 * - `platform`: platform staff.
 * - `system`: a background job, or the API before a user is known (finding a session
 *   by its token). It sees every tenant's rows, so its use is limited to named
 *   modules (OQ-30).
 * - `public`: an anonymous visitor (public search, lab pages). Nothing is set, so no tenant,
 *   platform or system row is visible: only public reference data, which has no policy or a
 *   permissive one.
 */
export type DbContext =
  | { kind: 'tenant'; orgId: string; userId: string }
  | { kind: 'platform'; userId: string; orgId?: string }
  | { kind: 'system' }
  | { kind: 'public' };

export interface DbContextOptions {
  /** How long to wait for a free pooled connection, in ms. Prisma's default is 2000. */
  maxWait?: number;
  /** How long the transaction may run, in ms. Prisma's default is 5000. */
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * Runs `work` in one transaction with the session settings the policies read.
 *
 * The settings are transaction-local (`set_config(..., true)`, the same as SET LOCAL),
 * so they end with the transaction and never reach the next user of a pooled
 * connection. All four are written every time, so nothing is inherited.
 *
 * Use only the `tx` client inside `work`. A query sent through the outer client runs
 * on another connection, without the settings, and sees no tenant rows.
 */
export function withDbContext<T>(
  prisma: Pick<PrismaClient, '$transaction'>,
  context: DbContext,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: DbContextOptions,
): Promise<T> {
  const anonymous = context.kind === 'system' || context.kind === 'public';
  const orgId = anonymous ? '' : (context.orgId ?? '');
  const userId = anonymous ? '' : context.userId;
  const isPlatform = context.kind === 'platform' ? 'true' : '';
  const isSystem = context.kind === 'system' ? 'true' : '';

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT set_config('app.org_id', ${orgId}, true),
             set_config('app.user_id', ${userId}, true),
             set_config('app.is_platform', ${isPlatform}, true),
             set_config('app.is_system', ${isSystem}, true)`;
    return work(tx);
  }, options);
}
