import { randomUUID } from 'node:crypto';
import { Alert, Button, Card, formatDate, formatMoney, StatePanel } from '@labconnect/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { gate } from '@/features/access/access';
import { hasAnyRole } from '@/features/access/roles';
import { isUuid } from '@/features/common/problem';
import {
  type BookingView,
  loadBooking,
  loadOpenSlots,
  loadRejectionReasons,
} from '@/features/lab-desk/desk-data';
import { DECIDER_ROLES, LAB_DESK_ROLES } from '@/features/lab-desk/desk-model';
import { AcceptForm, CounterForm, RejectForm } from '@/features/lab-desk/DecisionForms';
import { BookingStatusBadge, deadline, slotLabel } from '@/features/lab-desk/desk-view';
import { t } from '@/lib/i18n';
import messages from '../../../../../messages/en.json';

export const metadata: Metadata = {
  title: `${t('labDesk.inboxTitle')} · ${t('app.name')}`,
  robots: { index: false, follow: false },
};

const DECIDED = {
  accepted: 'labDesk.decidedAccepted',
  rejected: 'labDesk.decidedRejected',
  countered: 'labDesk.decidedCountered',
} as const;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function Facts({ booking }: { booking: BookingView }) {
  const rows: [string, string][] = [
    [t('labDesk.item'), booking.itemName],
    [t('labDesk.batch'), booking.batchNo ?? '—'],
    [t('labDesk.packages'), String(booking.declaredPackageCount)],
    [t('labDesk.slot'), slotLabel(booking.slot) ?? t('labDesk.noSlot')],
    [t('labDesk.preferredDate'), formatDate(booking.preferredDropDate)],
    [t('labDesk.total'), formatMoney(booking.total)],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-sm text-text-muted">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Lines({ booking }: { booking: BookingView }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-text-muted">
            <th scope="col" className="px-3 py-2">
              {t('labDesk.colTest')}
            </th>
            <th scope="col" className="px-3 py-2">
              {t('labDesk.colMethod')}
            </th>
            <th scope="col" className="px-3 py-2">
              {t('labDesk.colSample')}
            </th>
          </tr>
        </thead>
        <tbody>
          {booking.lines.map((line) => (
            <tr key={line.id} className="border-b border-border">
              <td className="px-3 py-2">{line.snapshot.parameter.name}</td>
              <td className="px-3 py-2">
                {line.snapshot.method?.name ?? line.snapshot.methodText ?? '—'}
              </td>
              <td className="px-3 py-2">
                {line.requiredSampleQty ?? line.snapshot.sampleQty} {line.snapshot.sampleUnit.name}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The lab's view of one booking (boards F5, K9). While it is REQUESTED a Checker of the site
 * decides here: accept, decline with a reason, or propose another slot and/or more sample.
 * One form at a time (`?decide=`), so the page works without JavaScript. A Maker sees the
 * booking read-only. The API decides who may act; this only hides what would be refused.
 */
export default async function LabBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await gate(LAB_DESK_ROLES);
  if (!access.ok) return access.panel;
  const { id } = await params;
  const query = await searchParams;
  const read = isUuid(id) ? await loadBooking(access.token, id) : ({ kind: 'not-found' } as const);
  if (read.kind !== 'ok' || read.booking.viewerParty !== 'LAB') {
    return (
      <div className="mx-auto max-w-lg py-6">
        <StatePanel
          kind={read.kind === 'unavailable' ? 'error' : 'empty'}
          title={
            read.kind === 'unavailable'
              ? t('labDesk.detailErrorTitle')
              : t('labDesk.noticeNotFound')
          }
          action={
            <Button asChild variant="secondary">
              <Link href="/lab/inbox">{t('labDesk.detailBack')}</Link>
            </Button>
          }
        />
      </div>
    );
  }
  const { booking, etag } = read;
  const decider = hasAnyRole(access.user, DECIDER_ROLES);
  const decidable = booking.status === 'REQUESTED' && decider;
  const decide = single(query.decide);
  const decided = single(query.decided);
  const self = `/lab/bookings/${booking.id}`;
  const text = messages.labDesk;

  let form: React.ReactNode = null;
  if (decidable && decide === 'accept') {
    form = (
      <AcceptForm
        text={text}
        bookingId={booking.id}
        etag={etag}
        initialKey={randomUUID()}
        cancelHref={self}
        title={t('labDesk.acceptTitle', { bookingNo: booking.bookingNo })}
        effect={t('labDesk.acceptEffect', {
          customer: booking.customerDisplayName,
          total: formatMoney(booking.total),
        })}
      />
    );
  } else if (decidable && decide === 'reject') {
    const reasons = await loadRejectionReasons();
    form = (
      <RejectForm
        text={text}
        bookingId={booking.id}
        etag={etag}
        initialKey={randomUUID()}
        cancelHref={self}
        reasons={reasons.map((reason) => ({ code: reason.code, name: reason.name }))}
      />
    );
  } else if (decidable && decide === 'counter') {
    const slots = await loadOpenSlots(booking.labSite.id, new Date());
    form = (
      <CounterForm
        text={text}
        bookingId={booking.id}
        etag={etag}
        initialKey={randomUUID()}
        cancelHref={self}
        currentSlotId={booking.slot?.id ?? null}
        currentSlotLabel={slotLabel(booking.slot)}
        slots={slots.map((slot) => ({ id: slot.id, label: slotLabel(slot) ?? slot.id }))}
        lines={booking.lines.map((line) => ({
          lineId: line.id,
          testName: line.snapshot.parameter.name,
          unitCode: line.snapshot.sampleUnit.code,
          unitName: line.snapshot.sampleUnit.name,
          current: line.requiredSampleQty ?? line.snapshot.sampleQty,
        }))}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 py-6">
      <nav aria-label={t('lab.breadcrumb')} className="text-sm">
        <Link href="/lab/inbox">{t('labDesk.detailBack')}</Link> ›{' '}
        <span className="font-mono">{booking.bookingNo}</span>
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-semibold">{booking.bookingNo}</h1>
        <BookingStatusBadge status={booking.status} />
      </div>
      <p className="text-text-muted">{booking.customerDisplayName}</p>
      {decided !== undefined && Object.hasOwn(DECIDED, decided) && (
        <Alert tone="success">{t(DECIDED[decided as keyof typeof DECIDED])}</Alert>
      )}
      {booking.status === 'REQUESTED' && (
        <Alert tone="info">
          {t('labDesk.detailRequested', { time: deadline(booking.labDecisionDueAt) })}
        </Alert>
      )}
      {booking.status === 'COUNTERED' && booking.counterOffer !== null && (
        <Alert tone="info">
          {t('labDesk.counterOpen', { time: deadline(booking.counterOffer.expiresAt) })}
        </Alert>
      )}
      <Card className="flex flex-col gap-4 p-4">
        <Facts booking={booking} />
        <h2 className="text-lg font-semibold">{t('labDesk.tests')}</h2>
        <Lines booking={booking} />
      </Card>
      {booking.status === 'REQUESTED' && !decider && (
        <Alert tone="info">{t('labDesk.onlyChecker')}</Alert>
      )}
      {decidable && (
        <Card className="flex flex-col gap-4 p-4">
          {form ?? (
            <>
              <h2 className="text-lg font-semibold">{t('labDesk.decideTitle')}</h2>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href={`${self}?decide=accept`}>{t('labDesk.accept')}</Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link href={`${self}?decide=counter`}>{t('labDesk.counter')}</Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link href={`${self}?decide=reject`}>{t('labDesk.reject')}</Link>
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
