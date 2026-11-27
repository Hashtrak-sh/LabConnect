import { randomUUID } from 'node:crypto';
import { Alert, Card, formatDateTime } from '@labconnect/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import messages from '../../../../messages/en.json';
import { roleLabel, gate } from '@/features/access/access';
import { isPlatformStaff, labMemberships } from '@/features/access/roles';
import { loadJar } from '@/features/claim/claim-jar';
import { ClaimStatusBadge } from '@/features/claim/ClaimStatusBadge';
import { StartClaimForm } from '@/features/claim/StartClaimForm';
import { t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: `${t('claim.title')} · ${t('app.name')}`,
  robots: { index: false, follow: false },
};

/**
 * Claim a lab (board H4), for any signed-in user who is not platform staff: the certificate number
 * form, the claims this browser knows, and the labs the user already belongs to (what an approved
 * claim becomes). A signed-out visitor gets the sign-in panel of board G3, which returns here.
 */
export default async function ClaimPage() {
  const access = await gate();
  if (!access.ok) return access.panel;
  const { user } = access;
  const jar = await loadJar(user.id);
  const labs = labMemberships(user);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 py-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-text">{t('claim.title')}</h1>
        <p className="text-text-muted">{t('claim.intro')}</p>
      </div>
      {labs.length > 0 && (
        <section aria-labelledby="your-labs" className="flex flex-col gap-2">
          <h2 id="your-labs" className="text-lg font-semibold">
            {t('claim.yourLabs')}
          </h2>
          <ul className="flex flex-col gap-2">
            {labs.map((lab) => (
              <li key={lab.organisation}>
                <Alert tone="success" title={lab.organisation}>
                  {t('claim.memberOf', { role: lab.roles.map(roleLabel).join(', ') })}
                </Alert>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Card className="p-5">
        {isPlatformStaff(user) ? (
          <Alert tone="warning" title={t('claim.staffTitle')}>
            {t('claim.staff')}
          </Alert>
        ) : (
          <div className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{t('claim.findTitle')}</h2>
            <StartClaimForm text={messages.claim} initialKey={randomUUID()} />
          </div>
        )}
      </Card>
      <section aria-labelledby="your-claims" className="flex flex-col gap-2">
        <h2 id="your-claims" className="text-lg font-semibold">
          {t('claim.yourClaims')}
        </h2>
        {jar.claims.length === 0 ? (
          <p className="text-text-muted">{t('claim.noClaims')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {jar.claims.map((claim) => (
              <li key={claim.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Link href={`/lab/claim/${claim.id}`} className="font-medium">
                      {claim.siteName}
                    </Link>
                    <p className="text-sm text-text-muted">
                      {t('claim.certificate', { number: claim.certificateNo })} ·{' '}
                      {formatDateTime(claim.createdAt)}
                    </p>
                  </div>
                  <ClaimStatusBadge status={claim.status} />
                </Card>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-text-muted">{t('claim.knownHere')}</p>
      </section>
    </div>
  );
}
