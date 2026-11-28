import { Alert, Button, Card, StatePanel } from '@labconnect/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { gate } from '@/features/access/access';
import { hasAnyRole } from '@/features/access/roles';
import { loadInbox } from '@/features/lab-desk/desk-data';
import { DECIDER_ROLES, type InboxItem, LAB_DESK_ROLES } from '@/features/lab-desk/desk-model';
import { deadline, slotLabel } from '@/features/lab-desk/desk-view';
import { t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: `${t('labDesk.homeTitle')} · ${t('app.name')}`,
  robots: { index: false, follow: false },
};

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function BookingLine({ item, detail }: { item: InboxItem; detail: string }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-0">
      <Link href={`/lab/bookings/${item.booking.id}`} className="font-mono">
        {item.booking.bookingNo}
      </Link>
      <span className="text-text-muted">
        {item.booking.customerDisplayName} · {item.booking.itemName}
      </span>
      <span className="text-sm">{detail}</span>
    </li>
  );
}

/**
 * The lab's home (boards E3 Checker, E2 Maker), drawn from the inbox only. What the boards show
 * that has no API yet (the sample scanner, returned reports, site setup gaps, disputes) comes with
 * its own increment. A Checker sees what needs approving and the new requests; a Maker the drops
 * expected and what waits for a Checker.
 */
export default async function LabHomePage() {
  const access = await gate(LAB_DESK_ROLES);
  if (!access.ok) return access.panel;
  const checker = hasAnyRole(access.user, DECIDER_ROLES);
  const [open, requested, drops] = await Promise.all([
    loadInbox(access.token, { limit: 100 }),
    loadInbox(access.token, { statuses: ['REQUESTED'], limit: 5 }),
    loadInbox(access.token, { statuses: ['PAID', 'HANDOVER_SET'], limit: 10 }),
  ]);
  if (open === null || requested === null || drops === null) {
    return (
      <div className="mx-auto max-w-lg py-6">
        <StatePanel
          kind="error"
          title={t('labDesk.errorTitle')}
          action={
            <Button asChild variant="secondary">
              <Link href="/lab">{t('labDesk.reload')}</Link>
            </Button>
          }
        >
          <p>{t('labDesk.errorText')}</p>
        </StatePanel>
      </div>
    );
  }
  const approvals = open.data.filter((item) => item.pendingApproval !== null);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{t('labDesk.homeTitle')}</h1>
          <p className="text-text-muted">{t('labDesk.homeIntro')}</p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/lab/inbox">{t('labDesk.openInbox')}</Link>
        </Button>
      </div>

      <Section title={checker ? t('labDesk.approvalsTitle') : t('labDesk.approvalWaiting')}>
        {approvals.length === 0 ? (
          <p className="text-text-muted">{t('labDesk.approvalsEmpty')}</p>
        ) : (
          <ul>
            {approvals.map((item) => (
              <BookingLine
                key={item.booking.id}
                item={item}
                detail={`${item.pendingApproval === 'RECEIPT' ? t('labDesk.approvalReceipt') : t('labDesk.approvalReport')}${
                  item.viewerWasMaker ? ` · ${t('labDesk.approvalYouMade')}` : ''
                }`}
              />
            ))}
          </ul>
        )}
        {approvals.length > 0 && <Alert tone="info">{t('labDesk.approvalScreensLater')}</Alert>}
      </Section>

      <Section
        title={t('labDesk.newTitle')}
        action={<Link href="/lab/inbox?tab=new">{t('labDesk.openInbox')}</Link>}
      >
        {requested.data.length === 0 ? (
          <p className="text-text-muted">{t('labDesk.newEmpty')}</p>
        ) : (
          <ul>
            {requested.data.map((item) => (
              <BookingLine
                key={item.booking.id}
                item={item}
                detail={deadline(item.booking.labDecisionDueAt)}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={t('labDesk.dropsTitle')}
        action={<Link href="/lab/inbox?tab=drops">{t('labDesk.openInbox')}</Link>}
      >
        {drops.data.length === 0 ? (
          <p className="text-text-muted">{t('labDesk.dropsEmpty')}</p>
        ) : (
          <ul>
            {drops.data.map((item) => (
              <BookingLine
                key={item.booking.id}
                item={item}
                detail={slotLabel(item.booking.slot) ?? deadline(item.booking.dropDeadlineAt)}
              />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
