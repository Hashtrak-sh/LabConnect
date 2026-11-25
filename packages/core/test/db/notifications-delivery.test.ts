import { uuidv7 } from '@labconnect/database/test-utils';
import { describe, expect, it } from 'vitest';
import {
  backoffMs,
  type DeliveryOptions,
  type EmailMessage,
  EmailSendError,
  handleNotificationEvent,
  InMemoryEmailSender,
  runEmailDeliveries,
} from '../../src/index.js';
import { gate } from './support.js';
import { useNotifications } from './notifications-support.js';

// P3-08: the delivery step sends each queued email once, retries failures, and stops at a cap.

const WEB = 'https://app.labconnect.test';

describe('runEmailDeliveries', () => {
  const t = useNotifications();

  const run = (sender: InMemoryEmailSender, options?: DeliveryOptions) =>
    runEmailDeliveries(
      { prisma: t.worker(), clock: t.clock, sender, webBaseUrl: WEB },
      { batchSize: 100, ...options },
    );

  /** Sends whatever is waiting, so that a test starts with an empty queue. */
  const drain = async (): Promise<void> => {
    t.clock.advance(24 * 60 * 60 * 1000);
    await run(new InMemoryEmailSender(), { maxAttempts: 100 });
  };

  /** Events that each queue exactly one email, for the requester of booking A. */
  const queueEmails = async (count: number, type = 'booking.accepted'): Promise<string[]> => {
    const ids: string[] = [];
    for (let n = 0; n < count; n += 1) {
      const event = t.event(type, t.booking(), { deadlineAt: '2026-11-26T12:00:00Z' });
      await handleNotificationEvent(t.deps(), event);
      const row = (await t.rowsOf(event.id)).find((candidate) => candidate.channel === 'EMAIL');
      expect(row?.status).toBe('QUEUED');
      const id = await t
        .db()
        .query<{ id: string }>(
          `SELECT id::text FROM notification WHERE event_id = $1::uuid AND channel = 'EMAIL'`,
          [event.id],
        );
      ids.push(id.rows[0]?.id ?? '');
    }
    return ids;
  };

  const rowOf = async (id: string) =>
    (
      await t.db().query<{
        status: string;
        delivery_attempts: number;
        next_attempt_at: Date | null;
        error: string | null;
        provider_message_id: string | null;
        sent_at: Date | null;
      }>(
        `SELECT status::text, delivery_attempts, next_attempt_at, error, provider_message_id, sent_at
           FROM notification WHERE id = $1::uuid`,
        [id],
      )
    ).rows[0];

  const emailOf = async (userId: string): Promise<string> =>
    (
      await t
        .db()
        .query<{ email: string }>('SELECT email::text FROM app_user WHERE id = $1', [userId])
    ).rows[0]?.email ?? '';

  it('sends each queued email once, to the recipient, and marks it sent', async () => {
    await drain();
    const { a, lab } = t.world();
    const event = t.event('booking.requested', t.booking({ labName: 'Lab <b>One</b>' }));
    await handleNotificationEvent(t.deps(), event);
    const sender = new InMemoryEmailSender();

    const result = await run(sender);
    expect(result).toEqual({ sent: 2, retried: 0, failed: 0, suppressed: 0 });
    const to = sender.sent.map((message) => message.to).sort();
    expect(to).toEqual([await emailOf(a.requester), await emailOf(lab.checker)].sort());

    const message = sender.sent.find((candidate) => candidate.to === to[0]) as EmailMessage;
    expect(message.subject).toMatch(/^Booking LC-2026-[0-9A-F]{6} requested$/);
    expect(message.text).toContain(`${WEB}/bookings/`);
    expect(message.html).toContain(`<a href="${WEB}/bookings/`);
    expect(message.html).toContain('Lab &lt;b&gt;One&lt;/b&gt;');
    expect(message.html).not.toContain('<b>One');
    // Ids only in the link; nothing that identifies a person besides the address it is sent to.
    expect(message.text).not.toMatch(/@example\.test/);

    const queued = (await t.rowsOf(event.id)).filter((row) => row.channel === 'EMAIL');
    expect(
      queued.every(
        (row) => row.status === 'SENT' && row.provider_message_id?.startsWith('memory-'),
      ),
    ).toBe(true);
    expect(queued.every((row) => row.delivery_attempts === 1 && row.next_attempt_at === null)).toBe(
      true,
    );

    // Nothing is sent again: not by the next pass, not much later.
    const again = new InMemoryEmailSender();
    expect(await run(again)).toEqual({ sent: 0, retried: 0, failed: 0, suppressed: 0 });
    t.clock.advance(7 * 24 * 60 * 60 * 1000);
    expect(await run(again)).toEqual({ sent: 0, retried: 0, failed: 0, suppressed: 0 });
    expect(again.sent).toEqual([]);
  });

  it('retries a failed send after a backoff and records only the kind of error', async () => {
    await drain();
    const [id = ''] = await queueEmails(1);
    const failing = new InMemoryEmailSender();
    failing.onSend = (message) => {
      throw new Error(`smtp refused ${message.to}: ${message.subject}`);
    };

    expect(await run(failing)).toEqual({ sent: 0, retried: 1, failed: 0, suppressed: 0 });
    const first = await rowOf(id);
    expect(first).toMatchObject({ status: 'QUEUED', delivery_attempts: 1 });
    expect(first?.next_attempt_at).toEqual(new Date(t.clock.now().getTime() + backoffMs(1)));
    // The error names its kind. It holds neither the address nor the subject nor a body.
    expect(first?.error).toBe('Error: the send failed');

    // Not due yet: the next pass leaves it alone.
    expect(await run(failing)).toEqual({ sent: 0, retried: 0, failed: 0, suppressed: 0 });

    t.clock.advance(backoffMs(1));
    const working = new InMemoryEmailSender();
    expect(await run(working)).toEqual({ sent: 1, retried: 0, failed: 0, suppressed: 0 });
    expect(await rowOf(id)).toMatchObject({
      status: 'SENT',
      delivery_attempts: 2,
      next_attempt_at: null,
      error: null,
    });
    expect(working.sent).toHaveLength(1);
  });

  it('stops at the attempt cap and leaves the row FAILED', async () => {
    await drain();
    const [id = ''] = await queueEmails(1);
    const failing = new InMemoryEmailSender();
    failing.onSend = () => {
      throw new EmailSendError('provider unavailable', false);
    };
    const options = { maxAttempts: 3 };

    expect(await run(failing, options)).toMatchObject({ retried: 1, failed: 0 });
    t.clock.advance(backoffMs(1));
    expect(await run(failing, options)).toMatchObject({ retried: 1, failed: 0 });
    t.clock.advance(backoffMs(2));
    expect(await run(failing, options)).toMatchObject({ retried: 0, failed: 1 });
    expect(await rowOf(id)).toMatchObject({
      status: 'FAILED',
      delivery_attempts: 3,
      next_attempt_at: null,
      error: 'EmailSendError: provider unavailable',
    });

    t.clock.advance(24 * 60 * 60 * 1000);
    expect(await run(failing, options)).toEqual({ sent: 0, retried: 0, failed: 0, suppressed: 0 });
  });

  it('does not retry a message the provider refused for good', async () => {
    await drain();
    const [id = ''] = await queueEmails(1);
    const refusing = new InMemoryEmailSender();
    refusing.onSend = () => {
      throw new EmailSendError('address rejected', true);
    };
    expect(await run(refusing)).toMatchObject({ retried: 0, failed: 1 });
    expect(await rowOf(id)).toMatchObject({ status: 'FAILED', delivery_attempts: 1 });
  });

  it('has two workers sharing a queue and never sends one email twice', async () => {
    await drain();
    const ids = await queueEmails(8);
    const sender = new InMemoryEmailSender();
    sender.onSend = async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    };

    const [one, two] = await Promise.all([run(sender), run(sender)]);
    expect(one.sent + two.sent).toBe(8);
    expect(one.sent).toBeGreaterThan(0);
    expect(two.sent).toBeGreaterThan(0);
    const notificationIds = sender.sent.map((message) => message.notificationId);
    expect(new Set(notificationIds).size).toBe(8);
    expect([...notificationIds].sort()).toEqual([...ids].sort());
    for (const id of ids)
      expect(await rowOf(id)).toMatchObject({ status: 'SENT', delivery_attempts: 1 });
  });

  it('keeps a second worker off a row that is being sent', async () => {
    await drain();
    const [id = ''] = await queueEmails(1);
    const slow = new InMemoryEmailSender();
    const reached = gate();
    const release = gate();
    slow.onSend = async () => {
      reached.open();
      await release.wait;
    };

    const first = run(slow);
    await reached.wait; // the first worker holds the claim and is inside the send
    const fast = new InMemoryEmailSender();
    expect(await run(fast)).toEqual({ sent: 0, retried: 0, failed: 0, suppressed: 0 });
    expect(fast.sent).toEqual([]);
    release.open();
    expect(await first).toMatchObject({ sent: 1 });
    expect(slow.sent).toHaveLength(1);
    expect(await rowOf(id)).toMatchObject({ status: 'SENT', delivery_attempts: 1 });
  });

  it('sends again only after the lease of a claim that never finished (the at-least-once edge)', async () => {
    await drain();
    const [id = ''] = await queueEmails(1);
    // A worker claimed the row, sent the email and died before marking it: attempt counted, lease set.
    const leaseEnds = new Date(t.clock.now().getTime() + 10 * 60 * 1000);
    await t
      .db()
      .query(
        'UPDATE notification SET delivery_attempts = 1, next_attempt_at = $2 WHERE id = $1::uuid',
        [id, leaseEnds],
      );
    const sender = new InMemoryEmailSender();
    expect(await run(sender)).toMatchObject({ sent: 0 });
    t.clock.advance(10 * 60 * 1000);
    expect(await run(sender)).toMatchObject({ sent: 1 });
    expect(sender.sent).toHaveLength(1); // the documented duplicate
    expect(await rowOf(id)).toMatchObject({ status: 'SENT', delivery_attempts: 2 });
  });

  it('gives up on a row whose attempts were used up by crashes, without sending', async () => {
    await drain();
    const [id = ''] = await queueEmails(1);
    await t.db().query('UPDATE notification SET delivery_attempts = 5 WHERE id = $1::uuid', [id]);
    const sender = new InMemoryEmailSender();
    expect(await run(sender, { maxAttempts: 5 })).toMatchObject({ sent: 0, failed: 1 });
    expect(sender.sent).toEqual([]);
    expect(await rowOf(id)).toMatchObject({ status: 'FAILED' });
  });

  it('does not send to a user who is disabled', async () => {
    await drain();
    const { a } = t.world();
    const [id = ''] = await queueEmails(1);
    await t
      .db()
      .query(`UPDATE app_user SET status = 'DISABLED' WHERE id = $1::uuid`, [a.requester]);
    try {
      const sender = new InMemoryEmailSender();
      expect(await run(sender)).toEqual({ sent: 0, retried: 0, failed: 0, suppressed: 1 });
      expect(sender.sent).toEqual([]);
      expect(await rowOf(id)).toMatchObject({ status: 'SUPPRESSED', delivery_attempts: 0 });
    } finally {
      await t
        .db()
        .query(`UPDATE app_user SET status = 'ACTIVE' WHERE id = $1::uuid`, [a.requester]);
    }
  });

  it('renders the stored version a notification recorded, and the code template when it recorded none', async () => {
    await drain();
    await t.db().query(
      `INSERT INTO notification_template (id, event_code, channel, locale, version, subject, body, status)
       VALUES ($1, 'booking.expired', 'EMAIL', 'en-IN', 2, 'Lapsed {{bookingNo}}', 'It lapsed. See {{actionUrl}}', 'ACTIVE')`,
      [uuidv7()],
    );
    const [stored = ''] = await queueEmails(1, 'booking.expired');
    // A row that recorded the code template (version 0), as when no stored version was usable.
    const [code = ''] = await queueEmails(1, 'booking.expired');
    await t.db().query('UPDATE notification SET template_version = 0 WHERE id = $1::uuid', [code]);

    const sender = new InMemoryEmailSender();
    expect(await run(sender)).toMatchObject({ sent: 2 });
    const byId = new Map(sender.sent.map((message) => [message.notificationId, message]));
    expect(byId.get(stored)?.subject).toMatch(/^Lapsed LC-2026-/);
    expect(byId.get(stored)?.text).toContain(`It lapsed. See ${WEB}/bookings/`);
    expect(byId.get(code)?.subject).toMatch(/^Booking LC-2026-[0-9A-F]{6} expired$/);
  });
});
