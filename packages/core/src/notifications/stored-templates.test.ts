import { describe, expect, it } from 'vitest';
import {
  checkTemplateText,
  placeholdersOf,
  renderStoredEmail,
  renderStoredInApp,
} from './stored-templates.js';

describe('checkTemplateText', () => {
  it('accepts the whitelisted placeholders of the event, with or without spaces', () => {
    expect(
      checkTemplateText(
        'booking.accepted',
        'Booking {{bookingNo}} accepted',
        '{{ labName }} accepted it. Pay by {{deadline}}. {{actionUrl}}',
      ),
    ).toEqual({ ok: true });
    expect(
      checkTemplateText('payout.released', null, 'Paid {{amount}} to {{organisationName}}'),
    ).toEqual({
      ok: true,
    });
  });

  it('rejects a placeholder the event does not allow, including the otp', () => {
    const result = checkTemplateText('booking.accepted', 'Your code is {{otp}}', 'Hi {{reason}}');
    expect(result).toEqual({
      ok: false,
      problems: [
        '{{otp}} is not allowed for booking.accepted',
        '{{reason}} is not allowed for booking.accepted',
      ],
    });
  });

  it('rejects anything that is not a plain placeholder: helpers, blocks, raw output, typos', () => {
    for (const body of [
      '{{#if bookingNo}}x{{/if}}',
      '{{{bookingNo}}}',
      '{{bookingNo | upper}}',
      '{{> partial}}',
      '{{bookingNo',
      'bookingNo}}',
      '{{constructor.constructor("return 1")()}}',
    ]) {
      expect(checkTemplateText('booking.accepted', body).ok, body).toBe(false);
    }
  });

  it('rejects an unknown event', () => {
    expect(checkTemplateText('auth.otp', 'Code {{otp}}').ok).toBe(false);
  });

  it('lists placeholders in order', () => {
    expect(placeholdersOf('{{a}} and {{ b }} and {{a}}')).toEqual(['a', 'b', 'a']);
  });
});

describe('rendering a stored template', () => {
  const template = {
    version: 3,
    subject: 'Booking {{bookingNo}} accepted',
    body: '{{labName}} accepted booking {{bookingNo}}.\n\nOpen {{actionUrl}} now.',
  };

  it('substitutes values and escapes them in the HTML, linking the action URL', () => {
    const email = renderStoredEmail(
      template,
      {
        bookingNo: 'LC-1',
        labName: '<b>Lab</b> & Sons',
        actionUrl: 'https://app.test/bookings/1',
      },
      'fallback',
    );
    expect(email.subject).toBe('Booking LC-1 accepted');
    expect(email.text).toContain('<b>Lab</b> & Sons accepted booking LC-1.');
    expect(email.html).toContain('&lt;b&gt;Lab&lt;/b&gt; &amp; Sons');
    expect(email.html).not.toContain('<b>');
    expect(email.html).toContain(
      '<a href="https://app.test/bookings/1">https://app.test/bookings/1</a>',
    );
    expect(email.html.match(/<p>/g)).toHaveLength(2); // the two paragraphs (the footer has a style)
  });

  it('does not make a link of an action URL that is not http(s)', () => {
    const email = renderStoredEmail(template, { actionUrl: 'javascript:alert(1)' }, 'fallback');
    expect(email.html).not.toContain('<a ');
  });

  it('cannot be made to add a header line through a value', () => {
    const email = renderStoredEmail(
      template,
      { bookingNo: 'LC-1\r\nBcc: attacker@example.test' },
      'fallback',
    );
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it('leaves a missing value empty and uses the fallback subject when there is none', () => {
    const email = renderStoredEmail(
      { version: 1, subject: null, body: 'Hello{{labName}}.' },
      {},
      'Fallback',
    );
    expect(email.subject).toBe('Fallback');
    expect(email.text.startsWith('Hello.')).toBe(true);
  });

  it('renders the in-app form', () => {
    expect(renderStoredInApp(template, { bookingNo: 'LC-1', actionUrl: '/bookings/1' })).toEqual({
      title: 'Booking LC-1 accepted',
      body: ' accepted booking LC-1.\n\nOpen /bookings/1 now.',
      link: '/bookings/1',
    });
  });
});
