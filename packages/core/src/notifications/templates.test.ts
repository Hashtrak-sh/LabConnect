import { describe, expect, it } from 'vitest';
import { NOTIFICATION_EVENT_TYPES } from '../platform/routes.js';
import { channelsOf } from './rules.js';
import {
  codeTemplates,
  EVENT_VARIABLES,
  EVENTS_WITHOUT_TEMPLATE,
  TEMPLATE_REGISTRY,
  TEMPLATE_VARIABLES,
  type TemplateData,
  type TemplateVariable,
} from './templates.js';

const SAMPLE: Record<TemplateVariable, string> = {
  bookingNo: 'LC-2026-000123',
  labName: 'Precision Test Lab',
  organisationName: 'Acme Industries',
  deadline: '26 Nov 2026, 5:30 pm IST',
  reason: 'Capacity is full',
  amount: '₹12,34,567.89',
  actionUrl: 'https://app.labconnect.test/bookings/0190b1f2-0000-7000-8000-000000000001',
};

/** A value for each variable that cannot be mistaken for anything else, to see where it ends up. */
const MARKERS = Object.fromEntries(
  TEMPLATE_VARIABLES.map((name) => [name, `@@${name}@@`]),
) as Record<TemplateVariable, string>;

const eventCodes = [...NOTIFICATION_EVENT_TYPES].sort();

describe('the template registry', () => {
  it('has a template for every channel the matrix gives each event, or the event is on the explicit list', () => {
    for (const code of eventCodes) {
      if (code in EVENTS_WITHOUT_TEMPLATE) continue;
      const templates = codeTemplates(code);
      expect(templates, `${code} has no templates`).toBeDefined();
      const channels = channelsOf(code);
      expect(templates?.email !== undefined, `${code} email`).toBe(channels.includes('EMAIL'));
      expect(templates?.inApp !== undefined, `${code} in-app`).toBe(channels.includes('IN_APP'));
    }
  });

  it('has nothing for a code that is not a notification event', () => {
    expect(Object.keys(TEMPLATE_REGISTRY.en).sort()).toEqual(eventCodes);
    expect(Object.keys(EVENT_VARIABLES).sort()).toEqual(eventCodes);
  });

  it('keeps the "not yet" list honest: every entry is a real event and has a reason', () => {
    for (const [code, reason] of Object.entries(EVENTS_WITHOUT_TEMPLATE)) {
      expect(NOTIFICATION_EVENT_TYPES.has(code)).toBe(true);
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  it('is organised by locale, with only English filled', () => {
    expect(Object.keys(TEMPLATE_REGISTRY)).toEqual(['en']);
  });
});

describe.each(eventCodes)('%s', (code) => {
  const templates = codeTemplates(code);
  const allowed = EVENT_VARIABLES[code] ?? [];
  const full: TemplateData = Object.fromEntries(allowed.map((name) => [name, SAMPLE[name]]));

  it('renders every channel with a sample view model', () => {
    if (templates?.email) {
      const email = templates.email(full);
      expect(email.subject.length).toBeGreaterThan(3);
      expect(email.subject).not.toMatch(/[\r\n]/);
      expect(email.text).toContain(SAMPLE.actionUrl);
      expect(email.html).toContain('<a href="https://app.labconnect.test/bookings/');
      expect(email.text).not.toMatch(/undefined|\[object|\{\{/);
      expect(email.html).not.toMatch(/undefined|\[object|\{\{/);
      if (allowed.includes('bookingNo'))
        expect(email.subject + email.text).toContain(SAMPLE.bookingNo);
    }
    if (templates?.inApp) {
      const inApp = templates.inApp(full);
      expect(inApp.title.length).toBeGreaterThan(3);
      expect(inApp.body.length).toBeGreaterThan(3);
      expect(inApp.link).toBe(SAMPLE.actionUrl);
      expect(`${inApp.title} ${inApp.body}`).not.toMatch(/undefined|\[object|\{\{/);
    }
  });

  it('renders with no variables at all, with no gaps in the sentences', () => {
    for (const rendered of [templates?.email?.({}), templates?.inApp?.({})]) {
      if (!rendered) continue;
      const text = JSON.stringify(rendered);
      expect(text).not.toMatch(/undefined|\[object|\{\{|null/);
      expect(text).not.toMatch(/ {2}|\bby \./);
    }
  });

  it('uses only the variables its event allows', () => {
    const everything = MARKERS;
    const output = JSON.stringify([templates?.email?.(everything), templates?.inApp?.(everything)]);
    for (const name of TEMPLATE_VARIABLES) {
      if (!allowed.includes(name)) {
        expect(output, `${code} shows ${name}, which it does not allow`).not.toContain(
          MARKERS[name],
        );
      }
    }
  });

  it('escapes every value in HTML and keeps the subject on one line', () => {
    if (!templates?.email) return;
    const hostile = Object.fromEntries(
      allowed.map((name) => [
        name,
        name === 'actionUrl'
          ? 'https://app.test/x?a=1&b="2"><script>alert(1)</script>'
          : `<img src=x onerror=alert(1)>&"'${name}\r\nBcc: attacker@example.test`,
      ]),
    ) as TemplateData;
    const email = templates.email(hostile);
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<img');
    expect(email.html).not.toMatch(/href="[^"]*"[^>]*"/); // the quote in the URL cannot end the attribute early
    expect(email.html).toContain('&lt;');
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});

describe('what a message may contain', () => {
  it('has no variable for report content, an OTP, a token or bank details', () => {
    const joined = TEMPLATE_VARIABLES.join(' ').toLowerCase();
    for (const forbidden of [
      'otp',
      'code',
      'token',
      'password',
      'secret',
      'account',
      'ifsc',
      'report',
      'content',
      'phone',
      'email',
    ]) {
      expect(joined, forbidden).not.toContain(forbidden);
    }
    expect(Object.keys(EVENT_VARIABLES)).not.toContain('auth.otp');
  });

  it('never prints an OTP wording or personal contact details in any template', () => {
    for (const code of eventCodes) {
      const templates = codeTemplates(code);
      const text = JSON.stringify([
        templates?.email?.(SAMPLE),
        templates?.inApp?.(SAMPLE),
      ]).toLowerCase();
      expect(text, code).not.toMatch(/sign-in code|one-time|otp|password|@example/);
    }
  });
});
