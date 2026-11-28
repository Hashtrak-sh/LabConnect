import { Alert, Button, Card, formatMoney, StatePanel } from '@labconnect/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { gate } from '@/features/access/access';
import { hasAnyRole } from '@/features/access/roles';
import { loadInbox } from '@/features/lab-desk/desk-data';
import {
  DECIDER_ROLES,
  INBOX_TABS,
  type InboxItem,
  type InboxTab,
  LAB_DESK_ROLES,
  readTab,
  rowsOfTab,
  TAB_STATUSES,
} from '@/features/lab-desk/desk-model';
import { BookingStatusBadge, deadline, slotLabel } from '@/features/lab-desk/desk-view';
import { type MessageKey, t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: `${t('labDesk.inboxTitle')} · ${t('app.name')}`,
  robots: { index: false, follow: false },
};

const TAB_LABELS: Readonly<Record<InboxTab, MessageKey>> = {
  new: 'labDesk.tabNew',
  waiting: 'labDesk.tabWaiting',
  drops: 'labDesk.tabDrops',
  overdue: 'labDesk.tabOverdue',
};

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const CELL = 'px-3 py-2 text-left align-top';

function Customer({ item }: { item: InboxItem }) {
  return (
    <>
      <span className="font-medium">{item.booking.customerDisplayName}</span>
      <span className="text-text-muted"> · {item.booking.itemName}</span>
    </>
  );
}

/** The table of one tab, with the columns board K8 draws for it. */
function Rows({ tab, rows, decider }: { tab: InboxTab; rows: InboxItem[]; decider: boolean }) {
  const head =
    tab === 'new'
      ? [
          t('labDesk.colBooking'),
          t('labDesk.colCustomer'),
          t('labDesk.colSize'),
          t('labDesk.colTotal'),
          t('labDesk.colDecideBy'),
          '',
        ]
      : tab === 'waiting'
        ? [
            t('labDesk.colBooking'),
            t('labDesk.colCustomer'),
            t('labDesk.colWaitingOn'),
            t('labDesk.colDue'),
            '',
          ]
        : tab === 'drops'
          ? [
              t('labDesk.colBooking'),
              t('labDesk.colCustomer'),
              t('labDesk.colSlot'),
              t('labDesk.colPackages'),
              '',
            ]
          : [t('labDesk.colBooking'), t('labDesk.colCustomer'), t('labDesk.colDeadline'), ''];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-text-muted">
            {head.map((label, index) => (
              <th key={index} scope="col" className={CELL}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const { booking } = item;
            const open = (
              <Link href={`/lab/bookings/${booking.id}`}>
                {tab === 'new'
                  ? decider
                    ? t('labDesk.review')
                    : t('labDesk.open')
                  : t('labDesk.open')}
              </Link>
            );
            return (
              <tr key={booking.id} className="border-b border-border">
                <td className={`${CELL} font-mono`}>{booking.bookingNo}</td>
                <td className={CELL}>
                  <Customer item={item} />
                </td>
                {tab === 'new' && (
                  <>
                    <td className={CELL}>
                      {t('labDesk.size', {
                        tests:
                          booking.lineCount === 1
                            ? t('labDesk.testsOne')
                            : t('labDesk.testsMany', { count: booking.lineCount }),
                        packages: booking.declaredPackageCount,
                      })}
                    </td>
                    <td className={CELL}>{formatMoney(booking.total)}</td>
                    <td className={CELL}>{deadline(booking.labDecisionDueAt)}</td>
                    <td className={CELL}>
                      {open}
                      {!decider && (
                        <p className="text-xs text-text-muted">{t('labDesk.onlyChecker')}</p>
                      )}
                    </td>
                  </>
                )}
                {tab === 'waiting' && (
                  <>
                    <td className={CELL}>
                      <BookingStatusBadge status={booking.status} />
                    </td>
                    <td className={CELL}>
                      {booking.status === 'ACCEPTED' ? deadline(booking.paymentDueAt) : '—'}
                    </td>
                    <td className={CELL}>{open}</td>
                  </>
                )}
                {tab === 'drops' && (
                  <>
                    <td className={CELL}>{slotLabel(booking.slot) ?? t('labDesk.noSlot')}</td>
                    <td className={CELL}>{booking.declaredPackageCount}</td>
                    <td className={CELL}>{open}</td>
                  </>
                )}
                {tab === 'overdue' && (
                  <>
                    <td className={CELL}>{deadline(booking.dropDeadlineAt)}</td>
                    <td className={CELL}>{open}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The lab inbox (boards K8 and F5): the bookings of the caller's sites that need the lab, one tab
 * at a time, most urgent first as the API orders them. A Maker sees the same lists, read-only.
 * Tabs are links, so the page works without JavaScript and a tab can be bookmarked.
 */
export default async function LabInboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await gate(LAB_DESK_ROLES);
  if (!access.ok) return access.panel;
  const params = await searchParams;
  const tab = readTab(single(params.tab));
  const cursor = single(params.cursor) ?? null;
  const decider = hasAnyRole(access.user, DECIDER_ROLES);
  const page = await loadInbox(access.token, { statuses: TAB_STATUSES[tab], cursor });
  const rows = page === null ? [] : rowsOfTab(tab, page.data, new Date());

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('labDesk.inboxTitle')}</h1>
        <p className="text-text-muted">{t('labDesk.inboxIntro')}</p>
      </div>
      <nav
        aria-label={t('labDesk.inboxTitle')}
        className="flex flex-wrap gap-2 border-b border-border"
      >
        {INBOX_TABS.map((name) => (
          <Link
            key={name}
            href={`/lab/inbox?tab=${name}`}
            aria-current={name === tab ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium no-underline max-md:min-h-11 ${
              name === tab ? 'border-brand text-text' : 'border-transparent text-text-subtle'
            }`}
          >
            {t(TAB_LABELS[name])}
          </Link>
        ))}
      </nav>
      {!decider && <Alert tone="info">{t('labDesk.makerNote')}</Alert>}
      {page === null ? (
        <StatePanel
          kind="error"
          title={t('labDesk.errorTitle')}
          action={
            <Button asChild variant="secondary">
              <Link href={`/lab/inbox?tab=${tab}`}>{t('labDesk.reload')}</Link>
            </Button>
          }
        >
          <p>{t('labDesk.errorText')}</p>
        </StatePanel>
      ) : rows.length === 0 ? (
        <StatePanel kind="empty" title={t(TAB_LABELS[tab])}>
          <p>{tab === 'new' ? t('labDesk.emptyNew') : t('labDesk.emptyOther')}</p>
        </StatePanel>
      ) : (
        <Card className="p-0">
          <Rows tab={tab} rows={rows} decider={decider} />
          {tab === 'overdue' && (
            <p className="px-3 py-2 text-sm text-text-muted">{t('labDesk.overdueNote')}</p>
          )}
        </Card>
      )}
      {page?.nextCursor !== null && page?.nextCursor !== undefined && (
        <Link
          className="self-start"
          href={`/lab/inbox?tab=${tab}&cursor=${encodeURIComponent(page.nextCursor)}`}
        >
          {t('labDesk.more')}
        </Link>
      )}
    </div>
  );
}
