import Link from 'next/link';
import { t } from '@/lib/i18n';
import { loadAccess } from './access';
import { CLAIM_REVIEW_ROLES, hasAnyRole, isPlatformStaff } from './roles';

const LINK =
  'rounded-md px-3 py-2 text-sm font-medium text-text-subtle no-underline hover:bg-brand-tint hover:text-brand-on-tint max-md:min-h-11 max-md:content-center';

/**
 * The header links to the claim screens, each shown only to who may use it: "Claim your lab" to a
 * signed-in user who is not platform staff, "Claim requests" to Platform Ops. A signed-out
 * visitor, or a user the API could not be asked about, sees neither. The pages check the role
 * again; this only keeps the header from offering what would be refused.
 */
export async function AccessNav() {
  const access = await loadAccess();
  if (access.kind !== 'ok') return null;
  return (
    <>
      {!isPlatformStaff(access.user) && (
        <Link href="/lab/claim" className={LINK}>
          {t('access.navClaim')}
        </Link>
      )}
      {hasAnyRole(access.user, CLAIM_REVIEW_ROLES) && (
        <Link href="/admin/claims" className={LINK}>
          {t('access.navClaims')}
        </Link>
      )}
    </>
  );
}
