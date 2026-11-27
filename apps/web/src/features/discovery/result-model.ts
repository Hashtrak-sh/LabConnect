import type { components } from '@labconnect/api-contract';
import { formatDate, formatMoney } from '@labconnect/ui';
import { t } from '@/lib/i18n';
import { istDate } from '@/lib/format';

type LabSearchResult = components['schemas']['LabSearchResult'];

/** One search result, ready to render (serialisable: it crosses to the client list/map view). */
export interface ResultCardModel {
  id: string;
  name: string;
  href: string;
  /** `bookable`, `listed`, or `calibration` (calibration labs are listed, never bookable, CD-03). */
  state: 'bookable' | 'listed' | 'calibration';
  certificateNo: string | null;
  meta: string;
  matched: { id: string; name: string; detail?: string }[];
  matchedCount: number;
  priceFrom: string | null;
  tat: string | null;
  nextSlot: string | null;
  point: { lat: number; lng: number } | null;
}

/** The text of a matched test: parameter and the normalised method, as B1 writes it. */
function testName(line: LabSearchResult['matchedLines'][number]['scopeLine']): string {
  const method = line.method?.name ?? line.methodText;
  return method === null ? line.parameter.name : `${line.parameter.name} · ${method}`;
}

export function toResultCard(result: LabSearchResult): ResultCardModel {
  const site = result.labSite;
  const calibration =
    site.accreditations.length > 0 &&
    site.accreditations.every((accreditation) => accreditation.labCategory === 'CALIBRATION');
  const state = calibration
    ? 'calibration'
    : site.listingStatus === 'BOOKABLE'
      ? 'bookable'
      : 'listed';
  const meta = [
    `${site.city}, ${site.stateCode}`,
    result.distanceKm === null ? null : t('search.km', { km: result.distanceKm.toFixed(1) }),
    site.rating.average === null
      ? t('search.noRating')
      : t('search.rating', { average: site.rating.average.toFixed(1), count: site.rating.count }),
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const nextSlot =
    result.nextSlotAt === null
      ? null
      : formatDate(istDate(new Date(result.nextSlotAt)), { weekday: true });

  return {
    id: site.id,
    name: site.name,
    href: `/labs/${site.id}`,
    state,
    certificateNo: site.accreditations[0]?.certificateNo ?? null,
    meta,
    matched: result.matchedLines.map((line) => ({
      id: line.scopeLine.id,
      name: testName(line.scopeLine),
      ...(line.price === null
        ? {}
        : {
            detail: `${formatMoney(line.price)}${
              line.tatDays === null ? '' : ` · ${t('lab.tatDays', { days: line.tatDays })}`
            }`,
          }),
    })),
    matchedCount: result.matchedLineCount,
    priceFrom: result.priceFrom === null ? null : formatMoney(result.priceFrom),
    tat: result.minTatDays === null ? null : t('search.tatUpTo', { days: result.minTatDays }),
    nextSlot: nextSlot === null ? null : t('search.nextSlot', { date: nextSlot }),
    point: site.location,
  };
}
