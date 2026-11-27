import { randomUUID } from 'node:crypto';
import { Alert, Button, Card, formatDateTime, StatePanel } from '@labconnect/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import messages from '../../../../../messages/en.json';
import { gate, SignInRequired } from '@/features/access/access';
import { loadMyClaim } from '@/features/claim/claim-data';
import {
  CLAIM_LIMITS,
  mayReadClaims,
  readReloadNotice,
  reasonForClaimant,
} from '@/features/claim/claim-model';
import { ClaimPanel } from '@/features/claim/ClaimPanel';
import { ClaimStatusBadge } from '@/features/claim/ClaimStatusBadge';
import { hasLegacyClaimsCookie } from '@/features/claim/legacy-cookie';
import { isUuid } from '@/features/common/problem';
import { type MessageKey, t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: `${t('claim.title')} · ${t('app.name')}`,
  robots: { index: false, follow: false },
};

const STATUS_KEYS: Readonly<Record<string, MessageKey>> = {
  PENDING_OTP: 'claim.statusPendingOtp',
  PENDING_REVIEW: 'claim.statusPendingReview',
  APPROVED: 'claim.statusApproved',
  REJECTED: 'claim.statusRejected',
  EXPIRED: 'claim.statusExpired',
};

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-lg py-6">
      <h1 className="sr-only">{t('claim.title')}</h1>
      {children}
    </div>
  );
}

function NotFound() {
  return (
    <Centered>
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
    </Centered>
  );
}

function Unavailable({ id }: { id: string }) {
  return (
    <Centered>
      <StatePanel
        kind="error"
        title={t('claim.claimUnavailableTitle')}
        action={
          <Button asChild variant="secondary">
            <Link href={`/lab/claim/${id}`}>{t('claim.tryAgain')}</Link>
          </Button>
        }
      >
        <p>{t('claim.claimUnavailable')}</p>
      </StatePanel>
    </Centered>
  );
}

/**
 * One claim (board H4 steps 2 and 3, and its end states), read from the API now
 * (`getLabClaim`) and never remembered. Another person's claim id in the address, and an id that
 * never existed, are the same 404 and so the same "we can't find this claim". Platform staff are
 * told they cannot claim and the claimant read is not called for them (it would answer 403). A
 * service that does not answer is said to be unavailable, which is not "not found".
 */
export default async function ClaimDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  // The claims record of the earlier build (a cookie) is deleted once; nothing reads it.
  if (await hasLegacyClaimsCookie()) {
    redirect(isUuid(id) ? `/lab/claim/forget-old-copy?to=${id}` : '/lab/claim/forget-old-copy');
  }
  const access = await gate();
  if (!access.ok) return access.panel;
  if (!mayReadClaims(access.user)) {
    return (
      <Centered>
        <Alert tone="warning" title={t('claim.staffTitle')}>
          {t('claim.staff')}
        </Alert>
      </Centered>
    );
  }
  if (!isUuid(id)) return <NotFound />;
  const read = await loadMyClaim(access.token, id);
  switch (read.kind) {
    case 'signed-out':
      return <SignInRequired />;
    case 'staff':
      return (
        <Centered>
          <Alert tone="warning" title={t('claim.staffTitle')}>
            {t('claim.staff')}
          </Alert>
        </Centered>
      );
    case 'not-found':
    case 'bad-page':
      return <NotFound />;
    case 'unavailable':
      return <Unavailable id={id} />;
    case 'ok':
      break;
  }
  const { claim, etag } = read;
  const notice = readReloadNotice((await searchParams).n);
  const reason = reasonForClaimant(claim);

  let body: ReactNode;
  if (claim.status === 'PENDING_OTP') {
    // Without the version there is nothing a form could send as `If-Match`.
    if (etag === null) return <Unavailable id={id} />;
    body = (
      <ClaimPanel
        text={messages.claim}
        claimId={claim.id}
        etag={etag}
        initialKey={randomUUID()}
        otpSentTo={claim.otpSentTo}
        siteName={claim.labSite.name}
      />
    );
  } else if (claim.status === 'PENDING_REVIEW') {
    body = (
      <Alert tone="info" title={t('claim.reviewTitle')}>
        <p>{t('claim.review')}</p>
        <p>{t('claim.reviewNext')}</p>
      </Alert>
    );
  } else if (claim.status === 'APPROVED') {
    body = (
      <Alert tone="success" title={t('claim.approvedTitle')}>
        <p>{t('claim.approved')}</p>
        <p>{t('claim.approvedNext')}</p>
        <p>{t('claim.approvedLater')}</p>
      </Alert>
    );
  } else if (claim.status === 'REJECTED') {
    body = (
      <div className="flex flex-col gap-3">
        <Alert tone="danger" title={t('claim.rejectedTitle')}>
          <p>{reason === null ? t('claim.rejectedNoReason') : t('claim.rejectedReasonIntro')}</p>
          {reason !== null && (
            <blockquote className="border-l-2 border-border-strong pl-3 whitespace-pre-wrap break-words">
              {reason}
            </blockquote>
          )}
          <p>{t('claim.rejectedNext')}</p>
        </Alert>
        <Button asChild className="self-start">
          <Link href="/lab/claim">{t('claim.startAgain')}</Link>
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <Alert tone="warning" title={t('claim.expiredTitle')}>
          <p>{t('claim.expired', { hours: CLAIM_LIMITS.codeValidHours })}</p>
          <p>{t('claim.expiredNext')}</p>
        </Alert>
        <Button asChild className="self-start">
          <Link href="/lab/claim">{t('claim.startAgain')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 py-6">
      <Link href="/lab/claim" className="text-sm">
        {t('claim.backToClaims')}
      </Link>
      <h1 className="text-2xl font-bold text-text">{t('claim.detailTitle')}</h1>
      {notice === 'changed' && (
        <Alert tone="warning" title={t('claim.changedTitle')}>
          {t('claim.changed')}
        </Alert>
      )}
      {notice === 'moved' && (
        <Alert tone="warning" title={t('claim.movedTitle')}>
          {t('claim.moved', { status: t(STATUS_KEYS[claim.status] ?? 'claim.statusExpired') })}
        </Alert>
      )}
      <Card className="flex flex-col gap-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="break-words font-medium">{claim.labSite.name}</p>
          <ClaimStatusBadge status={claim.status} />
        </div>
        <p className="text-sm text-text-muted">
          {t('claim.siteCode', { code: claim.labSite.siteCode })} ·{' '}
          {t('claim.startedOn', { time: formatDateTime(claim.createdAt) })}
          {claim.reviewedAt !== null &&
            ` · ${t('claim.decidedOn', { time: formatDateTime(claim.reviewedAt) })}`}
        </p>
      </Card>
      <Card className="p-5">{body}</Card>
    </div>
  );
}
