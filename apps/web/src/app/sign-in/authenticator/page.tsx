import { randomUUID } from 'node:crypto';
import { Card } from '@labconnect/ui';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import messages from '../../../../messages/en.json';
import { EnrolFlow } from '@/features/enrol/EnrolFlow';
import { t } from '@/lib/i18n';
import { MFA_COOKIE } from '@/lib/session';

export const metadata: Metadata = {
  title: `${t('enrol.title')} · ${t('app.name')}`,
  // The page is for one person at one moment; nothing here should be indexed or shared.
  robots: { index: false, follow: false },
};

/**
 * Authenticator enrolment (board G2). It is reached from the sign-in step that says the role needs
 * an authenticator, which has left the partial session in the `lc_mfa` cookie; without it the
 * person goes back to sign-in. Opening or reloading this page asks the API for nothing: the key is
 * made only when the person presses "Set up" (see `enrol-actions.ts`). Dynamic (it reads
 * cookies), so Next sends `Cache-Control: private, no-cache, no-store`.
 */
export default async function AuthenticatorPage() {
  if ((await cookies()).get(MFA_COOKIE) === undefined) redirect('/sign-in');
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-6">
      <h1 className="text-2xl font-bold text-text">{t('enrol.title')}</h1>
      <Card className="p-5">
        <EnrolFlow text={messages.enrol} initialKey={randomUUID()} />
      </Card>
    </div>
  );
}
