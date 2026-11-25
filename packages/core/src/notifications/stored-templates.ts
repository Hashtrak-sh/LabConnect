import type { Prisma } from '@labconnect/database';
import { clipText, escapeHtml, singleLine } from './format.js';
import type { DeliveryChannel } from './rules.js';
import {
  codeTemplates,
  EMAIL_FOOTER,
  type EmailContent,
  EVENT_VARIABLES,
  type InAppContent,
  type TemplateData,
  type TemplateVariable,
} from './templates.js';

// Templates that platform staff edit live in `notification_template` (SCHEMA_SPECIFICATION 12.1,
// NOTIFICATIONS.md section 3). Each version is immutable; the newest ACTIVE version of an event,
// channel and locale is the one used, the code template is the fallback. The text is
// "Handlebars-style" in the schema; only the simple `{{name}}` form exists here: no helpers, no
// blocks, no code, and only the variables the event allows. Anything else makes the version
// unusable, so one bad edit cannot stop notifications: the code template takes over (OQ-143).

/** The locale the seeded rows have and the only one the consumer asks for until Hindi is decided (OQ-13). */
export const STORED_TEMPLATE_LOCALE = 'en-IN';

/** `template_version` of a notification that used the code template. Stored versions start at 1. */
export const CODE_TEMPLATE_VERSION = 0;

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export interface StoredTemplate {
  version: number;
  subject: string | null;
  body: string;
}

/** The placeholder names a text uses, in order, with repeats. */
export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '');
}

export type TemplateCheck = { ok: true } | { ok: false; problems: string[] };

/**
 * Whether a stored text may be rendered for the event: every placeholder is on the event's
 * allow-list and no other `{{` or `}}` is left over (which would be a helper, a block or a typo).
 */
export function checkTemplateText(eventCode: string, ...texts: (string | null)[]): TemplateCheck {
  const allowed: readonly string[] | undefined = EVENT_VARIABLES[eventCode];
  const problems: string[] = [];
  if (!allowed) return { ok: false, problems: [`${eventCode} is not a notification event`] };
  for (const text of texts) {
    if (text === null) continue;
    for (const name of placeholdersOf(text)) {
      if (!allowed.includes(name)) problems.push(`{{${name}}} is not allowed for ${eventCode}`);
    }
    if (/[{}]/.test(text.replace(PLACEHOLDER, ''))) {
      problems.push('only simple {{name}} placeholders are supported');
    }
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems: [...new Set(problems)] };
}

function substitute(text: string, data: TemplateData, escape: (value: string) => string): string {
  return text.replace(PLACEHOLDER, (_, name: string) =>
    escape(data[name as TemplateVariable] ?? ''),
  );
}

const identity = (value: string): string => value;

/**
 * Renders a stored email template. The text is plain; the HTML is built from the same text with
 * every part escaped, and the action URL (the one value that is a link) becomes an anchor only
 * when it is an http(s) URL.
 */
export function renderStoredEmail(
  template: StoredTemplate,
  data: TemplateData,
  fallbackSubject: string,
): EmailContent {
  const subject = singleLine(
    substitute(template.subject ?? fallbackSubject, data, (value) => singleLine(value)),
  );
  const body = substitute(template.body, data, identity).trim();
  const link = data.actionUrl && /^https?:\/\//.test(data.actionUrl) ? data.actionUrl : undefined;
  const paragraph = (text: string): string => {
    const escaped = escapeHtml(text).replaceAll('\n', '<br>');
    if (!link) return `<p>${escaped}</p>`;
    const target = escapeHtml(link);
    const anchor = `<a href="${target}">${target}</a>`;
    return `<p>${escaped.replaceAll(target, () => anchor)}</p>`;
  };
  const html = [
    '<!doctype html><html><body style="font-family:sans-serif;line-height:1.5;color:#1a1a1a">',
    ...body
      .split(/\n{2,}/)
      .filter((part) => part.trim() !== '')
      .map(paragraph),
    `<hr><p style="font-size:12px;color:#555">${escapeHtml(EMAIL_FOOTER)}</p>`,
    '</body></html>',
  ].join('');
  return { subject, text: [body, '--', EMAIL_FOOTER].join('\n\n'), html };
}

export function renderStoredInApp(template: StoredTemplate, data: TemplateData): InAppContent {
  return {
    title: clipText(substitute(template.subject ?? '', data, identity), 200),
    body: substitute(template.body, data, identity),
    ...(data.actionUrl ? { link: data.actionUrl } : {}),
  };
}

/**
 * The newest ACTIVE stored version that is safe to render, or `null` (none, or the newest
 * usable one does not pass `checkTemplateText`: then the code template is used).
 */
export async function latestStoredTemplate(
  tx: Prisma.TransactionClient,
  eventCode: string,
  channel: DeliveryChannel,
  locale: string = STORED_TEMPLATE_LOCALE,
): Promise<StoredTemplate | null> {
  const rows = await tx.notificationTemplate.findMany({
    where: { eventCode, channel: channel, locale, status: 'ACTIVE' },
    orderBy: { version: 'desc' },
    take: 1,
    select: { version: true, subject: true, body: true },
  });
  const newest = rows[0];
  if (!newest) return null;
  return checkTemplateText(eventCode, newest.subject, newest.body).ok ? newest : null;
}

/** One exact version, as recorded on a notification. Content never changes, so this renders what was chosen at event time. */
export async function storedTemplateVersion(
  tx: Prisma.TransactionClient,
  eventCode: string,
  channel: DeliveryChannel,
  version: number,
  locale: string = STORED_TEMPLATE_LOCALE,
): Promise<StoredTemplate | null> {
  const row = await tx.notificationTemplate.findUnique({
    where: {
      eventCode_channel_locale_version: {
        eventCode,
        channel: channel,
        locale,
        version,
      },
    },
    select: { version: true, subject: true, body: true },
  });
  if (!row) return null;
  return checkTemplateText(eventCode, row.subject, row.body).ok ? row : null;
}

/**
 * The email for a notification: the stored version it recorded, else the code template. `null`
 * if the event has no email template at all.
 */
export async function renderEmailFor(
  tx: Prisma.TransactionClient,
  input: { eventCode: string; templateVersion: number; data: TemplateData },
): Promise<{ content: EmailContent; source: 'stored' | 'code' } | null> {
  const code = codeTemplates(input.eventCode)?.email;
  if (input.templateVersion > CODE_TEMPLATE_VERSION) {
    const stored = await storedTemplateVersion(tx, input.eventCode, 'EMAIL', input.templateVersion);
    if (stored) {
      const fallback = code ? code(input.data).subject : 'LabConnect notification';
      return { content: renderStoredEmail(stored, input.data, fallback), source: 'stored' };
    }
  }
  return code ? { content: code(input.data), source: 'code' } : null;
}
