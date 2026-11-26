import { Button, Card } from '@labconnect/ui';
import { Search } from 'lucide-react';
import { SearchText, SearchWhere } from '@/features/discovery/search-form';
import { readSearchLocation } from '@/features/discovery/search-location-cookie';
import { readSearchForm } from '@/features/discovery/search-params';
import { t } from '@/lib/i18n';

/**
 * Home and test search (board H1, approved in pass 2): the heading, a short intro (without the
 * "compare" wording, DP2-21), and the search card: test, where the sample is, radius. The form
 * submits to /search; the location travels in a cookie, never in the URL.
 */
export default async function HomePage() {
  const point = await readSearchLocation();
  const form = readSearchForm({});
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-6 md:py-12">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold text-text">{t('home.title')}</h1>
        <p className="text-lg text-text-muted">{t('home.intro')}</p>
      </div>
      <Card className="p-5 md:p-6">
        <form action="/search" method="get" role="search" className="flex flex-col gap-5">
          <SearchText form={form} />
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 text-sm font-medium text-text">{t('home.whereLabel')}</legend>
            <div className="grid gap-4 md:grid-cols-3 md:items-start">
              <SearchWhere form={form} located={point !== null} />
            </div>
          </fieldset>
          <Button type="submit" size="lg" className="self-start">
            <Search aria-hidden="true" className="size-4" />
            {t('home.submit')}
          </Button>
        </form>
      </Card>
      <p className="text-sm text-text-muted">{t('home.calibrationNote')}</p>
    </div>
  );
}
