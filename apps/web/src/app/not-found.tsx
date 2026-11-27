import { Button, StatePanel } from '@labconnect/ui';
import Link from 'next/link';
import { t } from '@/lib/i18n';

/** A lab that is not listed, or any unknown page. */
export default function NotFound() {
  return (
    <StatePanel
      kind="empty"
      title={t('lab.notFound')}
      action={
        <Button asChild>
          <Link href="/search">{t('app.navFindLab')}</Link>
        </Button>
      }
    />
  );
}
