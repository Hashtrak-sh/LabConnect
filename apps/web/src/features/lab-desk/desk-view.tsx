import { BOOKING_STATUS_STYLES, formatDateTime, formatTime, StatusBadge } from '@labconnect/ui';
import { t } from '@/lib/i18n';
import type { BookingStatus } from './desk-model';

export function statusLabel(status: BookingStatus): string {
  return t(`bookingStatus.${status}`);
}

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <StatusBadge status={BOOKING_STATUS_STYLES[status]} label={statusLabel(status)} />;
}

/** "Thu 26 Nov 2026, 10:00 AM – 12:00 PM IST": a slot as the boards write it. */
export function slotLabel(slot: { startsAt: string; endsAt: string } | null): string | null {
  if (slot === null) return null;
  return `${formatDateTime(slot.startsAt).replace(/ IST$/, '')} – ${formatTime(slot.endsAt)}`;
}

/** A deadline, or an empty mark when there is none. */
export function deadline(iso: string | null): string {
  return iso === null ? '—' : formatDateTime(iso);
}
