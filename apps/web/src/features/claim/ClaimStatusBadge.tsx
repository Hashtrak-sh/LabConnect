import { StatusBadge, type StatusStyle } from '@labconnect/ui';
import { type MessageKey, t } from '@/lib/i18n';
import type { ClaimStatus } from './claim-model';

/** A claim's status: label, icon and tone together, never colour alone (DESIGN_SYSTEM 1.3). */
const STYLES: Readonly<Record<ClaimStatus, { style: StatusStyle; label: MessageKey }>> = {
  PENDING_OTP: { style: { tone: 'warning', icon: 'clock' }, label: 'claim.statusPendingOtp' },
  PENDING_REVIEW: { style: { tone: 'info', icon: 'clock' }, label: 'claim.statusPendingReview' },
  APPROVED: { style: { tone: 'success', icon: 'check' }, label: 'claim.statusApproved' },
  REJECTED: { style: { tone: 'danger', icon: 'x' }, label: 'claim.statusRejected' },
  EXPIRED: { style: { tone: 'neutral', icon: 'circle' }, label: 'claim.statusExpired' },
};

export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  const { style, label } = STYLES[status];
  return <StatusBadge status={style} label={t(label)} />;
}
