import { randomUUID } from 'node:crypto';
import { Alert, Button, Card, formatDateTime, StatePanel } from '@labconnect/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import messages from '../../../../../messages/en.json';
import { gate } from '@/features/access/access';
import { CLAIM_REVIEW_ROLES } from '@/features/access/roles';
import { isUuid, etagOf } from '@/features/common/problem';
import { ClaimStatusBadge } from '@/features/claim/ClaimStatusBadge';
import { ApproveForm, LetterheadButton, RejectForm } from '@/features/ops-claims/DecisionForms';
import { loadClaim, loadSite } from '@/features/ops-claims/ops-data';
import { t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: `${t('ops.detailTitle')} · ${t('app.name')}`,
  robots: { index: false, follow: false },
};

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="text-sm text-text-muted sm:w-44 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/**
 * One claim for Platform Ops (board J9): the lab (its public profile, because the claim carries
 * only ids), the claimant (by reference: the API gives no name), how it was verified, when, and
 * the letterhead, opened only by a click. Approve and reject are a confirm step each
 * (`?decide=approve|reject`), as plain links and forms. A decided claim shows its outcome.
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
  const claim = isUuid(id) ? await loadClaim(access.token, id) : null;
  if (claim === null) {
    return (
      <div className="mx-auto max-w-lg py-6">
        <h1 className="sr-only">{t('ops.detailTitle')}</h1>
        <StatePanel
          kind="empty"
          title={t('ops.unknownTitle')}
          action={
            <Button asChild variant="secondary">
              <Link href="/admin/claims">{t('ops.backToList')}</Link>
            </Button>
          }
        >
          <p>{t('ops.unknown')}</p>
        </StatePanel>
      </div>
    );
  }
  const site = await loadSite(claim.labSiteId);
  const decide = single(query.decide);
  const decided = single(query.decided);
  const here = `/admin/claims/${claim.id}`;
  const etag = etagOf(claim.lockVersion);
  const waiting = claim.status === 'PENDING_REVIEW';

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 py-6">
      <Link href="/admin/claims" className="text-sm">
        {t('ops.backToList')}
      </Link>
      <h1 className="text-2xl font-bold text-text">{t('ops.detailTitle')}</h1>
      {decided === 'approved' && (
        <Alert tone="success" title={t('ops.approvedTitle')}>
          {t('ops.approvedText')}
        </Alert>
      )}
      {decided === 'rejected' && (
        <Alert tone="success" title={t('ops.rejectedTitle')}>
          {t('ops.rejectedText')}
        </Alert>
      )}
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{site?.name ?? t('ops.labUnavailable')}</h2>
          <ClaimStatusBadge status={claim.status} />
        </div>
        <dl className="flex flex-col gap-3">
          {site !== null && (
            <>
              <Row label={t('ops.rowAddress')}>
                {site.address.line1}, {site.address.city} {site.address.pincode}
              </Row>
              <Row label={t('ops.rowCertificate')}>
                {site.accreditations.map((accreditation) => accreditation.certificateNo).join(', ')}
              </Row>
            </>
          )}
          <Row label={t('ops.rowClaimant')}>
            <span className="font-mono text-sm">{claim.requestedByUserId}</span>
          </Row>
          <Row label={t('ops.rowMethod')}>
            {claim.method === 'MANUAL' ? t('ops.methodManual') : t('ops.methodCode')}
          </Row>
          <Row label={t('ops.rowRequested')}>{formatDateTime(claim.createdAt)}</Row>
          {claim.reviewedAt !== null && (
            <Row label={t('ops.rowDecided')}>{formatDateTime(claim.reviewedAt)}</Row>
          )}
          {claim.decisionNotes !== null && (
            <Row label={t('ops.rowNotes')}>{claim.decisionNotes}</Row>
          )}
        </dl>
        <p className="text-sm text-text-muted">{t('ops.claimantNote')}</p>
      </Card>
      {claim.method === 'MANUAL' && (
        <Card className="p-5">
          <h2 className="mb-3 text-lg font-semibold">{t('ops.letterTitle')}</h2>
          <LetterheadButton text={messages.ops} claimId={claim.id} initialKey={randomUUID()} />
        </Card>
      )}
      {waiting ? (
        decide === 'approve' ? (
          <Card className="p-5">
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
          <Card className="flex flex-wrap items-center gap-3 p-5">
            <h2 className="mr-auto text-lg font-semibold">{t('ops.decisionTitle')}</h2>
            <Button asChild>
              <Link href={`${here}?decide=approve`}>{t('ops.approve')}</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={`${here}?decide=reject`}>{t('ops.reject')}</Link>
            </Button>
          </Card>
        )
      ) : (
        <Alert tone="info">{t('ops.notWaiting')}</Alert>
      )}
    </div>
  );
}
