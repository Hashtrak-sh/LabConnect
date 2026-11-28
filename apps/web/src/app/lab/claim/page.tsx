import { randomUUID } from 'node:crypto';
import { Alert, Card } from '@labconnect/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import messages from '../../../../messages/en.json';
import { gate, roleLabel } from '@/features/access/access';
import { isPlatformStaff, labMemberships } from '@/features/access/roles';
import { loadMyClaims } from '@/features/claim/claim-data';
import { ClaimList } from '@/features/claim/ClaimList';
import { hasLegacyClaimsCookie } from '@/features/claim/legacy-cookie';
import { StartClaimForm } from '@/features/claim/StartClaimForm';
import { t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: `${t('claim.title')} · ${t('app.name')}`,
  robots: { index: false, follow: false },
};

/** The API's cursor from the address: opaque, one value, never longer than a cursor can be. */
function readCursor(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value !== undefined && value !== '' && value.length <= 500 ? value : null;
}

/**
 * Claim a lab (board H4), for any signed-in user who is not platform staff: the certificate number
 * form, the claims the API lists for this person (`listMyLabClaims`, the same on every device),
 * and the labs the user already belongs to (what an approved claim becomes). Platform staff are
 * told they cannot claim and the claimant reads are not called for them (the API would answer
 * 403). A signed-out visitor gets the sign-in panel of board G3, which returns here.
 */
export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The claims record of the earlier build (a cookie) is deleted once; nothing reads it.
  if (await hasLegacyClaimsCookie()) redirect('/lab/claim/forget-old-copy');
  const access = await gate();
  if (!access.ok) return access.panel;
  const { user } = access;
  const cursor = readCursor((await searchParams).cursor);
  const staff = isPlatformStaff(user);
  const page = staff ? null : await loadMyClaims(access.token, cursor);
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
      {staff ? (
        <Card className="p-5">
          <Alert tone="warning" title={t('claim.staffTitle')}>
            {t('claim.staff')}
          </Alert>
        </Card>
      ) : (
        <>
          <Card className="p-5">
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">{t('claim.findTitle')}</h2>
              <StartClaimForm text={messages.claim} initialKey={randomUUID()} />
            </div>
          </Card>
          <section aria-labelledby="your-claims" className="flex flex-col gap-2">
            <h2 id="your-claims" className="text-lg font-semibold">
              {t('claim.yourClaims')}
            </h2>
            {page !== null && <ClaimList page={page} cursor={cursor} />}
          </section>
        </>
      )}
    </div>
  );
}
