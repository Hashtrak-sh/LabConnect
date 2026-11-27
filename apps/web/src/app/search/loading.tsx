import { Skeleton } from '@labconnect/ui';
import { t } from '@/lib/i18n';

/** "Finding accredited labs…" (B4 state 4, H2 loading): announced once, placeholders hidden. */
export default function SearchLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <p role="status" className="text-text-muted">
        {t('search.loading')}
      </p>
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-36 w-full" />
      ))}
    </div>
  );
}
