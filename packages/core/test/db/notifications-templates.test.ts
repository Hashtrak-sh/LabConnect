import { seedReference } from '@labconnect/database/test-utils';
import { beforeAll, describe, expect, it } from 'vitest';
import { channelsOf, checkTemplateText, NOTIFICATION_EVENT_TYPES } from '../../src/index.js';
import { usePlatform } from './support.js';

// P3-08: the templates that the seed puts in `notification_template` agree with the renderer
// and with the matrix. If someone edits a seeded wording to use a variable the event does not
// allow, or drops a channel, this fails.

describe('the seeded notification templates', () => {
  const { db, owner } = usePlatform();

  beforeAll(async () => {
    await owner().$transaction((tx) => seedReference(tx), { timeout: 120_000 });
  }, 180_000);

  it('are all usable by the renderer and cover the channels of the matrix', async () => {
    const rows = (
      await db().query<{
        event_code: string;
        channel: string;
        subject: string | null;
        body: string;
      }>(
        `SELECT event_code, channel::text, subject, body FROM notification_template
          WHERE locale = 'en-IN' AND version = 1 AND event_code <> 'auth.otp'`,
      )
    ).rows;
    expect(rows.length).toBeGreaterThan(50);
    for (const row of rows) {
      expect(
        checkTemplateText(row.event_code, row.subject, row.body),
        `${row.event_code} ${row.channel}`,
      ).toEqual({
        ok: true,
      });
    }
    const seeded = new Map<string, string[]>();
    for (const row of rows) {
      seeded.set(row.event_code, [...(seeded.get(row.event_code) ?? []), row.channel].sort());
    }
    for (const code of NOTIFICATION_EVENT_TYPES) {
      expect(seeded.get(code), code).toEqual(channelsOf(code));
    }
  });
});
