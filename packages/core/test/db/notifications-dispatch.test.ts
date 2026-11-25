import { withDbContext } from '@labconnect/database';
import { addMember, createUser, uuidv7 } from '@labconnect/database/test-utils';
import { describe, expect, it } from 'vitest';
import {
  handleNotificationEvent,
  NotificationContextMissingError,
  NotificationInbox,
} from '../../src/index.js';
import { useNotifications } from './notifications-support.js';

// P3-08: an event becomes the right notification rows for the right users, once.

describe('handleNotificationEvent', () => {
  const t = useNotifications();

  it('writes in-app rows and queued emails for exactly the parties of the matrix', async () => {
    const { a, lab, siteMaker, platform } = t.world();
    const bookingId = t.booking();
    const event = t.event('booking.requested', bookingId);

    const result = await handleNotificationEvent(t.deps(), event);

    // Customer (requester): confirmation I,E. Makers of the site: new request I. Checker: Decide I,E (action).
    expect(t.summary(await t.rowsOf(event.id))).toEqual(
      [
        t.key(a.requester, 'IN_APP', 'SENT'),
        t.key(a.requester, 'EMAIL', 'QUEUED'),
        t.key(lab.maker, 'IN_APP', 'SENT'),
        t.key(siteMaker.userId, 'IN_APP', 'SENT'),
        t.key(lab.checker, 'IN_APP', 'SENT'),
        t.key(lab.checker, 'EMAIL', 'QUEUED'),
      ].sort(),
    );
    expect(result).toEqual({
      status: 'processed',
      recipients: 4,
      inApp: 4,
      emailQueued: 2,
      suppressed: 0,
    });

    const rows = await t.rowsOf(event.id);
    const checkerEmail = rows.find(
      (row) => row.recipient_user_id === lab.checker && row.channel === 'EMAIL',
    );
    expect(checkerEmail?.is_action_required).toBe(true);
    expect(
      rows.find((row) => row.recipient_user_id === a.requester && row.channel === 'EMAIL')
        ?.is_action_required,
    ).toBe(false);
    // The platform team is not a party of this event.
    expect(rows.map((row) => row.recipient_user_id)).not.toContain(platform.ops);
    // The in-app row is delivered at once, with the view model and ids only.
    const inApp = rows.find(
      (row) => row.recipient_user_id === a.requester && row.channel === 'IN_APP',
    );
    expect(inApp?.sent_at).toEqual(t.clock.now());
    expect(inApp?.organisation_id).toBe(a.organisationId);
    expect(inApp?.payload).toMatchObject({
      bookingId,
      labName: 'DEMO Lab',
      actionUrl: `/bookings/${bookingId}`,
    });
    expect(JSON.stringify(inApp?.payload)).not.toMatch(/@example\.test/);
  });

  it('is limited to the lab site: a Maker of another site is not told', async () => {
    const { lab, siteMaker } = t.world();
    const bookingId = t.booking({
      lab: { organisationId: lab.organisationId, siteId: lab.siteIds[1] },
    });
    const event = t.event('booking.requested', bookingId);
    await handleNotificationEvent(t.deps(), event);
    const users = (await t.rowsOf(event.id)).map((row) => row.recipient_user_id);
    expect(users).toContain(lab.maker);
    expect(users).not.toContain(siteMaker.userId);
  });

  it('gives nothing to another organisation, whatever its users hold', async () => {
    const { a, b, lab } = t.world();
    // A second lab with a Maker and a Checker who hold the right roles but in the wrong organisation.
    const other = await t.owner(async (tx) => {
      const organisationId = uuidv7();
      await tx.organisation.create({
        data: {
          id: organisationId,
          orgType: 'LAB',
          legalName: 'DEMO Other Lab',
          displayName: 'DEMO Other Lab',
          claimStatus: 'CLAIMED',
          kycStatus: 'VERIFIED',
        },
      });
      const maker = await createUser(tx, {
        email: `other.maker.${uuidv7().slice(-8)}@example.test`,
        fullName: 'Other Maker',
      });
      const checker = await createUser(tx, {
        email: `other.checker.${uuidv7().slice(-8)}@example.test`,
        fullName: 'Other Checker',
      });
      await addMember(tx, maker, organisationId, 'LAB_MAKER');
      await addMember(tx, checker, organisationId, 'LAB_CHECKER');
      return { maker, checker };
    });

    // The requester left the customer organisation, so the admins of that organisation are told instead.
    await t.owner((tx) =>
      tx.membership.updateMany({
        where: { userId: a.requester, organisationId: a.organisationId },
        data: { status: 'DEACTIVATED', deactivatedAt: new Date() },
      }),
    );
    try {
      const bookingId = t.booking({ lab: { organisationId: lab.organisationId } });
      const event = t.event('booking.requested', bookingId);
      await handleNotificationEvent(t.deps(), event);
      const users = (await t.rowsOf(event.id)).map((row) => row.recipient_user_id);
      expect(users).toContain(a.admin);
      expect(users).toContain(lab.maker);
      expect(users).toContain(lab.checker);
      for (const stranger of [
        b.admin,
        b.requester,
        b.finance,
        other.maker,
        other.checker,
        a.finance,
      ]) {
        expect(users, `${stranger} must not be told`).not.toContain(stranger);
      }
      expect(users).not.toContain(a.requester); // no longer a member
    } finally {
      await t.owner((tx) =>
        tx.membership.updateMany({
          where: { userId: a.requester, organisationId: a.organisationId },
          data: { status: 'ACTIVE', deactivatedAt: null },
        }),
      );
    }
  });

  it('does not tell a disabled user or a user whose role was revoked', async () => {
    const { lab } = t.world();
    const extra = await t.owner(async (tx) => {
      const disabled = await createUser(tx, {
        email: `disabled.${uuidv7().slice(-8)}@example.test`,
        fullName: 'Disabled Checker',
      });
      const revoked = await createUser(tx, {
        email: `revoked.${uuidv7().slice(-8)}@example.test`,
        fullName: 'Revoked Checker',
      });
      const first = lab.siteIds[0];
      await addMember(tx, disabled, lab.organisationId, 'LAB_CHECKER', [first]);
      const membership = await addMember(tx, revoked, lab.organisationId, 'LAB_CHECKER', [first]);
      await tx.appUser.update({ where: { id: disabled }, data: { status: 'DISABLED' } });
      await tx.membershipRole.updateMany({
        where: { membershipId: membership },
        data: { revokedAt: new Date() },
      });
      return { disabled, revoked };
    });
    const bookingId = t.booking();
    const event = t.event('booking.requested', bookingId);
    await handleNotificationEvent(t.deps(), event);
    const users = (await t.rowsOf(event.id)).map((row) => row.recipient_user_id);
    expect(users).toContain(lab.checker);
    expect(users).not.toContain(extra.disabled);
    expect(users).not.toContain(extra.revoked);
  });

  it('handles a duplicate delivery of an event once', async () => {
    const bookingId = t.booking();
    const event = t.event('booking.accepted', bookingId, { deadlineAt: '2026-11-26T12:00:00Z' });
    const first = await handleNotificationEvent(t.deps(), event);
    const second = await handleNotificationEvent(t.deps(), event);
    const third = await handleNotificationEvent(t.deps(), event);
    expect(first.status).toBe('processed');
    expect(second).toEqual({ status: 'duplicate' });
    expect(third).toEqual({ status: 'duplicate' });
    expect((await t.rowsOf(event.id)).length).toBe(2); // requester: in-app and email
    const rows = await t.rowsOf(event.id);
    expect(rows[0]?.payload).toMatchObject({ deadline: '26 Nov 2026, 5:30 pm IST' });
  });

  it('survives two deliveries racing on one event', async () => {
    const bookingId = t.booking();
    const event = t.event('booking.accepted', bookingId);
    const results = await Promise.all([
      handleNotificationEvent(t.deps(), event),
      handleNotificationEvent(t.deps(), event),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['duplicate', 'processed']);
    expect((await t.rowsOf(event.id)).length).toBe(2);
  });

  it('keeps a failed event retryable: nothing is stored and it is not marked processed', async () => {
    const event = t.event('booking.accepted', uuidv7()); // no context for this booking
    await expect(handleNotificationEvent(t.deps(), event)).rejects.toBeInstanceOf(
      NotificationContextMissingError,
    );
    expect(await t.rowsOf(event.id)).toEqual([]);
    const processed = await t
      .db()
      .query('SELECT 1 FROM processed_event WHERE consumer = $1 AND event_id = $2', [
        'notifications',
        event.id,
      ]);
    expect(processed.rowCount).toBe(0);
  });

  it('ignores an event that is not a notification event', async () => {
    const result = await handleNotificationEvent(t.deps(), t.event('file.available', uuidv7()));
    expect(result).toEqual({ status: 'ignored' });
  });

  it('applies the conditions of the matrix to the Ops cells', async () => {
    const { platform } = t.world();
    const bookingId = t.booking();
    const early = t.event('booking.sla_reminder', bookingId, { percent: 50 });
    const late = t.event('booking.sla_reminder', bookingId, { percent: 90 });
    await handleNotificationEvent(t.deps(), early);
    await handleNotificationEvent(t.deps(), late);
    expect((await t.rowsOf(early.id)).map((row) => row.recipient_user_id)).not.toContain(
      platform.ops,
    );
    const lateRows = await t.rowsOf(late.id);
    expect(t.summary(lateRows)).toContain(t.key(platform.ops, 'IN_APP', 'SENT'));
    // The Ops user is a member of the platform organisation, and the row says so.
    expect(lateRows.find((row) => row.recipient_user_id === platform.ops)?.organisation_id).toBe(
      platform.organisationId,
    );
  });

  it('sends an invitation by email only, to the invited user', async () => {
    const { a } = t.world();
    const invitee = await t.owner(async (tx) => {
      const userId = await createUser(tx, {
        email: `invitee.${uuidv7().slice(-8)}@example.test`,
        fullName: 'Invitee',
      });
      await tx.appUser.update({ where: { id: userId }, data: { status: 'INVITED' } });
      return userId;
    });
    const aggregateId = uuidv7();
    t.context.set(aggregateId, {
      organisationName: 'DEMO Customer A',
      actionPath: '/sign-in',
      invitee: { userId: invitee, organisationId: a.organisationId },
    });
    const event = t.event('user.invited', aggregateId);
    await handleNotificationEvent(t.deps(), event);
    expect(t.summary(await t.rowsOf(event.id))).toEqual([t.key(invitee, 'EMAIL', 'QUEUED')]);
    expect((await t.rowsOf(event.id))[0]?.is_action_required).toBe(true);
  });

  it('handles an event for several customers (accreditation change)', async () => {
    const { a, b, lab } = t.world();
    const aggregateId = uuidv7();
    t.context.set(aggregateId, {
      labName: 'DEMO Lab',
      customers: [
        { organisationId: a.organisationId, userIds: [a.requester] },
        { organisationId: b.organisationId, userIds: [b.requester] },
      ],
      lab: { organisationId: lab.organisationId },
    });
    const event = t.event('accreditation.changed', aggregateId);
    await handleNotificationEvent(t.deps(), event);
    const users = (await t.rowsOf(event.id)).map((row) => row.recipient_user_id);
    expect(users).toEqual(expect.arrayContaining([a.requester, b.requester, lab.checker]));
    expect(users).not.toContain(a.admin);
    expect(users).not.toContain(b.admin);
  });

  describe('mute settings', () => {
    const preferences = (
      userId: string,
      items: { eventCode: string; channel: 'EMAIL' | 'IN_APP'; muted: boolean }[],
    ) =>
      withDbContext(t.api(), { kind: 'tenant', orgId: '', userId }, (tx) =>
        new NotificationInbox(tx, userId, t.clock).setPreferences(items),
      );

    it('suppresses a muted optional notification and ignores a mute of an action-required one', async () => {
      const { a, lab } = t.world();
      await preferences(a.requester, [
        { eventCode: 'booking.requested', channel: 'IN_APP', muted: true },
        { eventCode: 'booking.requested', channel: 'EMAIL', muted: true },
      ]);
      await preferences(lab.checker, [
        { eventCode: 'booking.requested', channel: 'EMAIL', muted: true },
        { eventCode: 'booking.requested', channel: 'IN_APP', muted: true },
      ]);
      await preferences(lab.maker, [
        { eventCode: 'booking.requested', channel: 'IN_APP', muted: true },
      ]);

      const event = t.event('booking.requested', t.booking());
      const result = await handleNotificationEvent(t.deps(), event);
      const rows = await t.rowsOf(event.id);

      // Optional for the customer: both channels suppressed. Action-required for the Checker: delivered.
      expect(t.summary(rows)).toEqual(
        expect.arrayContaining([
          t.key(a.requester, 'IN_APP', 'SUPPRESSED'),
          t.key(a.requester, 'EMAIL', 'SUPPRESSED'),
          t.key(lab.maker, 'IN_APP', 'SUPPRESSED'),
          t.key(lab.checker, 'IN_APP', 'SENT'),
          t.key(lab.checker, 'EMAIL', 'QUEUED'),
        ]),
      );
      expect(result).toMatchObject({ suppressed: 3 });
      // A suppressed row keeps no payload.
      expect(
        rows
          .filter((row) => row.status === 'SUPPRESSED')
          .every((row) => Object.keys(row.payload).length === 0),
      ).toBe(true);
    });

    it('mutes one event and one channel only', async () => {
      const { a } = t.world();
      const event = t.event('booking.rejected', t.booking());
      await preferences(a.requester, [
        { eventCode: 'booking.rejected', channel: 'EMAIL', muted: true },
      ]);
      await handleNotificationEvent(t.deps(), event);
      expect(t.summary(await t.rowsOf(event.id))).toEqual(
        [t.key(a.requester, 'EMAIL', 'SUPPRESSED'), t.key(a.requester, 'IN_APP', 'SENT')].sort(),
      );
      // Another event of the same user is untouched.
      const other = t.event('booking.expired', t.booking());
      await handleNotificationEvent(t.deps(), other);
      expect(t.summary(await t.rowsOf(other.id))).toContain(t.key(a.requester, 'EMAIL', 'QUEUED'));
    });
  });

  describe('templates in the database', () => {
    it('records the seeded version, and a newer valid version once an administrator adds one', async () => {
      const seeded = await t.db().query<{ version: number }>(
        `SELECT max(version) AS version FROM notification_template
            WHERE event_code = 'booking.countered' AND channel = 'EMAIL' AND locale = 'en-IN'`,
      );
      expect(seeded.rows[0]?.version).toBe(1);

      const first = t.event('booking.countered', t.booking());
      await handleNotificationEvent(t.deps(), first);
      expect(
        (await t.rowsOf(first.id))
          .filter((row) => row.status !== 'SUPPRESSED')
          .every((row) => row.template_version === 1),
      ).toBe(true);

      await t.db().query(
        `INSERT INTO notification_template (id, event_code, channel, locale, version, subject, body, status)
         VALUES ($1, 'booking.countered', 'EMAIL', 'en-IN', 2, 'Declined: {{bookingNo}}', 'Sorry. {{actionUrl}}', 'ACTIVE')`,
        [uuidv7()],
      );
      const second = t.event('booking.countered', t.booking());
      await handleNotificationEvent(t.deps(), second);
      const rows = await t.rowsOf(second.id);
      expect(rows.find((row) => row.channel === 'EMAIL')?.template_version).toBe(2);
      expect(rows.find((row) => row.channel === 'IN_APP')?.template_version).toBe(1);

      // A newer version that uses a variable the event does not allow is not used: the code template is.
      await t.db().query(
        `INSERT INTO notification_template (id, event_code, channel, locale, version, subject, body, status)
         VALUES ($1, 'booking.countered', 'EMAIL', 'en-IN', 3, 'Code {{otp}}', 'Your code {{otp}}', 'ACTIVE')`,
        [uuidv7()],
      );
      const third = t.event('booking.countered', t.booking());
      await handleNotificationEvent(t.deps(), third);
      expect(
        (await t.rowsOf(third.id)).find((row) => row.channel === 'EMAIL')?.template_version,
      ).toBe(0);
    });
  });
});
