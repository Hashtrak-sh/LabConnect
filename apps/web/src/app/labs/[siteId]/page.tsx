import type { components } from '@labconnect/api-contract';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LeadForm } from '@/features/discovery/LeadForm';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, formatTime, istDate } from '@/lib/format';
import { type MessageKey, t } from '@/lib/i18n';

type PublicLabSite = components['schemas']['PublicLabSite'];

const TABS = ['scope', 'prices', 'slots'] as const;
type Tab = (typeof TABS)[number];
const PAGE_SIZE = 50;
const SLOT_DAYS = 14;

interface Props {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

async function loadSite(siteId: string): Promise<PublicLabSite | null> {
  const { data } = await api().GET('/public/lab-sites/{siteId}', {
    params: { path: { siteId } },
  });
  return data ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const site = await loadSite((await params).siteId).catch(() => null);
  return { title: `${site?.name ?? t('lab.notFound')} · ${t('app.name')}` };
}

/** Lab site page (I1-CUS-10, rough): profile, then tests, prices and slots as tabs. */
export default async function LabPage({ params, searchParams }: Props) {
  const { siteId } = await params;
  const raw = await searchParams;
  const site = await loadSite(siteId).catch(() => null);
  if (site === null) notFound();

  const tabValue = single(raw.tab);
  const tab: Tab = (TABS as readonly string[]).includes(tabValue) ? (tabValue as Tab) : 'scope';
  const bookable = site.listingStatus === 'BOOKABLE';
  const href = (next: Record<string, string>): string =>
    `/labs/${site.id}?${new URLSearchParams(next).toString()}`;

  return (
    <>
      <p>
        <Link href="/search">{t('lab.backToSearch')}</Link>
      </p>
      <section className="card">
        <div className="result-head">
          <h1 style={{ margin: 0 }}>{site.name}</h1>
          <span className={`badge ${bookable ? 'badge-success' : 'badge-warning'}`}>
            {bookable ? t('search.bookable') : t('search.notBookable')}
          </span>
        </div>
        <p className="muted">
          {site.rating.average === null
            ? t('search.noRating')
            : t('search.rating', {
                average: site.rating.average.toFixed(1),
                count: site.rating.count,
              })}
        </p>
        <h2>{t('lab.accreditation')}</h2>
        <ul>
          {site.accreditations.map((a) => (
            <li key={a.certificateNo}>
              {t('lab.certificate', { number: a.certificateNo })} · {a.accreditationBody.name} ·{' '}
              {a.standard.name} · {t('lab.validUntil', { date: formatDate(a.validTo) })}
              {a.verificationUrl !== null && (
                <>
                  {' · '}
                  <a href={a.verificationUrl} target="_blank" rel="noreferrer">
                    {t('lab.verify')}
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
        <h2>{t('lab.address')}</h2>
        <p>
          {[site.address.line1, site.address.line2, site.address.city, site.address.district]
            .filter((part) => part !== null && part !== '')
            .join(', ')}{' '}
          {site.address.stateCode} {site.address.pincode}
          {site.location !== null && (
            <>
              {' · '}
              <a
                href={`https://www.openstreetmap.org/?mlat=${String(site.location.lat)}&mlon=${String(site.location.lng)}#map=16/${String(site.location.lat)}/${String(site.location.lng)}`}
                target="_blank"
                rel="noreferrer"
              >
                {t('lab.map')}
              </a>
            </>
          )}
        </p>
        <h2>{t('lab.hours')}</h2>
        <ul>
          {[1, 2, 3, 4, 5, 6, 7].map((weekday) => {
            const windows = site.receivingHours.filter((w) => w.weekday === weekday);
            return (
              <li key={weekday}>
                {t(`lab.weekday${String(weekday)}` as MessageKey)}:{' '}
                {windows.length === 0
                  ? t('lab.closed')
                  : windows
                      .map(
                        (w) =>
                          `${w.opensAt}–${w.closesAt}${w.cutoffAt === null ? '' : ` (${t('lab.cutoff', { time: w.cutoffAt })})`}`,
                      )
                      .join(', ')}
              </li>
            );
          })}
        </ul>
      </section>

      {!bookable && (
        <LeadForm
          kind="REQUEST_LAB"
          labSiteId={site.id}
          text={{
            title: t('lead.requestLabTitle'),
            body: t('lead.requestLabText'),
            email: t('lead.emailLabel'),
            emailHint: t('lead.emailHint'),
            submit: t('lead.submit'),
            sent: t('lead.sent'),
            failed: t('lead.failed'),
          }}
        />
      )}

      <nav className="tabs" aria-label={site.name}>
        {TABS.map((name) => (
          <Link
            key={name}
            className="button button-secondary"
            href={href({ tab: name })}
            aria-current={tab === name ? 'page' : undefined}
          >
            {t(
              name === 'scope'
                ? 'lab.tabScope'
                : name === 'prices'
                  ? 'lab.tabPrices'
                  : 'lab.tabSlots',
            )}
          </Link>
        ))}
      </nav>

      <section className="card">
        {tab === 'scope' && (
          <ScopeTab siteId={site.id} q={single(raw.q)} cursor={single(raw.cursor)} href={href} />
        )}
        {tab === 'prices' &&
          (bookable ? (
            <PricesTab siteId={site.id} cursor={single(raw.cursor)} href={href} />
          ) : (
            <p>{t('lab.pricesNotBookable')}</p>
          ))}
        {tab === 'slots' &&
          (bookable ? (
            <SlotsTab siteId={site.id} cursor={single(raw.cursor)} href={href} />
          ) : (
            <p>{t('lab.slotsNotBookable')}</p>
          ))}
      </section>
    </>
  );
}

type Href = (next: Record<string, string>) => string;

async function ScopeTab({
  siteId,
  q,
  cursor,
  href,
}: {
  siteId: string;
  q: string;
  cursor: string;
  href: Href;
}) {
  const { data } = await api().GET('/public/lab-sites/{siteId}/scope', {
    params: {
      path: { siteId },
      query: { limit: PAGE_SIZE, ...(q === '' ? {} : { q }), ...(cursor === '' ? {} : { cursor }) },
    },
  });
  const lines = data?.data ?? [];
  return (
    <>
      <form action={`/labs/${siteId}`} method="get" className="form-grid" role="search">
        <input type="hidden" name="tab" value="scope" />
        <div>
          <label htmlFor="scope-q">{t('lab.scopeSearch')}</label>
          <input id="scope-q" name="q" defaultValue={q} />
        </div>
        <div>
          <button type="submit">{t('search.submit')}</button>
        </div>
      </form>
      {lines.length === 0 ? (
        <p>{t('lab.scopeEmpty')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('lab.colTest')}</th>
                <th>{t('lab.colMethod')}</th>
                <th>{t('lab.colCertificate')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    {line.discipline.name} › {line.product?.name ?? line.group?.name ?? ''} ›{' '}
                    <strong>{line.parameter.name}</strong>
                    {line.rangeText !== null && <span className="muted"> ({line.rangeText})</span>}
                    {line.temporarilyUnavailable && (
                      <span className="badge badge-warning"> {t('lab.unavailable')}</span>
                    )}
                  </td>
                  <td>{line.method?.name ?? line.methodText ?? '—'}</td>
                  <td>{line.certificateNo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data?.page.nextCursor != null && (
        <p>
          <Link
            className="button button-secondary"
            href={href({ tab: 'scope', ...(q === '' ? {} : { q }), cursor: data.page.nextCursor })}
          >
            {t('lab.more')}
          </Link>
        </p>
      )}
    </>
  );
}

async function PricesTab({ siteId, cursor, href }: { siteId: string; cursor: string; href: Href }) {
  const { data } = await api().GET('/public/lab-sites/{siteId}/prices', {
    params: { path: { siteId }, query: { limit: PAGE_SIZE, ...(cursor === '' ? {} : { cursor }) } },
  });
  if (!data) return <p>{t('lab.pricesNotBookable')}</p>;
  return (
    <>
      <p className="muted">
        {t('lab.priceList', {
          version: data.priceList.versionNo,
          date: formatDateTime(data.priceList.effectiveFrom),
        })}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('lab.colTest')}</th>
              <th>{t('lab.colPrice')}</th>
              <th>{t('lab.colPrep')}</th>
              <th>{t('lab.colGst')}</th>
              <th>{t('lab.colSample')}</th>
              <th>{t('lab.colTat')}</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((item) => (
              <tr key={item.scopeLine.id}>
                <td>
                  <strong>{item.scopeLine.parameter.name}</strong>
                  {item.scopeLine.product !== null && (
                    <span className="muted"> · {item.scopeLine.product.name}</span>
                  )}
                  {!item.isAvailable && (
                    <span className="badge badge-warning"> {t('lab.itemUnavailable')}</span>
                  )}
                </td>
                <td>{formatMoney(item.price)}</td>
                <td>{formatMoney(item.samplePrep)}</td>
                <td>{(item.gstRateBp / 100).toFixed(2)}%</td>
                <td>
                  {item.sampleQty} {item.sampleUnit.name}
                  {item.packagingInstructions !== null && (
                    <span className="muted"> · {item.packagingInstructions}</span>
                  )}
                </td>
                <td>{t('search.tat', { days: item.tatDays })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.page.nextCursor !== null && (
        <p>
          <Link
            className="button button-secondary"
            href={href({ tab: 'prices', cursor: data.page.nextCursor })}
          >
            {t('lab.more')}
          </Link>
        </p>
      )}
    </>
  );
}

async function SlotsTab({ siteId, cursor, href }: { siteId: string; cursor: string; href: Href }) {
  const now = new Date();
  const from = istDate(now);
  const to = istDate(now, SLOT_DAYS);
  const { data } = await api().GET('/public/lab-sites/{siteId}/slots', {
    params: {
      path: { siteId },
      query: { from, to, limit: PAGE_SIZE, ...(cursor === '' ? {} : { cursor }) },
    },
  });
  const slots = data?.data ?? [];
  return (
    <>
      <p className="muted">{t('lab.slotsRange', { from: formatDate(from), to: formatDate(to) })}</p>
      {slots.length === 0 ? (
        <p>{t('lab.slotsEmpty')}</p>
      ) : (
        <ul>
          {slots.map((slot) => (
            <li key={slot.id}>
              {formatDate(slot.date)}, {formatTime(slot.startsAt)}–{formatTime(slot.endsAt)} ·{' '}
              {slot.discipline?.name ?? t('lab.allDisciplines')}
            </li>
          ))}
        </ul>
      )}
      {data?.page.nextCursor != null && (
        <p>
          <Link
            className="button button-secondary"
            href={href({ tab: 'slots', cursor: data.page.nextCursor })}
          >
            {t('lab.more')}
          </Link>
        </p>
      )}
    </>
  );
}
