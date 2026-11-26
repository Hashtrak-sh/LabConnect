import { Card } from '@labconnect/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/features/auth/current-user';
import { SignInFlow } from '@/features/auth/SignInFlow';
import { signInText } from '@/features/auth/sign-in-text';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: `${t('auth.title')} · ${t('app.name')}` };

/** Sign in (board G1): email, the emailed code, and the authenticator step when the role needs it. */
export default async function SignInPage() {
  if ((await currentUser()) !== null) redirect('/');
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-6">
      <h1 className="text-2xl font-bold text-text">{t('auth.title')}</h1>
      <p className="text-text-muted">{t('auth.intro')}</p>
      <Card className="p-5">
        <SignInFlow
          text={signInText()}
          footer={
            <p className="text-sm text-text-muted">
              {t('auth.newHere')} <Link href="/sign-up">{t('auth.createAccount')}</Link>
            </p>
          }
        />
      </Card>
    </div>
  );
}
