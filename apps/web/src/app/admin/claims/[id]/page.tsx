import { randomUUID } from 'node:crypto';
import { Alert, Button, Card, formatDateTime, StatePanel } from '@labconnect/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import messages from '../../../../../messages/en.json';
import { gate, SignInRequired } from '@/features/access/access';
import { CLAIM_REVIEW_ROLES } from '@/features/access/roles';
import { ClaimStatusBadge } from '@/features/claim/ClaimStatusBadge';
import { isUuid } from '@/features/common/problem';
import { ApproveForm, LetterheadButton, RejectForm } from '@/features/ops-claims/DecisionForms';
import { loadClaim } from '@/features/ops-claims/ops-data';
import { approvalBlockers, certificateNumbers } from '@/features/ops-claims/ops-model';
import { ORG_TYPE_KEYS } from '@/features/ops-claims/org-labels';
import { t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: `${t('ops.detailTitle')} · ${t('app.name')}`,
  robots: { index: false, follow: false },
};

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="text-sm text-text-muted sm:w-44 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Panel({
  kind,
  title,
  children,
  retry,
}: {
  kind: 'empty' | 'error';
  title: string;
  children: ReactNode;
  retry?: string;
}) {
  return (
    <div className="mx-auto max-w-lg py-6">
      <h1 className="sr-only">{t('ops.detailTitle')}</h1>
      <StatePanel
        kind={kind}
        title={title}
        action={
          <Button asChild variant="secondary">
            <Link href={retry ?? '/admin/claims'}>
              {retry === undefined ? t('ops.backToList') : t('ops.tryAgain')}
            </Link>
          </Button>
        }
      >
        {children}
      </StatePanel>
    </div>
  );
}

/**
 * One claim for Platform Ops (board J9), read from `getAdminLabClaim`: the lab (name, city, state,
 * certificate numbers), the claimant (name, the address as the API masks it, the other kinds of
 * organisation they belong to), how it was verified, when, and the letterhead, opened only by a
 * click. Approve and reject are a confirm step each (`?decide=approve|reject`), as plain links and
 * forms, carrying the `ETag` of this read as `If-Match`. When the claimant belongs to a lab or a
 * platform organisation, the page says so before the confirm step: the API would refuse the approval.
 */
export default async function AdminClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await gate(CLAIM_REVIEW_ROLES);
  if (!access.ok) return access.panel;
  const { id } = await params;
  const query = await searchParams;
  const notFound = (
    <Panel kind="empty" title={t('ops.unknownTitle')}>
      <p>{t('ops.unknown')}</p>
    </Panel>
  );
  if (!isUuid(id)) return notFound;
  const read = await loadClaim(access.token, id);
  switch (read.kind) {
    case 'signed-out':
      return <SignInRequired />;
    case 'forbidden':
      return (
        <Panel kind="error" title={t('ops.forbiddenTitle')}>
          <p>{t('ops.forbidden')}</p>
        </Panel>
      );
    case 'not-found':
      return notFound;
    case 'unavailable':
      return (
        <Panel kind="error" title={t('ops.unavailableTitle')} retry={`/admin/claims/${id}`}>
          <p>{t('ops.unavailable')}</p>
        </Panel>
      );
    case 'ok':
      break;
  }
  const { claim, etag } = read;
  const { labSite, claimant } = claim;
  const decide = single(query.decide);
  const decided = single(query.decided);
  const here = `/admin/claims/${claim.id}`;
  const waiting = claim.status === 'PENDING_REVIEW';
  const blockers = approvalBlockers(claimant.organisationTypes);
  const certificates = certificateNumbers(labSite.certificateNos);
  const blocked =
    blockers.length === 0 ? null : (
      <Alert tone="danger" title={t('ops.blockedLabTitle')}>
        {blockers.includes('LAB') && <p>{t('ops.blockedLab')}</p>}
        {blockers.includes('PLATFORM') && <p>{t('ops.blockedPlatform')}</p>}
      </Alert>
    );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 py-6">
      <Link href="/admin/claims" className="text-sm">
        {t('ops.backToList')}
      </Link>
      <h1 className="text-2xl font-bold text-text">{t('ops.detailTitle')}</h1>
      {decided === 'approved' && claim.status === 'APPROVED' && (
        <Alert tone="success" title={t('ops.approvedTitle')}>
          {t('ops.approvedText')}
        </Alert>
      )}
      {decided === 'rejected' && claim.status === 'REJECTED' && (
        <Alert tone="success" title={t('ops.rejectedTitle')}>
          {t('ops.rejectedText')}
        </Alert>
      )}
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="break-words text-lg font-semibold">{labSite.name}</h2>
          <ClaimStatusBadge status={claim.status} />
        </div>
        <dl className="flex flex-col gap-3">
          <Row label={t('ops.rowLocation')}>
            {[labSite.city, labSite.stateCode].filter((part) => part !== '').join(', ')}
          </Row>
          <Row label={t('ops.rowSiteCode')}>{labSite.siteCode}</Row>
          <Row label={t('ops.rowCertificate')}>{certificates ?? t('ops.noCertificates')}</Row>
          <Row label={t('ops.rowClaimantName')}>{claimant.fullName}</Row>
          <Row label={t('ops.rowClaimantEmail')}>{claimant.emailMasked}</Row>
          <Row label={t('ops.rowOtherOrgs')}>
            {claimant.organisationTypes.length === 0
              ? t('ops.otherOrgsNone')
              : claimant.organisationTypes.map((type) => t(ORG_TYPE_KEYS[type])).join(', ')}
          </Row>
          <Row label={t('ops.rowMethod')}>
            {claim.method === 'MANUAL' ? t('ops.methodManual') : t('ops.methodCode')}
          </Row>
          <Row label={t('ops.rowRequested')}>{formatDateTime(claim.createdAt)}</Row>
          {claim.reviewedAt !== null && (
            <Row label={t('ops.rowDecided')}>{formatDateTime(claim.reviewedAt)}</Row>
          )}
          {claim.decisionNotes !== null && (
            <Row label={t('ops.rowNotes')}>
              <span className="whitespace-pre-wrap">{claim.decisionNotes}</span>
            </Row>
          )}
        </dl>
        <p className="text-sm text-text-muted">{t('ops.claimantMasked')}</p>
      </Card>
      {claim.method === 'MANUAL' && (
        <Card className="p-5">
          <h2 className="mb-3 text-lg font-semibold">{t('ops.letterTitle')}</h2>
          <LetterheadButton text={messages.ops} claimId={claim.id} initialKey={randomUUID()} />
        </Card>
      )}
      {waiting ? (
        decide === 'approve' ? (
          <Card className="flex flex-col gap-4 p-5">
            {blocked}
            <ApproveForm
              text={messages.ops}
              claimId={claim.id}
              etag={etag}
              initialKey={randomUUID()}
              cancelHref={here}
            />
          </Card>
        ) : decide === 'reject' ? (
          <Card className="p-5">
            <RejectForm
              text={messages.ops}
              claimId={claim.id}
              etag={etag}
              initialKey={randomUUID()}
              cancelHref={here}
            />
          </Card>
        ) : (
          <Card className="flex flex-col gap-4 p-5">
            {blocked}
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="mr-auto text-lg font-semibold">{t('ops.decisionTitle')}</h2>
              <Button asChild>
                <Link href={`${here}?decide=approve`}>{t('ops.approve')}</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href={`${here}?decide=reject`}>{t('ops.reject')}</Link>
              </Button>
            </div>
          </Card>
        )
      ) : (
        <Alert tone="info">{t('ops.notWaiting')}</Alert>
      )}
    </div>
  );
}
