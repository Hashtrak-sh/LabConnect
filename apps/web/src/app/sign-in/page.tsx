import { Card } from '@labconnect/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/features/auth/current-user';
import { SignInFlow, type SignInText } from '@/features/auth/SignInFlow';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: `${t('auth.title')} · ${t('app.name')}` };

/** Sign in (board G1): email, the emailed code, and the authenticator step when the role needs it. */
export default async function SignInPage() {
  if ((await currentUser()) !== null) redirect('/');
  const keys = [
    'emailLabel',
    'emailHelp',
    'sendCode',
    'sending',
    'newHere',
    'codeSent',
    'codeLabel',
    'codeHelp',
    'verify',
    'verifying',
    'resendIn',
    'resend',
    'sendNew',
    'otherEmail',
    'codeInvalid',
    'codeExpired',
    'lockedTitle',
    'locked',
    'lockedNoTime',
    'rateLimitedTitle',
    'rateLimited',
    'rateLimitedNoTime',
    'emailInvalid',
    'failed',
    'mfaTitle',
    'mfaIntro',
    'mfaLabel',
    'mfaHelp',
    'mfaSubmit',
    'mfaInvalid',
    'mfaLockedTitle',
    'mfaLocked',
    'mfaLockedNoTime',
    'enrolTitle',
    'enrolText',
  ] as const;
  const text = Object.fromEntries(keys.map((key) => [key, t(`auth.${key}`)])) as SignInText;
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-6">
      <h1 className="text-2xl font-bold text-text">{t('auth.title')}</h1>
      <p className="text-text-muted">{t('auth.intro')}</p>
      <Card className="p-5">
        <SignInFlow text={text} />
      </Card>
    </div>
  );
}
