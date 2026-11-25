import { withDbContext } from '@labconnect/database';
import { describe, expect, it } from 'vitest';
import { processOnce } from '../../src/index.js';
import { gate, usePlatform, uuid } from './support.js';

// P3-01: idempotent consumption through processed_event.

describe('processOnce', () => {
  const { worker, db } = usePlatform();
  const system = { kind: 'system' } as const;

  const recorded = async (consumer: string, eventId: string) =>
    (
      await db().query('SELECT 1 FROM processed_event WHERE consumer = $1 AND event_id = $2', [
        consumer,
        eventId,
      ])
    ).rowCount;

  it('runs the work once and skips a duplicate delivery', async () => {
    const eventId = uuid();
    let runs = 0;
    const deliver = () =>
      withDbContext(worker(), system, (tx) =>
        processOnce(tx, 'notifications', eventId, () => {
          runs += 1;
          return Promise.resolve('done');
        }),
      );
    expect(await deliver()).toEqual({ processed: true, result: 'done' });
    expect(await deliver()).toEqual({ processed: false });
    expect(runs).toBe(1);
    expect(await recorded('notifications', eventId)).toBe(1);
  });

  it('keeps consumers apart: the same event is processed once per consumer', async () => {
    const eventId = uuid();
    const run = (consumer: string) =>
      withDbContext(worker(), system, (tx) =>
        processOnce(tx, consumer, eventId, () => Promise.resolve(consumer)),
      );
    expect((await run('search')).processed).toBe(true);
    expect((await run('analytics')).processed).toBe(true);
    expect((await run('search')).processed).toBe(false);
  });

  it('rolls the record back with the work, so a failed delivery can be retried', async () => {
    const eventId = uuid();
    await expect(
      withDbContext(worker(), system, (tx) =>
        processOnce(tx, 'notifications', eventId, () =>
          Promise.reject(new Error('mail server down')),
        ),
      ),
    ).rejects.toThrow('mail server down');
    expect(await recorded('notifications', eventId)).toBe(0);

    const retry = await withDbContext(worker(), system, (tx) =>
      processOnce(tx, 'notifications', eventId, () => Promise.resolve('ok')),
    );
    expect(retry).toEqual({ processed: true, result: 'ok' });
  });

  it('lets only one of two concurrent deliveries do the work', async () => {
    const eventId = uuid();
    const inside = gate();
    const release = gate();
    let runs = 0;

    const first = withDbContext(worker(), system, (tx) =>
      processOnce(tx, 'notifications', eventId, async () => {
        runs += 1;
        inside.open();
        await release.wait;
      }),
    );
    await inside.wait;
    // The second delivery now waits on the first one's uncommitted insert.
    const second = withDbContext(worker(), system, (tx) =>
      processOnce(tx, 'notifications', eventId, () => {
        runs += 1;
        return Promise.resolve();
      }),
    );
    release.open();
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.processed).sort()).toEqual([false, true]);
    expect(runs).toBe(1);
  });

  it('lets the second concurrent delivery go ahead when the first one fails', async () => {
    const eventId = uuid();
    const inside = gate();
    const release = gate();
    const first = withDbContext(worker(), system, (tx) =>
      processOnce(tx, 'notifications', eventId, async () => {
        inside.open();
        await release.wait;
        throw new Error('first failed');
      }),
    );
    const firstOutcome = first.then(
      () => 'resolved',
      () => 'rejected',
    );
    await inside.wait;
    const second = withDbContext(worker(), system, (tx) =>
      processOnce(tx, 'notifications', eventId, () => Promise.resolve('second ran')),
    );
    release.open();
    expect(await firstOutcome).toBe('rejected');
    expect(await second).toEqual({ processed: true, result: 'second ran' });
  });

  it('refuses a consumer name longer than the column', async () => {
    await expect(
      withDbContext(worker(), system, (tx) =>
        processOnce(tx, 'c'.repeat(61), uuid(), () => Promise.resolve()),
      ),
    ).rejects.toThrow(RangeError);
  });
});
