import { randomUUID } from 'node:crypto';
import { Alert, Button, Card, formatDateTime, StatePanel } from '@labconnect/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import messages from '../../../../../messages/en.json';
import { gate } from '@/features/access/access';
import { isUuid } from '@/features/common/problem';
import { loadJar } from '@/features/claim/claim-jar';
import { ClaimPanel } from '@/features/claim/ClaimPanel';
import { ClaimStatusBadge } from '@/features/claim/ClaimStatusBadge';
import { CLAIM_LIMITS } from '@/features/claim/claim-model';
import { t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: `${t('claim.title')} · ${t('app.name')}`,
  robots: { index: false, follow: false },
};

/**
 * One claim (board H4 steps 2 and 3, and its end states). The claim is the one this browser
 * remembers for the signed-in user; another person's claim id in the address is a claim "we can't
 * find", the same panel as an id that never existed, and the API is not asked about it.
 */
export default async function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await gate();
  if (!access.ok) return access.panel;
  const { id } = await params;
  const record = isUuid(id)
    ? (await loadJar(access.user.id)).claims.find((claim) => claim.id === id)
    : undefined;
  if (record === undefined) {
    return (
      <div className="mx-auto max-w-lg py-6">
        <h1 className="sr-only">{t('claim.title')}</h1>
        <StatePanel
          kind="empty"
          title={t('claim.unknownTitle')}
          action={
            <Button asChild variant="secondary">
              <Link href="/lab/claim">{t('claim.backToClaims')}</Link>
            </Button>
          }
        >
          <p>{t('claim.unknown')}</p>
        </StatePanel>
      </div>
    );
  }

  const body =
    record.status === 'PENDING_OTP' ? (
      <ClaimPanel
        text={messages.claim}
        claimId={record.id}
        etag={record.etag}
        initialKey={randomUUID()}
        otpSentTo={record.otpSentTo}
        siteName={record.siteName}
      />
    ) : record.status === 'PENDING_REVIEW' ? (
      <Alert tone="info" title={t('claim.reviewTitle')}>
        <p>{t('claim.review')}</p>
        <p>{t('claim.reviewNext')}</p>
      </Alert>
    ) : record.status === 'APPROVED' ? (
      <Alert tone="success" title={t('claim.approvedTitle')}>
        <p>{t('claim.approved')}</p>
      </Alert>
    ) : record.status === 'REJECTED' ? (
      <div className="flex flex-col gap-3">
        <Alert tone="danger" title={t('claim.rejectedTitle')}>
          {record.decisionNotes !== null && <blockquote>{record.decisionNotes}</blockquote>}
          <p>{t('claim.rejectedNext')}</p>
        </Alert>
        <Button asChild className="self-start">
          <Link href="/lab/claim">{t('claim.startAgain')}</Link>
        </Button>
      </div>
    ) : (
      <div className="flex flex-col gap-3">
        <Alert tone="warning" title={t('claim.expiredTitle')}>
          {t('claim.expired', { hours: CLAIM_LIMITS.codeValidHours })}
        </Alert>
        <Button asChild className="self-start">
          <Link href="/lab/claim">{t('claim.startAgain')}</Link>
        </Button>
      </div>
    );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 py-6">
      <Link href="/lab/claim" className="text-sm">
        {t('claim.backToClaims')}
      </Link>
      <h1 className="text-2xl font-bold text-text">{t('claim.detailTitle')}</h1>
      <Card className="flex flex-col gap-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">{record.siteName}</p>
          <ClaimStatusBadge status={record.status} />
        </div>
        <p className="text-sm text-text-muted">
          {t('claim.certificate', { number: record.certificateNo })} ·{' '}
          {formatDateTime(record.createdAt)}
        </p>
      </Card>
      <Card className="p-5">{body}</Card>
    </div>
  );
}
