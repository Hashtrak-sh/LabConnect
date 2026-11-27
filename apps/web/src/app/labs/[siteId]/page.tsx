import type { components } from '@labconnect/api-contract';
import {
  ACCREDITATION_STATUS_STYLES,
  Alert,
  Badge,
  Button,
  Card,
  Field,
  fieldProps,
  formatDate,
  formatDateTime,
  formatMoney,
  Input,
  LISTING_STATUS_STYLES,
  MapView,
  StatusBadge,
} from '@labconnect/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api } from '@/lib/api';
import { formatClock, istClock, istDate, istWeekday } from '@/lib/format';
import { type MessageKey, t } from '@/lib/i18n';
import { mapTileUrl } from '@/lib/map-config';

type PublicLabSite = components['schemas']['PublicLabSite'];
type PublicScopeLine = components['schemas']['PublicScopeLine'];
type PublicPriceItem = components['schemas']['PublicPriceItem'];

const PAGE_SIZE = 50;

interface Props {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

/**
 * The profile, or `null` when the API says it is not a listed lab (404, or 422 for an id that is
 * not a UUID). Any other failure is thrown, so error.tsx shows instead of a false "not found".
 */
async function loadSite(siteId: string): Promise<PublicLabSite | null> {
  const { data, response } = await api().GET('/public/lab-sites/{siteId}', {
    params: { path: { siteId } },
  });
  if (data) return data;
  if (response.status === 404 || response.status === 422) return null;
  throw new Error(`The lab page could not be loaded (status ${String(response.status)}).`);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const site = await loadSite((await params).siteId).catch(() => null);
  return { title: `${site?.name ?? t('lab.notFound')} · ${t('app.name')}` };
}

function methodOf(line: PublicScopeLine): string {
  const method = line.method?.name ?? line.methodText;
  return method === null ? line.parameter.name : `${line.parameter.name} · ${method}`;
}

/** "Receiving today until 5:00 PM IST (cut-off 4:00 PM IST)" (B2), from today's open window. */
function receivingToday(site: PublicLabSite, now: Date): string {
  const today = istWeekday(now);
  const clock = istClock(now);
  const open = site.receivingHours.find((w) => w.weekday === today && w.closesAt > clock);
  if (open === undefined) return t('lab.closedToday');
  return open.cutoffAt === null
    ? t('lab.receivingTodayNoCutoff', { time: formatClock(open.closesAt) })
    : t('lab.receivingToday', {
        time: formatClock(open.closesAt),
        cutoff: formatClock(open.cutoffAt),
      });
}

/**
 * Lab site page (board B2 at 1280 and 360, with B4's listed and calibration states): name,
 * address, listing badge, rating, today's receiving hours and the next slot; the accreditation
 * card with the verification link; then scope and prices (search inside the scope), sample
 * requirements, receiving hours, location and ratings. Booking itself (the "Your selection"
 * panel) comes with I3; a listed lab offers "Request this lab" instead.
 */
export default async function LabPage({ params, searchParams }: Props) {
  const { siteId } = await params;
  const raw = await searchParams;
  const site = await loadSite(siteId);
  if (site === null) notFound();

  const q = single(raw.q).slice(0, 200);
  const cursor = single(raw.cursor);
  const now = new Date();
  const calibration =
    site.accreditations.length > 0 &&
    site.accreditations.every((accreditation) => accreditation.labCategory === 'CALIBRATION');
  const bookable = site.listingStatus === 'BOOKABLE' && !calibration;
  const client = api();

  // Bookable: the effective price list (FR-DIS-06). Otherwise: the accredited scope only.
  const prices = bookable
    ? await client
        .GET('/public/lab-sites/{siteId}/prices', {
          params: {
            path: { siteId },
            query: { limit: PAGE_SIZE, ...(cursor === '' ? {} : { cursor }) },
          },
        })
        .then(({ data }) => data ?? null)
    : null;
  const scope =
    prices === null
      ? await client
          .GET('/public/lab-sites/{siteId}/scope', {
            params: {
              path: { siteId },
              query: {
                limit: PAGE_SIZE,
                ...(q === '' ? {} : { q }),
                ...(cursor === '' ? {} : { cursor }),
              },
            },
          })
          .then(({ data }) => data ?? null)
      : null;
  const nextSlot = bookable
    ? await client
        .GET('/public/lab-sites/{siteId}/slots', {
          params: {
            path: { siteId },
            query: { from: istDate(now), to: istDate(now, 14), limit: 1 },
          },
        })
        .then(({ data }) => data?.data[0] ?? null)
    : null;

  const priceItems: PublicPriceItem[] = (prices?.data ?? []).filter((item) => {
    if (q === '') return true;
    return methodOf(item.scopeLine).toLowerCase().includes(q.toLowerCase());
  });
  const gstRates = [...new Set(priceItems.map((item) => item.gstRateBp))];
  const requirements = [
    ...new Set(
      priceItems
        .map((item) => item.packagingInstructions)
        .filter((text): text is string => text !== null),
    ),
  ];
  const nextCursor = prices?.page.nextCursor ?? scope?.page.nextCursor ?? null;
  const location = site.location;

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t('lab.breadcrumb')} className="text-sm text-text-muted">
        <Link href="/search">{t('lab.backToResults')}</Link> <span aria-hidden="true">›</span>{' '}
        <span aria-current="page">{site.name}</span>
      </nav>

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-text md:text-3xl">{site.name}</h1>
          {calibration ? (
            <Badge tone="info" icon="clock">
              {t('lab.calibrationBadge')}
            </Badge>
          ) : (
            <StatusBadge
              status={LISTING_STATUS_STYLES[site.listingStatus]}
              label={bookable ? t('lab.bookableBadge') : t('lab.listedBadge')}
            />
          )}
        </div>
        <p className="text-text-muted">
          {[site.address.line1, site.address.line2, site.address.city, site.address.district]
            .filter((part) => part !== null && part !== '')
            .join(', ')}
          , {site.address.stateCode} {site.address.pincode} ·{' '}
          {t('lab.siteCode', { code: site.siteCode })}
        </p>
        <p className="text-sm text-text">
          {site.rating.average === null
            ? t('lab.noRating')
            : t('lab.ratingLong', {
                average: site.rating.average.toFixed(1),
                count: site.rating.count,
              })}
          {' · '}
          {receivingToday(site, now)}
          {nextSlot !== null &&
            ` · ${t('lab.nextSlot', { when: formatDateTime(nextSlot.startsAt) })}`}
        </p>
      </header>

      {!bookable && (
        <Alert
          tone="neutral"
          title={calibration ? t('lab.calibrationBadge') : t('lab.listedBadge')}
        >
          <p>{calibration ? t('lab.calibrationText') : t('lab.listedText')}</p>
          {!calibration && (
            <Button asChild className="mt-2 self-start">
              <Link href={`/request-a-lab?lab=${site.id}`}>{t('search.requestLab')}</Link>
            </Button>
          )}
        </Alert>
      )}
      {bookable && <Alert tone="info">{t('lab.bookingSoon')}</Alert>}

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-lg font-semibold">{t('lab.accreditation')}</h2>
        {site.accreditations.map((accreditation) => (
          <dl
            key={accreditation.certificateNo}
            className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-4"
          >
            <div>
              <dt className="text-text-muted">{t('lab.certificate')}</dt>
              <dd className="font-semibold tabular-nums">{accreditation.certificateNo}</dd>
            </div>
            <div>
              <dt className="text-text-muted">{t('lab.standard')}</dt>
              <dd>{accreditation.standard.name}</dd>
            </div>
            <div>
              <dt className="text-text-muted">{t('lab.validUntil')}</dt>
              <dd>{formatDate(accreditation.validTo)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">{t('lab.status')}</dt>
              <dd>
                <StatusBadge
                  status={ACCREDITATION_STATUS_STYLES[accreditation.status]}
                  label={t('lab.statusValid')}
                />
              </dd>
            </div>
            <p className="text-text-muted sm:col-span-4">
              {t('lab.statusChecked', { date: formatDate(accreditation.statusAsOf) })}{' '}
              {accreditation.verificationUrl !== null && (
                <a href={accreditation.verificationUrl} target="_blank" rel="noreferrer">
                  {t('lab.verify')}
                </a>
              )}
            </p>
          </dl>
        ))}
      </Card>

      <nav aria-label={t('lab.sections')} className="flex flex-wrap gap-1 border-b border-border">
        {(
          [
            ['scope', bookable ? 'lab.sectionScope' : 'lab.sectionScopeOnly'],
            ...(bookable ? [['requirements', 'lab.sectionRequirements']] : []),
            ['hours', 'lab.sectionHours'],
            ['location', 'lab.sectionLocation'],
            ['ratings', 'lab.sectionRatings'],
          ] as [string, MessageKey][]
        ).map(([id, key]) => (
          <a
            key={id}
            href={`#${id}`}
            className="inline-flex min-h-11 items-center px-3.5 text-sm font-medium text-text-muted no-underline hover:text-brand-on-tint"
          >
            {t(key)}
          </a>
        ))}
      </nav>

      <section id="scope" aria-labelledby="scope-title" className="flex scroll-mt-4 flex-col gap-4">
        <h2 id="scope-title" className="text-xl font-semibold">
          {bookable ? t('lab.sectionScope') : t('lab.sectionScopeOnly')}
        </h2>
        <form
          action={`/labs/${site.id}`}
          method="get"
          role="search"
          className="flex flex-wrap items-end gap-3"
        >
          <Field id="scope-q" label={t('lab.scopeSearchLabel')} className="min-w-64 flex-1">
            <Input {...fieldProps('scope-q')} name="q" defaultValue={q} maxLength={200} />
          </Field>
          <Button type="submit" variant="secondary">
            {t('lab.scopeSearchSubmit')}
          </Button>
        </form>
        {prices !== null && (
          <p className="text-sm text-text-muted">
            {t('lab.priceListNote', {
              version: prices.priceList.versionNo,
              date: formatDate(istDate(new Date(prices.priceList.effectiveFrom))),
            })}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t('lab.scopeCaption')}</caption>
            <thead>
              <tr className="bg-surface text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                <th scope="col" className="border-b border-border px-3 py-2.5">
                  {t('lab.colTest')}
                </th>
                <th scope="col" className="border-b border-border px-3 py-2.5">
                  {t('lab.colRange')}
                </th>
                {prices !== null && (
                  <>
                    <th scope="col" className="border-b border-border px-3 py-2.5">
                      {t('lab.colSample')}
                    </th>
                    <th scope="col" className="border-b border-border px-3 py-2.5 text-right">
                      {t('lab.colPrice')}
                    </th>
                    <th scope="col" className="border-b border-border px-3 py-2.5 text-right">
                      {t('lab.colTat')}
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {prices !== null
                ? priceItems.map((item) => (
                    <tr key={item.scopeLine.id} className="border-b border-border">
                      <th scope="row" className="px-3 py-3 text-left font-medium">
                        {methodOf(item.scopeLine)}
                        <span className="block text-xs font-normal text-text-muted">
                          {[item.scopeLine.discipline.name, item.scopeLine.product?.name]
                            .filter(Boolean)
                            .join(' › ')}
                        </span>
                      </th>
                      <td className="px-3 py-3">{item.scopeLine.rangeText ?? '—'}</td>
                      <td className="px-3 py-3">
                        {item.sampleQty} {item.sampleUnit.name}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {item.isAvailable && !item.scopeLine.temporarilyUnavailable ? (
                          formatMoney(item.price)
                        ) : (
                          <Badge tone="warning" icon="alert">
                            {t('lab.unavailable')}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {t('lab.tatDays', { days: item.tatDays })}
                      </td>
                    </tr>
                  ))
                : (scope?.data ?? []).map((line) => (
                    <tr key={line.id} className="border-b border-border">
                      <th scope="row" className="px-3 py-3 text-left font-medium">
                        {methodOf(line)}
                        <span className="block text-xs font-normal text-text-muted">
                          {[line.discipline.name, line.product?.name].filter(Boolean).join(' › ')}
                        </span>
                        {line.temporarilyUnavailable && (
                          <Badge tone="warning" icon="alert" className="mt-1">
                            {t('lab.unavailable')}
                          </Badge>
                        )}
                      </th>
                      <td className="px-3 py-3">{line.rangeText ?? '—'}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {(prices !== null ? priceItems.length : (scope?.data.length ?? 0)) === 0 && (
          <p className="text-text-muted">{t('lab.scopeEmpty')}</p>
        )}
        {prices !== null && gstRates.length === 1 && gstRates[0] !== undefined && (
          <p className="text-sm text-text-muted">
            {t('lab.gstNote', { rate: (gstRates[0] / 100).toFixed(0) })}
          </p>
        )}
        {nextCursor !== null && (
          <Button asChild variant="secondary" className="self-start">
            <Link
              href={`/labs/${site.id}?${new URLSearchParams({ ...(q === '' ? {} : { q }), cursor: nextCursor }).toString()}#scope`}
            >
              {t('lab.more')}
            </Link>
          </Button>
        )}
      </section>

      {bookable && (
        <section
          id="requirements"
          aria-labelledby="requirements-title"
          className="flex scroll-mt-4 flex-col gap-2"
        >
          <h2 id="requirements-title" className="text-xl font-semibold">
            {t('lab.sectionRequirements')}
          </h2>
          {requirements.length === 0 ? (
            <p className="text-text-muted">{t('lab.requirementsNone')}</p>
          ) : (
            <ul className="list-disc pl-5">
              {requirements.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section id="hours" aria-labelledby="hours-title" className="flex scroll-mt-4 flex-col gap-2">
        <h2 id="hours-title" className="text-xl font-semibold">
          {t('lab.sectionHours')}
        </h2>
        <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-1">
          {[1, 2, 3, 4, 5, 6, 7].map((weekday) => {
            const windows = site.receivingHours.filter((w) => w.weekday === weekday);
            return (
              <div key={weekday} className="contents">
                <dt className="font-medium">{t(`lab.weekday${String(weekday)}` as MessageKey)}</dt>
                <dd>
                  {windows.length === 0
                    ? t('lab.hoursClosed')
                    : windows
                        .map(
                          (w) =>
                            `${formatClock(w.opensAt)} – ${formatClock(w.closesAt)}${
                              w.cutoffAt === null
                                ? ''
                                : ` · ${t('lab.hoursCutoff', { time: formatClock(w.cutoffAt) })}`
                            }`,
                        )
                        .join(', ')}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section
        id="location"
        aria-labelledby="location-title"
        className="flex scroll-mt-4 flex-col gap-2"
      >
        <h2 id="location-title" className="text-xl font-semibold">
          {t('lab.sectionLocation')}
        </h2>
        {location === null ? (
          <p className="text-text-muted">{t('lab.noPin')}</p>
        ) : (
          <>
            <MapView
              className="h-72 max-w-2xl"
              points={[
                {
                  id: site.id,
                  lat: location.lat,
                  lng: location.lng,
                  label: site.name,
                  kind: bookable ? 'bookable' : 'listed',
                },
              ]}
              tileUrl={mapTileUrl()}
              attribution={t('search.mapAttribution')}
              label={t('lab.sectionLocation')}
              unavailableText={t('search.mapUnavailable')}
            />
            <Button asChild variant="secondary" className="self-start">
              <a
                href={`https://www.openstreetmap.org/?mlat=${String(location.lat)}&mlon=${String(location.lng)}#map=16/${String(location.lat)}/${String(location.lng)}`}
                target="_blank"
                rel="noreferrer"
              >
                {t('lab.openInMaps')}
              </a>
            </Button>
          </>
        )}
      </section>

      <section
        id="ratings"
        aria-labelledby="ratings-title"
        className="flex scroll-mt-4 flex-col gap-1"
      >
        <h2 id="ratings-title" className="text-xl font-semibold">
          {t('lab.sectionRatings')}
        </h2>
        {site.rating.average === null ? (
          <p className="text-text-muted">{t('lab.noRating')}</p>
        ) : (
          <p>
            <span className="text-2xl font-semibold tabular-nums">
              {site.rating.average.toFixed(1)}
            </span>{' '}
            ★{' '}
            <span className="text-text-muted">
              {t('lab.ratingsCount', { count: site.rating.count })}
            </span>
          </p>
        )}
      </section>
    </div>
  );
}
