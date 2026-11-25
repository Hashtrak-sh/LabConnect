import { type Prisma, type PrismaClient, withDbContext } from '@labconnect/database';

/**
 * Runs `work` as an anonymous visitor: the four policy settings of the row-level security
 * policies (TENANT_ISOLATION.md section 3) are all written empty, so no tenant row, no platform
 * row and no system row is visible. What remains is public reference data (taxonomies, lab
 * sites, accreditation, scope lines, published price lists, slots), which has no policy or a
 * permissive one. That is the context the public search is meant to run in (FR-DIS-09: search
 * works without login), and it is why neither search path uses the `system` context: a bug in
 * a search query cannot show a draft price list or another tenant's row, because the database
 * would not hand it over.
 *
 * The transaction is read-only and repeatable-read, so the two queries of a page see one state
 * and nothing in search can write. Use only the `tx` client inside `work`.
 *
 * It is the `public` kind of `withDbContext`, the one place that writes the policy settings,
 * made read-only and repeatable-read.
 */
export function withPublicReadContext<T>(
  prisma: Pick<PrismaClient, '$transaction'>,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { maxWait?: number; timeout?: number } = {},
): Promise<T> {
  return withDbContext(
    prisma,
    { kind: 'public' },
    async (tx) => {
      // Allowed after the settings query: a transaction may become read-only at any point.
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return work(tx);
    },
    { isolationLevel: 'RepeatableRead', ...options },
  );
}
