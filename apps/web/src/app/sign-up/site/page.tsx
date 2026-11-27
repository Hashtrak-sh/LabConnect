import { randomUUID } from 'node:crypto';
import { Card } from '@labconnect/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import messages from '../../../../messages/en.json';
import { currentUser } from '@/features/auth/current-user';
import { SiteForm } from '@/features/signup/SiteForm';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: `${t('signUp.siteTitle')} · ${t('app.name')}` };

/**
 * Board J1 step 5. Only for a signed-in user whose active organisation is a customer one, right
 * after sign-up; anyone else goes back to /sign-up, which says what applies to them.
 */
export default async function SignUpSitePage() {
  const user = await currentUser();
  // The active one: the API acts for the active membership, so any other would only get a 403.
  if (user?.activeOrgType !== 'CUSTOMER') {
    redirect('/sign-up');
  }
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-6">
      <h1 className="text-2xl font-bold text-text">{t('signUp.title')}</h1>
      <Card className="p-5">
        <SiteForm text={messages.signUp} idempotencyKey={randomUUID()} />
      </Card>
    </div>
  );
}
