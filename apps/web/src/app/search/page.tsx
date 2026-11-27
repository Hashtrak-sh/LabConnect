import { Button, StatePanel } from '@labconnect/ui';
import type { Metadata } from 'next';
import { FiltersSheet } from '@/features/discovery/FiltersSheet';
import { ResultsView } from '@/features/discovery/ResultsView';
import { toResultCard } from '@/features/discovery/result-model';
import {
  type Discipline,
  SearchFilters,
  SearchText,
  SearchWhere,
} from '@/features/discovery/search-form';
import { readSearchLocation } from '@/features/discovery/search-location-cookie';
import {
  hasCriteria,
  pageHref,
  RADII,
  readSearchForm,
  type SearchForm,
  toSearchLabsParams,
} from '@/features/discovery/search-params';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { mapTileUrl } from '@/lib/map-config';

export const metadata: Metadata = { title: `${t('search.titleAll')} · ${t('app.name')}` };

const PAGE_SIZE = 20;

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** A search URL with some form values changed (no location: it lives in a cookie). */
function searchHref(form: SearchForm, changes: Partial<SearchForm>): string {
  return pageHref({ ...form, ...changes }, null);
}

/** "Request a lab" after no results: the search, never the location (H3 entry from no results). */
function requestHref(form: SearchForm, labId?: string): string {
  const query = new URLSearchParams();
  for (const name of Object.keys(form) as (keyof SearchForm)[]) {
    if (form[name] !== '') query.set(name, form[name]);
  }
  if (labId !== undefined) query.set('lab', labId);
  return `/request-a-lab?${query.toString()}`;
}

/**
 * Search results (boards B1 at 1280, H2 below 1024, B4 states). The search bar keeps the query;
 * filters are inline on wide screens and in a sheet below; results show as a list with a map
 * beside it (or a List/Map toggle). The order is the API's: by distance with a location, otherwise
 * by relevance (no sort control, OQ-151). States: loading (loading.tsx), no results with the
 * actions of B4, error with "Try again".
 */
export default async function SearchPage({ searchParams }: Props) {
  const raw = await searchParams;
  const form = readSearchForm(raw);
  const cursor = typeof raw.cursor === 'string' ? raw.cursor : '';
  const point = await readSearchLocation();
  const client = api();

  const disciplines: Discipline[] = await client
    .GET('/public/taxonomies/{code}/nodes', {
      params: { path: { code: 'SCOPE' }, query: { limit: 100 } },
    })
    .then(({ data }) => data?.data ?? [])
    .catch(() => []);

  const query = toSearchLabsParams(form, point, cursor, PAGE_SIZE);
  const searched = hasCriteria(form, point);
  const result = searched
    ? await client.GET('/public/search/labs', { params: { query } }).catch(() => null)
    : null;
  const page = result?.data ?? null;
  const failed = searched && page === null;
  const cards = page?.data.map(toResultCard) ?? [];

  const title = form.q === '' ? t('search.titleAll') : t('search.titleWithText', { text: form.q });
  const keep = (
    <>
      {form.q !== '' && <input type="hidden" name="q" value={form.q} />}
      {form.radius !== '' && <input type="hidden" name="radius" value={form.radius} />}
    </>
  );
  const nextRadius = RADII.find((km) => km > Number(form.radius || 0));

  return (
    <div className="flex flex-col gap-6">
      <form
        action="/search"
        method="get"
        role="search"
        className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4"
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:items-end">
          <SearchText form={form} />
          <div className="flex flex-wrap items-end gap-3">
            <Button type="submit">{t('search.submit')}</Button>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3 md:items-start">
          <SearchWhere form={form} located={point !== null} />
        </div>
        <div className="hidden gap-4 lg:grid lg:grid-cols-4">
          <SearchFilters form={form} disciplines={disciplines} idPrefix="filters-inline" />
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-text">{title}</h1>
        <FiltersSheet
          labels={{
            open: t('search.filters'),
            title: t('search.filters'),
            close: t('app.close'),
            apply: t('search.applyFilters'),
            clear: t('search.clearFilters'),
          }}
          clearHref={searchHref(form, { discipline: '', category: '', tat: '', maxPrice: '' })}
          keep={keep}
        >
          <SearchFilters form={form} disciplines={disciplines} idPrefix="filters-sheet" />
        </FiltersSheet>
      </div>

      {failed && (
        <StatePanel
          kind="error"
          title={t('search.errorTitle')}
          action={
            <Button asChild variant="secondary">
              <a href={pageHref(form, cursor === '' ? null : cursor)}>{t('search.tryAgain')}</a>
            </Button>
          }
        >
          {t('search.errorText')}
        </StatePanel>
      )}

      {page !== null && cards.length === 0 && (
        <StatePanel
          kind="empty"
          title={t('search.noResultsTitle')}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {point !== null && form.radius !== '' && nextRadius !== undefined && (
                <Button asChild variant="secondary">
                  <a href={searchHref(form, { radius: String(nextRadius) })}>
                    {t('search.widen', { km: nextRadius })}
                  </a>
                </Button>
              )}
              <Button asChild>
                <a href={requestHref(form)}>{t('search.requestALab')}</a>
              </Button>
            </div>
          }
        >
          {t('search.noResultsText')}
        </StatePanel>
      )}

      {cards.length > 0 && page !== null && (
        <section aria-labelledby="results-count" className="flex flex-col gap-4">
          <p id="results-count" role="status" className="text-sm text-text-muted">
            {point !== null
              ? t('search.countDistance', { count: cards.length })
              : t('search.countRelevance', { count: cards.length })}
          </p>
          <ResultsView
            results={cards}
            tileUrl={mapTileUrl()}
            requestHrefs={Object.fromEntries(
              cards
                .filter((card) => card.state === 'listed')
                .map((card) => [card.id, requestHref(form, card.id)]),
            )}
            labels={{
              list: t('search.list'),
              map: t('search.map'),
              viewToggle: t('search.viewToggle'),
              mapLabel: t('search.mapLabel'),
              mapUnavailable: t('search.mapUnavailable'),
              mapAttribution: t('search.mapAttribution'),
              legendBookable: t('search.legendBookable'),
              legendListed: t('search.legendListed'),
              matchedHeading: t('search.matchedHeading'),
              moreMatched: t('search.moreMatched'),
              bookable: t('search.bookable'),
              listed: t('search.listed'),
              calibration: t('search.calibration'),
              accredited: t('search.accredited'),
              plusGst: t('search.plusGst'),
              listedNote: t('search.listedNote'),
              viewLab: t('search.viewLab'),
              requestLab: t('search.requestLab'),
            }}
          />
          <div className="flex flex-wrap gap-2">
            {cursor !== '' && (
              <Button asChild variant="secondary">
                <a href={pageHref(form, null)}>{t('search.firstPage')}</a>
              </Button>
            )}
            {page.page.nextCursor !== null && (
              <Button asChild>
                <a href={pageHref(form, page.page.nextCursor)}>{t('search.nextPage')}</a>
              </Button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
