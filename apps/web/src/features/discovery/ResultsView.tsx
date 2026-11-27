'use client';

import {
  Badge,
  Button,
  LabResultCard,
  LISTING_STATUS_STYLES,
  MapView,
  StatusBadge,
} from '@labconnect/ui';
import { useState } from 'react';
import type { ResultCardModel } from './result-model';

export interface ResultsLabels {
  list: string;
  map: string;
  viewToggle: string;
  mapLabel: string;
  mapUnavailable: string;
  mapAttribution: string;
  legendBookable: string;
  legendListed: string;
  matchedHeading: string;
  moreMatched: string;
  bookable: string;
  listed: string;
  calibration: string;
  accredited: string;
  plusGst: string;
  listedNote: string;
  viewLab: string;
  requestLab: string;
}

interface Props {
  results: readonly ResultCardModel[];
  labels: ResultsLabels;
  tileUrl: string;
  /** Link for "Request this lab", by lab id (carries the search text, never the location). */
  requestHrefs: Readonly<Record<string, string>>;
}

/**
 * The result list and the map (B1 at 1280: side by side; H2 below 1024: a List/Map toggle). The
 * list is the accessible way to every lab; the map adds place. Selecting a pin highlights its card.
 */
export function ResultsView({ results, labels, tileUrl, requestHrefs }: Props) {
  const [view, setView] = useState<'list' | 'map'>('list');
  const [selected, setSelected] = useState<string | null>(null);
  const points = results.flatMap((result) =>
    result.point === null
      ? []
      : [
          {
            id: result.id,
            lat: result.point.lat,
            lng: result.point.lng,
            label: result.name,
            kind: result.state === 'bookable' ? ('bookable' as const) : ('listed' as const),
          },
        ],
  );

  const toggle = (
    <div
      role="group"
      aria-label={labels.viewToggle}
      className="inline-flex overflow-hidden rounded-md border border-border-strong lg:hidden"
    >
      {(['list', 'map'] as const).map((name) => (
        <button
          key={name}
          type="button"
          aria-pressed={view === name}
          onClick={() => {
            setView(name);
          }}
          className="min-h-11 cursor-pointer px-4 text-sm font-medium text-text aria-pressed:bg-brand-primary aria-pressed:text-brand-primary-contrast"
        >
          {name === 'list' ? labels.list : labels.map}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {toggle}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <ol
          className={view === 'map' ? 'hidden lg:flex lg:flex-col lg:gap-4' : 'flex flex-col gap-4'}
        >
          {results.map((result) => (
            <li key={result.id} id={`lab-${result.id}`}>
              <LabResultCard
                name={result.name}
                href={result.href}
                selected={result.id === selected}
                badges={
                  <>
                    {result.certificateNo !== null && (
                      <Badge tone="success" icon="shield">
                        {labels.accredited.replace('{certificate}', result.certificateNo)}
                      </Badge>
                    )}
                    {result.state === 'bookable' && (
                      <StatusBadge
                        status={LISTING_STATUS_STYLES.BOOKABLE}
                        label={labels.bookable}
                      />
                    )}
                    {result.state === 'listed' && (
                      <StatusBadge status={LISTING_STATUS_STYLES.LISTED} label={labels.listed} />
                    )}
                    {result.state === 'calibration' && (
                      <Badge tone="info" icon="clock">
                        {labels.calibration}
                      </Badge>
                    )}
                  </>
                }
                meta={result.meta}
                matchedHeading={labels.matchedHeading}
                matched={result.matched}
                moreMatched={labels.moreMatched.replace('{count}', String(result.matchedCount - 3))}
                summary={
                  result.state === 'bookable' ? (
                    <div className="flex flex-col gap-1 text-sm">
                      {result.priceFrom !== null && (
                        <p className="text-xl font-semibold tabular-nums">
                          {result.priceFrom}{' '}
                          <span className="text-xs font-medium text-text-muted">
                            {labels.plusGst}
                          </span>
                        </p>
                      )}
                      {result.tat !== null && <p>{result.tat}</p>}
                      {result.nextSlot !== null && <p>{result.nextSlot}</p>}
                    </div>
                  ) : result.state === 'listed' ? (
                    <p className="text-sm text-text-muted">{labels.listedNote}</p>
                  ) : undefined
                }
                action={
                  result.state === 'listed' ? (
                    <Button asChild variant="secondary">
                      <a href={requestHrefs[result.id] ?? `/request-a-lab?lab=${result.id}`}>
                        {labels.requestLab}
                      </a>
                    </Button>
                  ) : (
                    <Button asChild variant={result.state === 'bookable' ? 'primary' : 'secondary'}>
                      <a href={result.href}>{labels.viewLab}</a>
                    </Button>
                  )
                }
              />
            </li>
          ))}
        </ol>
        <div
          className={view === 'map' ? 'flex flex-col gap-2' : 'hidden lg:flex lg:flex-col lg:gap-2'}
        >
          <MapView
            className="h-[60vh] lg:sticky lg:top-4 lg:h-[560px]"
            points={points}
            selectedId={selected}
            onSelect={(id) => {
              setSelected(id);
              document
                .getElementById(`lab-${id}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }}
            tileUrl={tileUrl}
            attribution={labels.mapAttribution}
            label={labels.mapLabel}
            unavailableText={labels.mapUnavailable}
          />
          <p className="flex flex-wrap gap-4 text-sm text-text-muted">
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block size-3 rounded-full border-2 border-brand-primary bg-brand-primary"
              />
              {labels.legendBookable}
            </span>
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block size-3 rounded-full border-2 border-brand-primary bg-surface-raised"
              />
              {labels.legendListed}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
