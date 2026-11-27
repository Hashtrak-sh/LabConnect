import { Button, Card, formatDateTime, StatePanel } from '@labconnect/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { gate } from '@/features/access/access';
import { CLAIM_REVIEW_ROLES } from '@/features/access/roles';
import { ClaimStatusBadge } from '@/features/claim/ClaimStatusBadge';
import { loadClaimPage, loadSite, PAGE_SIZE } from '@/features/ops-claims/ops-data';
import {
  type ClaimStatus,
  readStatusFilter,
  STATUS_FILTERS,
} from '@/features/ops-claims/ops-model';
import { type MessageKey, t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: `${t('ops.title')} · ${t('app.name')}`,
  robots: { index: false, follow: false },
};

const FILTER_LABELS: Readonly<Record<ClaimStatus, MessageKey>> = {
  PENDING_REVIEW: 'claim.statusPendingReview',
  PENDING_OTP: 'claim.statusPendingOtp',
  APPROVED: 'claim.statusApproved',
  REJECTED: 'claim.statusRejected',
  EXPIRED: 'claim.statusExpired',
};

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/**
 * Claim requests for Platform Ops (board J9, claims only: KYC and bank review are not built in the
 * API, so nothing is drawn for them). By default the claims waiting for a decision; a filter by
 * status; the API's own paging (oldest first, "next page" by cursor). A role other than Platform
 * Ops sees board G3's "no access" and nothing of the list.
 */
export default async function AdminClaimsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await gate(CLAIM_REVIEW_ROLES);
  if (!access.ok) return access.panel;
  const params = await searchParams;
  const raw = single(params.status);
  const status = raw === 'ALL' ? null : (readStatusFilter(raw) ?? 'PENDING_REVIEW');
  const cursor = single(params.cursor) || null;
  const page = await loadClaimPage(access.token, { status, cursor, limit: PAGE_SIZE });

  const siteIds = [...new Set(page?.data.map((claim) => claim.labSiteId) ?? [])];
  const sites = new Map(
    await Promise.all(siteIds.map(async (siteId) => [siteId, await loadSite(siteId)] as const)),
  );
  const filterHref = (value: string) => `/admin/claims?status=${value}`;

  return (
    <div className="flex flex-col gap-4 py-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-text">{t('ops.title')}</h1>
        <p className="text-text-muted">{t('ops.intro')}</p>
      </div>
      <nav aria-label={t('ops.filterLabel')} className="flex flex-wrap gap-2">
        {[null, ...STATUS_FILTERS].map((value) => {
          const active = value === status;
          return (
            <Link
              key={value ?? 'ALL'}
              href={filterHref(value ?? 'ALL')}
              aria-current={active ? 'true' : undefined}
              className="inline-flex min-h-9 items-center rounded-full border border-border-strong bg-surface-raised px-3.5 text-sm font-medium text-text no-underline max-md:min-h-11 aria-[current=true]:border-brand-primary aria-[current=true]:bg-brand-tint aria-[current=true]:text-brand-on-tint"
            >
              {value === null ? t('ops.filterAll') : t(FILTER_LABELS[value])}
            </Link>
          );
        })}
      </nav>
      {page === null ? (
        <StatePanel
          kind="error"
          title={t('ops.loadFailedTitle')}
          action={
            <Button asChild variant="secondary">
              <Link href={filterHref(status ?? 'ALL')}>{t('ops.tryAgain')}</Link>
            </Button>
          }
        >
          <p>{t('ops.loadFailed')}</p>
        </StatePanel>
      ) : page.data.length === 0 ? (
        <StatePanel kind="empty" title={t('ops.emptyTitle')}>
          <p>{t('ops.empty')}</p>
        </StatePanel>
      ) : (
        <ul className="flex flex-col gap-3">
          {page.data.map((claim) => {
            const site = sites.get(claim.labSiteId);
            return (
              <li key={claim.id}>
                <Card className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 flex-col gap-1">
                    <Link href={`/admin/claims/${claim.id}`} className="font-medium">
                      {site?.name ?? t('ops.labUnavailable')}
                    </Link>
                    <p className="text-sm text-text-muted">
                      {site === null || site === undefined
                        ? t('ops.certificateUnknown')
                        : t('claim.certificate', {
                            number: site.accreditations.map((a) => a.certificateNo).join(', '),
                          })}{' '}
                      · {claim.method === 'MANUAL' ? t('ops.methodManual') : t('ops.methodCode')} ·{' '}
                      {formatDateTime(claim.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <ClaimStatusBadge status={claim.status} />
                    <Button asChild variant="secondary">
                      <Link href={`/admin/claims/${claim.id}`}>
                        {claim.status === 'PENDING_REVIEW' ? t('ops.review') : t('ops.open')}
                      </Link>
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {page !== null && (cursor !== null || page.nextCursor !== null) && (
        <div className="flex flex-wrap gap-3">
          {cursor !== null && <Link href={filterHref(status ?? 'ALL')}>{t('ops.firstPage')}</Link>}
          {page.nextCursor !== null && (
            <Link
              href={`/admin/claims?status=${status ?? 'ALL'}&cursor=${encodeURIComponent(page.nextCursor)}`}
            >
              {t('ops.nextPage')}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
