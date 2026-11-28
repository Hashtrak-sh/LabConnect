import { Alert, Button, Card, formatDateTime, StatePanel } from '@labconnect/ui';
import Link from 'next/link';
import { SignInRequired } from '@/features/access/access';
import { t } from '@/lib/i18n';
import type { ClaimPage } from './claim-data';
import { ClaimStatusBadge } from './ClaimStatusBadge';

/**
 * "Your claims" (board H4), as `listMyLabClaims` answered: the caller's claims, newest first, one
 * page at a time by the API's own cursor (plain links, so it works without JavaScript). A read that
 * failed is said to have failed: "the service did not answer" is not "you have no claims".
 */
export function ClaimList({ page, cursor }: { page: ClaimPage; cursor: string | null }) {
  switch (page.kind) {
    case 'signed-out':
      return <SignInRequired />;
    case 'staff':
      return (
        <Alert tone="warning" title={t('claim.staffTitle')}>
          {t('claim.staff')}
        </Alert>
      );
    case 'bad-page':
      return (
        <StatePanel
          kind="empty"
          title={t('claim.pageGoneTitle')}
          action={
            <Button asChild variant="secondary">
              <Link href="/lab/claim">{t('claim.newestClaims')}</Link>
            </Button>
          }
        >
          <p>{t('claim.pageGone')}</p>
        </StatePanel>
      );
    case 'not-found':
    case 'unavailable':
      return (
        <StatePanel
          kind="error"
          title={t('claim.listUnavailableTitle')}
          action={
            <Button asChild variant="secondary">
              <Link
                href={
                  cursor === null ? '/lab/claim' : `/lab/claim?cursor=${encodeURIComponent(cursor)}`
                }
              >
                {t('claim.tryAgain')}
              </Link>
            </Button>
          }
        >
          <p>{t('claim.listUnavailable')}</p>
        </StatePanel>
      );
    case 'ok':
      break;
  }
  if (page.claims.length === 0 && cursor === null) {
    return <p className="text-text-muted">{t('claim.noClaims')}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {page.claims.map((claim) => (
          <li key={claim.id}>
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <Link href={`/lab/claim/${claim.id}`} className="break-words font-medium">
                  {claim.labSite.name}
                </Link>
                <p className="text-sm text-text-muted">
                  {t('claim.siteCode', { code: claim.labSite.siteCode })} ·{' '}
                  {formatDateTime(claim.createdAt)}
                </p>
              </div>
              <ClaimStatusBadge status={claim.status} />
            </Card>
          </li>
        ))}
      </ul>
      {(cursor !== null || page.nextCursor !== null) && (
        <div className="flex flex-wrap gap-3">
          {cursor !== null && <Link href="/lab/claim">{t('claim.newestClaims')}</Link>}
          {page.nextCursor !== null && (
            <Link href={`/lab/claim?cursor=${encodeURIComponent(page.nextCursor)}`}>
              {t('claim.olderClaims')}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
