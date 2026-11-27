import { BOOKING_STATUSES, type BookingStatus } from '@labconnect/shared';

/**
 * Status mapping: one source of truth (DESIGN_SYSTEM.md section 1.3, A1 token sheet, pass 2 A-02).
 * Status is never colour alone: a badge always shows a label and an icon with its tone. Labels are
 * text and come from the app's messages; this file gives the tone and the icon only.
 */
export type Tone = 'info' | 'warning' | 'success' | 'danger' | 'neutral' | 'brand';

export type StatusIcon = 'clock' | 'alert' | 'check' | 'x' | 'circle' | 'shield' | 'store';

export interface StatusStyle {
  tone: Tone;
  icon: StatusIcon;
}

/** Booking states by who is waiting (DESIGN_SYSTEM 1.3; ON_HOLD is warning, pass 2 A-02). */
export const BOOKING_STATUS_STYLES: Readonly<Record<BookingStatus, StatusStyle>> = {
  REQUESTED: { tone: 'info', icon: 'clock' },
  COUNTERED: { tone: 'warning', icon: 'alert' },
  ACCEPTED: { tone: 'warning', icon: 'alert' },
  PAID: { tone: 'success', icon: 'check' },
  HANDOVER_SET: { tone: 'warning', icon: 'alert' },
  SAMPLE_RECORDED: { tone: 'info', icon: 'clock' },
  ON_HOLD: { tone: 'warning', icon: 'alert' },
  RECEIVED: { tone: 'info', icon: 'clock' },
  UNDER_TEST: { tone: 'info', icon: 'clock' },
  REPORT_IN_REVIEW: { tone: 'info', icon: 'clock' },
  REPORT_RELEASED: { tone: 'success', icon: 'check' },
  DISPUTED: { tone: 'danger', icon: 'alert' },
  COMPLETED: { tone: 'success', icon: 'check' },
  REJECTED: { tone: 'neutral', icon: 'x' },
  EXPIRED: { tone: 'neutral', icon: 'x' },
  EXPIRED_UNPAID: { tone: 'neutral', icon: 'x' },
  NO_SHOW: { tone: 'neutral', icon: 'x' },
  CANCELLED: { tone: 'neutral', icon: 'x' },
};

/** Listing status of a lab site on public pages (`PublicListingStatus`). */
export const LISTING_STATUS_STYLES = {
  BOOKABLE: { tone: 'success', icon: 'check' },
  LISTED: { tone: 'neutral', icon: 'store' },
} as const satisfies Record<'BOOKABLE' | 'LISTED', StatusStyle>;

/** Accreditation status (`AccreditationStatus`); a suspended accreditation is warning (A-02). */
export const ACCREDITATION_STATUS_STYLES = {
  VALID: { tone: 'success', icon: 'shield' },
  SUSPENDED: { tone: 'warning', icon: 'alert' },
  WITHDRAWN: { tone: 'neutral', icon: 'x' },
  EXPIRED: { tone: 'neutral', icon: 'x' },
} as const satisfies Record<string, StatusStyle>;

/** Every booking state has a style; the test holds this list to the shared one. */
export const STYLED_BOOKING_STATUSES: readonly BookingStatus[] = BOOKING_STATUSES;
