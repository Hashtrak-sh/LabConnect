import { escapeHtml, singleLine } from './format.js';
import { channelsOf, type DeliveryChannel } from './rules.js';

// The code templates: typed functions from a small, already-resolved view model to the text of
// an email or an in-app notification (NOTIFICATIONS.md section 3). They are the defaults. A
// newer ACTIVE row in `notification_template` replaces them (`template-store.ts`).
//
// Rules the tests enforce:
// - a template reads only the variables its event allows (`EVENT_VARIABLES`);
// - every interpolated value is escaped in HTML and cannot add a header line to a subject;
// - there is no variable for report content, an OTP, a token or bank details, so there is
//   nothing to leak: `auth.otp` is not routed (OQ-65).

/** Every variable any template may use. The whitelist of NOTIFICATIONS.md section 3. */
export const TEMPLATE_VARIABLES = [
  'bookingNo',
  'labName',
  'organisationName',
  'deadline',
  'reason',
  'amount',
  'actionUrl',
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/**
 * What a template receives: strings that are ready to show (dates in IST, amounts as INR) and
 * no other data. A variable may be missing; the wording copes.
 */
export type TemplateData = Readonly<Partial<Record<TemplateVariable, string>>>;

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export interface InAppContent {
  title: string;
  body: string;
  /** The deep link: a path on the web app. */
  link?: string;
}

export type EmailTemplate = (data: TemplateData) => EmailContent;
export type InAppTemplate = (data: TemplateData) => InAppContent;

export interface EventTemplates {
  email?: EmailTemplate;
  inApp?: InAppTemplate;
}

/** Locales of the registry. Hindi arrives with the Hindi decision (OQ-13); only `en` is filled. */
export type TemplateLocale = 'en';
export const DEFAULT_TEMPLATE_LOCALE: TemplateLocale = 'en';

/** The variables each event may use: the allow-list for code templates and for edited ones. */
export const EVENT_VARIABLES: Readonly<Record<string, readonly TemplateVariable[]>> = {
  'booking.requested': ['bookingNo', 'labName', 'deadline', 'actionUrl'],
  'booking.sla_reminder': ['bookingNo', 'deadline', 'actionUrl'],
  'booking.accepted': ['bookingNo', 'labName', 'deadline', 'actionUrl'],
  'booking.rejected': ['bookingNo', 'labName', 'reason', 'actionUrl'],
  'booking.expired': ['bookingNo', 'actionUrl'],
  'booking.countered': ['bookingNo', 'labName', 'deadline', 'actionUrl'],
  'booking.counter_response': ['bookingNo', 'actionUrl'],
  'payment.window_ending': ['bookingNo', 'deadline', 'actionUrl'],
  'payment.succeeded': ['bookingNo', 'labName', 'deadline', 'amount', 'actionUrl'],
  'payment.expired': ['bookingNo', 'actionUrl'],
  'handover.deadline_approaching': ['bookingNo', 'labName', 'deadline', 'actionUrl'],
  'handover.overdue': ['bookingNo', 'labName', 'actionUrl'],
  'booking.no_show': ['bookingNo', 'actionUrl'],
  'receipt.recorded': ['bookingNo', 'actionUrl'],
  'receipt.approved': ['bookingNo', 'labName', 'actionUrl'],
  'receipt.on_hold': ['bookingNo', 'reason', 'deadline', 'actionUrl'],
  'hold.reminder': ['bookingNo', 'deadline', 'actionUrl'],
  'hold.escalated': ['bookingNo', 'actionUrl'],
  'approval.sla_reminder': ['bookingNo', 'deadline', 'actionUrl'],
  'testing.started': ['bookingNo', 'actionUrl'],
  'report.eta_revised': ['bookingNo', 'deadline', 'reason', 'actionUrl'],
  'report.submitted': ['bookingNo', 'actionUrl'],
  'report.returned': ['bookingNo', 'actionUrl'],
  'report.released': ['bookingNo', 'actionUrl'],
  'report.amended': ['bookingNo', 'actionUrl'],
  'label.reprint_requested': ['bookingNo', 'actionUrl'],
  'booking.cancelled': ['bookingNo', 'reason', 'actionUrl'],
  'refund.processed': ['bookingNo', 'amount', 'actionUrl'],
  'payout.released': ['organisationName', 'amount', 'actionUrl'],
  'dispute.opened': ['bookingNo', 'actionUrl'],
  'dispute.updated': ['bookingNo', 'actionUrl'],
  'dispute.decided': ['bookingNo', 'actionUrl'],
  'accreditation.changed': ['labName', 'actionUrl'],
  'lab.became_bookable': ['labName', 'actionUrl'],
  'user.invited': ['organisationName', 'actionUrl'],
};

export const EMAIL_FOOTER =
  'You receive this message from LabConnect. You can choose which notifications you get in your ' +
  'account settings; notifications that need your action cannot be switched off.';

// ---------------------------------------------------------------- composition helpers

interface Wording {
  title: (data: TemplateData) => string;
  body: (data: TemplateData) => string;
}

const booking = (data: TemplateData): string =>
  data.bookingNo ? `booking ${data.bookingNo}` : 'the booking';
const Booking = (data: TemplateData): string =>
  data.bookingNo ? `Booking ${data.bookingNo}` : 'A booking';
const by = (data: TemplateData): string => (data.deadline ? ` by ${data.deadline}` : '');
const lab = (data: TemplateData): string => data.labName ?? 'The lab';
const at = (data: TemplateData): string => (data.labName ? ` at ${data.labName}` : '');
const why = (data: TemplateData): string => (data.reason ? ` Reason: ${data.reason}.` : '');
const of = (data: TemplateData): string => (data.amount ? ` of ${data.amount}` : '');

/** The wording of every event. One wording serves every recipient of an event, as the seeded templates do. */
const WORDINGS: Readonly<Record<string, Wording>> = {
  'booking.requested': {
    title: (d) => `${Booking(d)} requested`,
    body: (d) => `${Booking(d)} was requested${at(d)}. The lab decides${by(d)}.`,
  },
  'booking.sla_reminder': {
    title: (d) => `${Booking(d)} is waiting for a decision`,
    body: (d) => `${Booking(d)} needs a decision${by(d)}.`,
  },
  'booking.accepted': {
    title: (d) => `${Booking(d)} accepted`,
    body: (d) => `${lab(d)} accepted ${booking(d)}. Payment is due${by(d)}.`,
  },
  'booking.rejected': {
    title: (d) => `${Booking(d)} was not accepted`,
    body: (d) => `${lab(d)} did not accept ${booking(d)}.${why(d)}`,
  },
  'booking.expired': {
    title: (d) => `${Booking(d)} expired`,
    body: (d) => `${Booking(d)} expired because no decision was made in time.`,
  },
  'booking.countered': {
    title: (d) => `${Booking(d)}: the lab proposed a change`,
    body: (d) => `${lab(d)} proposed a change to ${booking(d)}. Please respond${by(d)}.`,
  },
  'booking.counter_response': {
    title: (d) => `${Booking(d)}: response to the proposed change`,
    body: (d) => `The customer responded to the change proposed for ${booking(d)}.`,
  },
  'payment.window_ending': {
    title: (d) => `${Booking(d)}: payment is due soon`,
    body: (d) => `Payment for ${booking(d)} is due${by(d)}.`,
  },
  'payment.succeeded': {
    title: (d) => `${Booking(d)}: payment received`,
    body: (d) =>
      `Payment${of(d)} for ${booking(d)} was received. The sample is due${at(d)}${by(d)}.`,
  },
  'payment.expired': {
    title: (d) => `${Booking(d)}: payment window ended`,
    body: (d) => `${Booking(d)} was closed because payment was not received in time.`,
  },
  'handover.deadline_approaching': {
    title: (d) => `${Booking(d)}: drop the sample${by(d)}`,
    body: (d) => `The sample for ${booking(d)} is due${at(d)}${by(d)}.`,
  },
  'handover.overdue': {
    title: (d) => `${Booking(d)}: the sample is overdue`,
    body: (d) => `The sample for ${booking(d)} has not reached ${lab(d)}.`,
  },
  'booking.no_show': {
    title: (d) => `${Booking(d)} closed: sample not received`,
    body: (d) => `${Booking(d)} was closed because the sample was not dropped in time.`,
  },
  'receipt.recorded': {
    title: (d) => `${Booking(d)}: sample receipt recorded`,
    body: (d) =>
      `The receipt of the sample for ${booking(d)} was recorded and is waiting for approval.`,
  },
  'receipt.approved': {
    title: (d) => `${Booking(d)}: sample received`,
    body: (d) => `${lab(d)} received the sample for ${booking(d)}.`,
  },
  'receipt.on_hold': {
    title: (d) => `${Booking(d)} is on hold`,
    body: (d) => `The sample for ${booking(d)} is on hold.${why(d)} A decision is needed${by(d)}.`,
  },
  'hold.reminder': {
    title: (d) => `${Booking(d)}: a decision is still needed`,
    body: (d) => `${Booking(d)} is on hold and needs a decision${by(d)}.`,
  },
  'hold.escalated': {
    title: (d) => `${Booking(d)}: hold escalated`,
    body: (d) =>
      `No decision was made on the hold for ${booking(d)}. It has been passed to the support team.`,
  },
  'approval.sla_reminder': {
    title: (d) => `${Booking(d)} is waiting for approval`,
    body: (d) => `An approval for ${booking(d)} is due${by(d)}.`,
  },
  'testing.started': {
    title: (d) => `${Booking(d)}: testing started`,
    body: (d) => `Testing started for ${booking(d)}.`,
  },
  'report.eta_revised': {
    title: (d) => `${Booking(d)}: new report date`,
    body: (d) => `The report for ${booking(d)} is now expected${by(d)}.${why(d)}`,
  },
  'report.submitted': {
    title: (d) => `${Booking(d)}: report waiting for approval`,
    body: (d) => `A report for ${booking(d)} is waiting for approval.`,
  },
  'report.returned': {
    title: (d) => `${Booking(d)}: report returned for correction`,
    body: (d) => `The report for ${booking(d)} was returned for correction.`,
  },
  'report.released': {
    title: (d) => `${Booking(d)}: report released`,
    body: (d) => `The report for ${booking(d)} is released.`,
  },
  'report.amended': {
    title: (d) => `${Booking(d)}: amended report released`,
    body: (d) =>
      `An amended report for ${booking(d)} is released. It replaces the earlier version.`,
  },
  'label.reprint_requested': {
    title: (d) => `${Booking(d)}: label reprint requested`,
    body: (d) => `A label reprint was requested for ${booking(d)}.`,
  },
  'booking.cancelled': {
    title: (d) => `${Booking(d)} cancelled`,
    body: (d) => `${Booking(d)} was cancelled.${why(d)}`,
  },
  'refund.processed': {
    title: (d) => `${Booking(d)}: refund processed`,
    body: (d) => `A refund${of(d)} for ${booking(d)} was processed.`,
  },
  'payout.released': {
    title: () => 'Settlement advice',
    body: (d) =>
      `A payout${of(d)} was released${d.organisationName ? ` to ${d.organisationName}` : ''}.`,
  },
  'dispute.opened': {
    title: (d) => `${Booking(d)}: dispute opened`,
    body: (d) => `A dispute was opened on ${booking(d)}.`,
  },
  'dispute.updated': {
    title: (d) => `${Booking(d)}: dispute updated`,
    body: (d) => `The dispute on ${booking(d)} was updated.`,
  },
  'dispute.decided': {
    title: (d) => `${Booking(d)}: dispute decided`,
    body: (d) => `The dispute on ${booking(d)} was decided.`,
  },
  'accreditation.changed': {
    title: (d) => `Accreditation change${d.labName ? ` at ${d.labName}` : ''}`,
    body: (d) => `The accreditation of ${d.labName ?? 'a lab'} changed.`,
  },
  'lab.became_bookable': {
    title: (d) => `${d.labName ?? 'A lab'} can now be booked`,
    body: (d) => `${d.labName ?? 'The lab'}, which you asked about, can now be booked.`,
  },
  'user.invited': {
    title: (d) => `You are invited to ${d.organisationName ?? 'LabConnect'}`,
    body: (d) =>
      `You are invited to join ${d.organisationName ?? 'an organisation on LabConnect'}.`,
  },
};

/** The plain text and the HTML of a message with a link line and the footer. Everything is escaped. */
export function composeEmail(
  subject: string,
  paragraphs: readonly string[],
  actionUrl: string | undefined,
): EmailContent {
  const lines = [...paragraphs];
  const link = actionUrl && /^https?:\/\//.test(actionUrl) ? actionUrl : undefined;
  const text = [...lines, ...(link ? [`Open it here: ${link}`] : []), '--', EMAIL_FOOTER].join(
    '\n\n',
  );
  const html = [
    '<!doctype html><html><body style="font-family:sans-serif;line-height:1.5;color:#1a1a1a">',
    ...lines.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    ...(link ? [`<p><a href="${escapeHtml(link)}">Open it in LabConnect</a></p>`] : []),
    `<hr><p style="font-size:12px;color:#555">${escapeHtml(EMAIL_FOOTER)}</p>`,
    '</body></html>',
  ].join('');
  return { subject: singleLine(subject), text, html };
}

function emailTemplate(wording: Wording): EmailTemplate {
  return (data) => composeEmail(wording.title(data), [wording.body(data)], data.actionUrl);
}

function inAppTemplate(wording: Wording): InAppTemplate {
  return (data) => ({
    title: wording.title(data),
    body: wording.body(data),
    ...(data.actionUrl ? { link: data.actionUrl } : {}),
  });
}

const CHANNEL_KEYS: Readonly<Record<DeliveryChannel, keyof EventTemplates>> = {
  EMAIL: 'email',
  IN_APP: 'inApp',
};

function buildRegistry(): Record<string, EventTemplates> {
  const registry: Record<string, EventTemplates> = {};
  for (const [code, wording] of Object.entries(WORDINGS)) {
    const channels = channelsOf(code);
    registry[code] = {
      ...(channels.includes('EMAIL') ? { email: emailTemplate(wording) } : {}),
      ...(channels.includes('IN_APP') ? { inApp: inAppTemplate(wording) } : {}),
    };
  }
  return registry;
}

/**
 * The registry, by locale and event code. A template exists for exactly the channels the matrix
 * gives an event.
 */
export const TEMPLATE_REGISTRY: Readonly<
  Record<TemplateLocale, Readonly<Record<string, EventTemplates>>>
> = { en: buildRegistry() };

/** Event codes that have no code template yet, with the reason. Empty: every event has one. */
export const EVENTS_WITHOUT_TEMPLATE: Readonly<Record<string, string>> = {};

export function codeTemplates(
  eventCode: string,
  locale: TemplateLocale = DEFAULT_TEMPLATE_LOCALE,
): EventTemplates | undefined {
  return TEMPLATE_REGISTRY[locale][eventCode];
}

export function templateFor(
  eventCode: string,
  channel: DeliveryChannel,
  locale: TemplateLocale = DEFAULT_TEMPLATE_LOCALE,
): EmailTemplate | InAppTemplate | undefined {
  return codeTemplates(eventCode, locale)?.[CHANNEL_KEYS[channel]];
}
