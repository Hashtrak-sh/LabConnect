import { Button, Card } from '@labconnect/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: `${t('signUp.doneTitle')} · ${t('app.name')}` };

/** Board J1 "Done": the account is ready. */
export default function SignUpDonePage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-6">
      <Card className="flex flex-col gap-4 p-5">
        <h1 className="text-2xl font-bold text-text">{t('signUp.doneTitle')}</h1>
        <p className="text-text-muted">{t('signUp.doneText')}</p>
        <Button asChild className="self-start">
          <Link href="/search">{t('signUp.findLab')}</Link>
        </Button>
      </Card>
    </div>
  );
}
