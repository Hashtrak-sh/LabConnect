import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface MatchedTest {
  id: string;
  /** For example "Melt flow rate · IS 2530 (Part 6)". */
  name: string;
  /** Already formatted, for example "₹1,200.00 · 5 days"; omitted when the lab is not bookable. */
  detail?: string;
}

export interface LabResultCardProps {
  /** Lab site name, linked to its page. */
  name: string;
  href: string;
  /** Badges after the name (listing status, accreditation), as `StatusBadge`s. */
  badges?: ReactNode;
  /** One line under the name: place, distance, rating, accreditation check date. */
  meta?: ReactNode;
  /** Heading of the matched-tests list, for example "Why this lab matched". */
  matchedHeading?: string;
  /** At most three are shown (COMPONENT_SPECIFICATION LabResultCard). */
  matched?: readonly MatchedTest[];
  /** Shown after the third test when there are more, for example "+ 2 more tests". */
  moreMatched?: ReactNode;
  /** The right-hand summary: price from, turnaround, next slot (bookable labs). */
  summary?: ReactNode;
  /** The action: "Book" for a bookable lab, "Request this lab" for a listed one. */
  action: ReactNode;
  /** Highlights the card, for example when its pin is selected on the map. */
  selected?: boolean;
  className?: string;
}

const MAX_MATCHED = 3;

/**
 * A search result (COMPONENT_SPECIFICATION "LabResultCard"; approved board B1-Search, H2): the
 * lab, why it matched and what it costs. The same card serves the bookable, listed, calibration
 * and unavailable states; the caller chooses the badges, summary and action. All text comes from
 * the caller.
 */
export function LabResultCard({
  name,
  href,
  badges,
  meta,
  matchedHeading,
  matched = [],
  moreMatched,
  summary,
  action,
  selected = false,
  className,
}: LabResultCardProps) {
  const shown = matched.slice(0, MAX_MATCHED);
  return (
    <article
      className={cn(
        'flex flex-col gap-4 rounded-md border bg-surface-raised px-5 py-4 shadow-card md:flex-row',
        selected ? 'border-2 border-brand-primary' : 'border-border',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold">
            <a href={href} className="text-text no-underline hover:underline">
              {name}
            </a>
          </h3>
          {badges}
        </div>
        {meta !== undefined && <p className="text-sm text-text-muted">{meta}</p>}
        {shown.length > 0 && (
          <div className="flex flex-col gap-1 text-sm">
            {matchedHeading !== undefined && (
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {matchedHeading}
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {shown.map((test) => (
                <li key={test.id} className="flex flex-wrap justify-between gap-x-4">
                  <span className="flex items-center gap-1.5">
                    <Check aria-hidden="true" className="size-4 shrink-0 text-success" />
                    {test.name}
                  </span>
                  {test.detail !== undefined && <span className="tabular-nums">{test.detail}</span>}
                </li>
              ))}
            </ul>
            {matched.length > MAX_MATCHED && moreMatched !== undefined && (
              <p className="text-text-muted">{moreMatched}</p>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col items-stretch gap-2 border-border max-md:border-t max-md:pt-4 md:w-48 md:flex-none md:border-l md:pl-4">
        {summary}
        {action}
      </div>
    </article>
  );
}
