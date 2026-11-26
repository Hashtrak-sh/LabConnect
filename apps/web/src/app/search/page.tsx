import type { components } from '@labconnect/api-contract';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LeadForm } from '@/features/discovery/LeadForm';
import { LocationPicker } from '@/features/discovery/LocationPicker';
import { SearchTextInput } from '@/features/discovery/SearchTextInput';
import {
  hasCriteria,
  leadCriteria,
  pageHref,
  RADII,
  readSearchForm,
  toSearchLabsParams,
} from '@/features/discovery/search-params';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { t } from '@/lib/i18n';

type LabSearchResult = components['schemas']['LabSearchResult'];

export const metadata: Metadata = { title: `${t('search.title')} · ${t('app.name')}` };

const PAGE_SIZE = 20;

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Lab search (I1-CUS-10, rough): filters, results with matched tests, paging, no-result lead. */
export default async function SearchPage({ searchParams }: Props) {
  const raw = await searchParams;
  const form = readSearchForm(raw);
  const cursor = typeof raw.cursor === 'string' ? raw.cursor : '';
  const client = api();

  const disciplines = await client
    .GET('/public/taxonomies/{code}/nodes', {
      params: { path: { code: 'SCOPE' }, query: { limit: 100 } },
    })
    .then(({ data }) => data?.data ?? [])
    .catch(() => []);

  const query = toSearchLabsParams(form, cursor, PAGE_SIZE);
  const searched = hasCriteria(form);
  const result = searched
    ? await client.GET('/public/search/labs', { params: { query } }).catch(() => null)
    : null;
  const page = result?.data ?? null;
  const failed = searched && page === null;

  const criteria = leadCriteria(query);

  return (
    <>
      <h1>{t('search.title')}</h1>
      <form className="card" action="/search" method="get" role="search">
        <div className="form-grid">
          <SearchTextInput
            name="q"
            label={t('search.textLabel')}
            placeholder={t('search.textPlaceholder')}
            defaultValue={form.q}
            listLabel={t('search.suggestionsLabel')}
            kindLabels={{
              PARAMETER: t('search.suggestionParameter'),
              PRODUCT: t('search.suggestionProduct'),
              METHOD: t('search.suggestionMethod'),
              LAB_SITE: t('search.suggestionLab'),
            }}
          />
          <div>
            <label htmlFor="discipline">{t('search.disciplineLabel')}</label>
            <select id="discipline" name="discipline" defaultValue={form.discipline}>
              <option value="">{t('search.anyDiscipline')}</option>
              {disciplines.map((node) => (
                <option key={node.code} value={node.code}>
                  {node.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="category">{t('search.categoryLabel')}</label>
            <select id="category" name="category" defaultValue={form.category}>
              <option value="">{t('search.anyCategory')}</option>
              <option value="TESTING">{t('search.categoryTesting')}</option>
              <option value="CALIBRATION">{t('search.categoryCalibration')}</option>
            </select>
          </div>
          <div>
            <label htmlFor="tat">{t('search.tatLabel')}</label>
            <input id="tat" name="tat" inputMode="numeric" defaultValue={form.tat} />
          </div>
          <div>
            <label htmlFor="maxPrice">{t('search.priceLabel')}</label>
            <input id="maxPrice" name="maxPrice" inputMode="decimal" defaultValue={form.maxPrice} />
          </div>
          <div>
            <label htmlFor="radius">{t('search.radiusLabel')}</label>
            <select id="radius" name="radius" defaultValue={form.radius}>
              <option value="">{t('search.anyDistance')}</option>
              {RADII.map((km) => (
                <option key={km} value={String(km)}>
                  {t('search.radiusKm', { km })}
                </option>
              ))}
            </select>
          </div>
          <LocationPicker
            defaultLat={form.lat}
            defaultLng={form.lng}
            labels={{
              use: t('search.useLocation'),
              set: t('search.locationSet'),
              clear: t('search.clearLocation'),
              denied: t('search.locationDenied'),
            }}
          />
          <div>
            <button type="submit">{t('search.submit')}</button>
          </div>
        </div>
      </form>

      {failed && (
        <p className="notice-error" role="alert">
          {t('search.error')}
        </p>
      )}

      {page !== null && page.data.length === 0 && cursor === '' && (
        <>
          <p role="status">
            <strong>{t('search.noResults')}</strong> {t('search.noResultsHint')}
          </p>
          <LeadForm
            kind="NO_RESULT"
            query={criteria}
            text={{
              title: t('lead.noResultTitle'),
              body: t('lead.noResultText'),
              email: t('lead.emailLabel'),
              emailHint: t('lead.emailHint'),
              submit: t('lead.submit'),
              sent: t('lead.sent'),
              failed: t('lead.failed'),
            }}
          />
        </>
      )}

      {page !== null && page.data.length > 0 && (
        <section aria-label={t('search.results', { count: page.data.length })}>
          <p className="muted" role="status">
            {t('search.results', { count: page.data.length })}
          </p>
          {page.data.map((item) => (
            <ResultCard key={item.labSite.id} item={item} />
          ))}
          <p>
            {cursor !== '' && (
              <Link className="button button-secondary" href={pageHref(form, null)}>
                {t('search.firstPage')}
              </Link>
            )}{' '}
            {page.page.nextCursor !== null && (
              <Link className="button" href={pageHref(form, page.page.nextCursor)}>
                {t('search.nextPage')}
              </Link>
            )}
          </p>
        </section>
      )}
    </>
  );
}

function ResultCard({ item }: { item: LabSearchResult }) {
  const site = item.labSite;
  const bookable = site.listingStatus === 'BOOKABLE' && item.priceFrom !== null;
  return (
    <article className="card">
      <div className="result-head">
        <h2 style={{ margin: 0, fontSize: 18 }}>
          <Link href={`/labs/${site.id}`}>{site.name}</Link>
        </h2>
        <span className={`badge ${bookable ? 'badge-success' : 'badge-warning'}`}>
          {bookable ? t('search.bookable') : t('search.notBookable')}
        </span>
      </div>
      <p className="muted">
        {site.city}, {site.stateCode} · {site.accreditations.map((a) => a.certificateNo).join(', ')}
      </p>
      <ul className="facts">
        {item.priceFrom !== null && (
          <li>{t('search.priceFrom', { price: formatMoney(item.priceFrom) })}</li>
        )}
        {item.minTatDays !== null && <li>{t('search.tat', { days: item.minTatDays })}</li>}
        {item.distanceKm !== null && (
          <li>{t('search.distance', { km: item.distanceKm.toFixed(1) })}</li>
        )}
        {item.nextSlotAt !== null && (
          <li>{t('search.nextSlot', { when: formatDateTime(item.nextSlotAt) })}</li>
        )}
        <li>
          {site.rating.average === null
            ? t('search.noRating')
            : t('search.rating', {
                average: site.rating.average.toFixed(1),
                count: site.rating.count,
              })}
        </li>
      </ul>
      {item.matchedLines.length > 0 && (
        <details>
          <summary>{t('search.matched', { count: item.matchedLineCount })}</summary>
          <ul>
            {item.matchedLines.map((line) => (
              <li key={line.scopeLine.id}>
                {line.scopeLine.parameter.name}
                {line.scopeLine.product !== null && ` · ${line.scopeLine.product.name}`}
                {line.price !== null && ` · ${formatMoney(line.price)}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
