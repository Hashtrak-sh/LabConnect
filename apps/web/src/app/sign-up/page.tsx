import { randomUUID } from 'node:crypto';
import { Alert, Button, Card } from '@labconnect/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import messages from '../../../messages/en.json';
import { currentUser } from '@/features/auth/current-user';
import { SignInFlow } from '@/features/auth/SignInFlow';
import { signInText } from '@/features/auth/sign-in-text';
import { SignUpForm, SignUpProgress } from '@/features/signup/SignUpForm';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: `${t('signUp.pageTitle')} · ${t('app.name')}` };

/**
 * Sign-up (board J1). Signed out: steps 1 and 2 are the sign-in code steps (G1), which create the
 * user and come back here. Signed in without a customer organisation: steps 3 and 4 and "Your
 * account is ready". A user who already has a customer organisation, and platform staff (RR-5),
 * are told so instead.
 */
export default async function SignUpPage() {
  const user = await currentUser();
  const text = messages.signUp;

  let body;
  if (user === null) {
    body = (
      <div className="flex flex-col gap-4">
        <SignUpProgress text={text} step={1} />
        <p className="text-text-muted">{t('signUp.emailIntro')}</p>
        <SignInFlow
          text={signInText()}
          next="/sign-up"
          footer={
            <p className="text-sm text-text-muted">
              {t('signUp.haveAccount')} <Link href="/sign-in">{t('auth.signIn')}</Link>
            </p>
          }
        />
      </div>
    );
  } else if (user.memberships.some((membership) => membership.orgType === 'PLATFORM')) {
    body = (
      <Alert tone="warning" title={t('signUp.staffTitle')}>
        {t('signUp.staffText')}
      </Alert>
    );
  } else {
    const customer = user.memberships.find((membership) => membership.orgType === 'CUSTOMER');
    body =
      customer === undefined ? (
        <SignUpForm text={text} idempotencyKey={randomUUID()} />
      ) : (
        <div className="flex flex-col gap-4">
          <Alert tone="info" title={t('signUp.alreadyTitle')}>
            {t('signUp.alreadyText', { organisation: customer.name })}
          </Alert>
          <Button asChild className="self-start">
            <Link href="/search">{t('signUp.findLab')}</Link>
          </Button>
        </div>
      );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-6">
      <h1 className="text-2xl font-bold text-text">{t('signUp.title')}</h1>
      <Card className="p-5">{body}</Card>
    </div>
  );
}
