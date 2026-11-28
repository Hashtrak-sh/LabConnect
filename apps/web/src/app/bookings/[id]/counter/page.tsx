import { randomUUID } from 'node:crypto';
import { Alert, Badge, Button, Card, formatMoney, StatePanel } from '@labconnect/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { gate } from '@/features/access/access';
import { isUuid } from '@/features/common/problem';
import { CounterAnswer } from '@/features/lab-desk/CounterAnswer';
import { loadBooking } from '@/features/lab-desk/desk-data';
import { COUNTER_ROLES } from '@/features/lab-desk/desk-model';
import { deadline, slotLabel } from '@/features/lab-desk/desk-view';
import { t } from '@/lib/i18n';
import messages from '../../../../../messages/en.json';

export const metadata: Metadata = {
  title: `${t('counter.title')} · ${t('app.name')}`,
  robots: { index: false, follow: false },
};

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const CELL = 'px-3 py-2 text-left align-top';

/**
 * Board C4: the customer answers the lab's counter-offer. What changes is shown side by side:
 * the slot, the sample per test, and the price, which a counter-offer never changes (BR-017).
 * Accepting opens the payment window (T-07); declining ends the request with no charge (T-08).
 * Payment screens come with I4; until then the page states the payment deadline.
 */
export default async function CounterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await gate(COUNTER_ROLES);
  if (!access.ok) return access.panel;
  const { id } = await params;
  const answered = single((await searchParams).answered);
  const read = isUuid(id) ? await loadBooking(access.token, id) : ({ kind: 'not-found' } as const);
  if (read.kind !== 'ok' || read.booking.viewerParty !== 'CUSTOMER') {
    return (
      <div className="mx-auto max-w-lg py-6">
        <StatePanel
          kind={read.kind === 'unavailable' ? 'error' : 'empty'}
          title={read.kind === 'unavailable' ? t('counter.errorTitle') : t('counter.notOpen')}
        />
      </div>
    );
  }
  const { booking, etag } = read;

  if (answered === 'accepted' || answered === 'declined') {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 py-6">
        <h1 className="font-mono text-2xl font-semibold">{booking.bookingNo}</h1>
        <Alert tone={answered === 'accepted' ? 'success' : 'info'}>
          <p>{answered === 'accepted' ? t('counter.accepted') : t('counter.declined')}</p>
          {answered === 'accepted' && booking.paymentDueAt !== null && (
            <p>{t('counter.acceptedPay', { time: deadline(booking.paymentDueAt) })}</p>
          )}
        </Alert>
      </div>
    );
  }

  const offer = booking.counterOffer;
  if (booking.status !== 'COUNTERED' || offer === null || offer.status !== 'PENDING') {
    return (
      <div className="mx-auto max-w-lg py-6">
        <StatePanel kind="empty" title={t('counter.notOpen')} />
      </div>
    );
  }

  const proposedQty = new Map(
    offer.perLineQuantity.map((quantity) => [quantity.lineId, quantity.sampleQty]),
  );
  const yours = slotLabel(booking.slot) ?? '—';
  const theirs = offer.proposedSlot === null ? yours : (slotLabel(offer.proposedSlot) ?? yours);
  const slotChanged = offer.proposedSlot !== null && offer.proposedSlot.id !== booking.slot?.id;
  const change = (changed: boolean) =>
    changed ? (
      <Badge tone="warning">{t('counter.changed')}</Badge>
    ) : (
      <span className="text-text-muted">{t('counter.noChange')}</span>
    );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 py-6">
      <nav aria-label={t('lab.breadcrumb')} className="text-sm">
        <span className="font-mono">{booking.bookingNo}</span> › {t('counter.title')}
      </nav>
      <h1 className="text-2xl font-semibold">{t('counter.decision')}</h1>
      <Alert tone="warning">{t('counter.answerBy', { time: deadline(offer.expiresAt) })}</Alert>
      <Card className="flex flex-col gap-2 p-4">
        <h2 className="font-semibold">{t('counter.message')}</h2>
        <p>{t('labDesk.quoted', { text: offer.message })}</p>
      </Card>
      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-lg font-semibold">{t('counter.whatChanges')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th scope="col" className={CELL}>
                  <span className="sr-only">{t('counter.whatChanges')}</span>
                </th>
                <th scope="col" className={CELL}>
                  {t('counter.colYours')}
                </th>
                <th scope="col" className={CELL}>
                  {t('counter.colLab')}
                </th>
                <th scope="col" className={CELL}>
                  <span className="sr-only">{t('counter.changed')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <th scope="row" className={CELL}>
                  {t('counter.slotRow')}
                </th>
                <td className={CELL}>{yours}</td>
                <td className={CELL}>{theirs}</td>
                <td className={CELL}>{change(slotChanged)}</td>
              </tr>
              {booking.lines.map((line) => {
                const now = line.requiredSampleQty ?? line.snapshot.sampleQty;
                const proposed = proposedQty.get(line.id) ?? now;
                const unit = line.snapshot.sampleUnit.name;
                return (
                  <tr key={line.id} className="border-b border-border">
                    <th scope="row" className={CELL}>
                      {t('counter.sampleRow', { test: line.snapshot.parameter.name })}
                    </th>
                    <td className={CELL}>{`${String(now)} ${unit}`}</td>
                    <td className={CELL}>{`${String(proposed)} ${unit}`}</td>
                    <td className={CELL}>{change(proposed !== now)}</td>
                  </tr>
                );
              })}
              <tr>
                <th scope="row" className={CELL}>
                  {t('counter.priceRow')}
                </th>
                <td className={CELL}>{formatMoney(booking.total)}</td>
                <td className={CELL}>
                  {t('counter.priceNoChange', { total: formatMoney(booking.total) })}
                </td>
                <td className={CELL}>{change(false)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm text-text-muted">{t('counter.rule')}</p>
      </Card>
      <CounterAnswer
        text={messages.counter}
        bookingId={booking.id}
        etag={etag}
        initialKey={randomUUID()}
      />
      <Button asChild variant="secondary" className="self-start">
        <Link href="/">{t('access.backHome')}</Link>
      </Button>
    </div>
  );
}
