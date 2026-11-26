import { createCustomer } from '@labconnect/database/test-utils';
import { withDbContext } from '@labconnect/database';
import { describe, expect, it } from 'vitest';
import {
  FixedClock,
  hashRequestBody,
  IDEMPOTENCY_LOCK_TIMEOUT_MS,
  IDEMPOTENCY_RETENTION_MS,
  type IdempotencyRequest,
  IdempotencyService,
  isValidIdempotencyKey,
  purgeExpiredIdempotencyRecords,
} from '../../src/index.js';
import { failure, usePlatform, uuid } from './support.js';

// I1-SHR-01: the Idempotency-Key service on a real database, as the real roles (app_rw under
// row-level security for the requests, app_worker for the purge).

describe('idempotency keys', () => {
  const { owner, api, worker, db } = usePlatform();
  const clock = new FixedClock('2026-11-26T10:00:00Z');
  const service = () => new IdempotencyService(api(), clock);

  const newUser = async (): Promise<string> => (await createCustomer(owner())).admin;
  const hash = (body: unknown) => hashRequestBody(body);
  const request = (
    actorUserId: string,
    overrides: Partial<IdempotencyRequest> = {},
  ): IdempotencyRequest => ({
    key: uuid(),
    actorUserId,
    route: 'POST /v1/test/things',
    requestHash: hash({ name: 'a' }),
    ...overrides,
  });
  const started = (result: Awaited<ReturnType<IdempotencyService['begin']>>) => {
    if (result.kind !== 'started') return expect.fail(`expected started, got ${result.kind}`);
    return result;
  };
  const rowCount = async (key: string) =>
    (await db().query('SELECT 1 FROM idempotency_record WHERE idempotency_key = $1', [key]))
      .rowCount;

  it('starts a new request and leaves an IN_PROGRESS record that expires in 24 hours', async () => {
    const user = await newUser();
    const input = request(user);
    started(await service().begin(input));
    const row = (
      await db().query<{ status: string; expires_at: Date; response_body: unknown }>(
        'SELECT status, expires_at, response_body FROM idempotency_record WHERE idempotency_key = $1',
        [input.key],
      )
    ).rows[0];
    expect(row?.status).toBe('IN_PROGRESS');
    expect(row?.expires_at.getTime()).toBe(clock.now().getTime() + IDEMPOTENCY_RETENTION_MS);
    expect(row?.response_body).toBeNull();
  });

  it('replays the stored status and body for the same key and the same body', async () => {
    const user = await newUser();
    const input = request(user);
    const first = started(await service().begin(input));
    expect(
      await service().complete(first.claim, { status: 201, body: { id: 'x', n: [1, 2] } }),
    ).toBe(true);
    expect(await service().begin(input)).toEqual({
      kind: 'replay',
      response: { status: 201, body: { id: 'x', n: [1, 2] } },
    });
    // The body hash ignores key order.
    expect((await service().begin({ ...input, requestHash: hash({ b: 1, a: 2 }) })).kind).toBe(
      'reused',
    );
    const same = request(user, { requestHash: hash({ a: 2, b: 1 }) });
    const done = started(await service().begin(same));
    await service().complete(done.claim, { status: 200, body: null });
    expect((await service().begin({ ...same, requestHash: hash({ b: 1, a: 2 }) })).kind).toBe(
      'replay',
    );
  });

  it('answers REUSED for the same key with a different body, in progress or finished', async () => {
    const user = await newUser();
    const input = request(user);
    const first = started(await service().begin(input));
    const other = { ...input, requestHash: hash({ name: 'b' }) };
    expect((await service().begin(other)).kind).toBe('reused');
    await service().complete(first.claim, { status: 200, body: {} });
    expect((await service().begin(other)).kind).toBe('reused');
  });

  it('lets exactly one of many simultaneous identical requests start', async () => {
    const user = await newUser();
    const input = request(user);
    const results = await Promise.all(Array.from({ length: 16 }, () => service().begin(input)));
    expect(results.filter((r) => r.kind === 'started')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'in_progress')).toHaveLength(15);
    expect(await rowCount(input.key)).toBe(1);
  });

  it('lets exactly one of many simultaneous requests take over an expired record', async () => {
    const user = await newUser();
    const input = request(user);
    const first = started(await service().begin(input));
    await service().complete(first.claim, { status: 200, body: {} });
    clock.advance(IDEMPOTENCY_RETENTION_MS + 1);
    const results = await Promise.all(Array.from({ length: 12 }, () => service().begin(input)));
    expect(results.filter((r) => r.kind === 'started')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'in_progress')).toHaveLength(11);
    expect(await rowCount(input.key)).toBe(1);
  });

  it('treats a finished record past expires_at as absent, and a different body may then reuse the key', async () => {
    const user = await newUser();
    const input = request(user);
    const first = started(await service().begin(input));
    await service().complete(first.claim, { status: 201, body: { old: true } });
    clock.advance(IDEMPOTENCY_RETENTION_MS - 1);
    expect((await service().begin(input)).kind).toBe('replay');
    clock.advance(1);
    const again = started(await service().begin({ ...input, requestHash: hash({ name: 'new' }) }));
    expect(await rowCount(input.key)).toBe(1);
    // The old response is gone with the reuse.
    await service().complete(again.claim, { status: 200, body: { fresh: true } });
    const replay = await service().begin({ ...input, requestHash: hash({ name: 'new' }) });
    expect(replay).toEqual({ kind: 'replay', response: { status: 200, body: { fresh: true } } });
  });

  it('takes over an IN_PROGRESS record only after the lock timeout, and the old claim is then void', async () => {
    const user = await newUser();
    const input = request(user);
    const first = started(await service().begin(input));
    clock.advance(IDEMPOTENCY_LOCK_TIMEOUT_MS - 1);
    expect((await service().begin(input)).kind).toBe('in_progress');
    clock.advance(1);
    const second = started(await service().begin(input));
    expect(second.takenOver).toBe(true);
    // The process that was presumed dead wakes up: it can neither complete nor abandon.
    expect(await service().complete(first.claim, { status: 200, body: { zombie: true } })).toBe(
      false,
    );
    expect(await service().abandon(first.claim)).toBe(false);
    // And the new holder is protected from a third request.
    expect((await service().begin(input)).kind).toBe('in_progress');
    expect(await service().complete(second.claim, { status: 200, body: { ok: true } })).toBe(true);
    expect((await service().begin(input)).kind).toBe('replay');
  });

  it('does not take over for a different body even after the timeout', async () => {
    const user = await newUser();
    const input = request(user);
    started(await service().begin(input));
    clock.advance(IDEMPOTENCY_LOCK_TIMEOUT_MS * 2);
    expect((await service().begin({ ...input, requestHash: hash({ other: 1 }) })).kind).toBe(
      'reused',
    );
  });

  it('lets exactly one of many simultaneous requests take over a stale record', async () => {
    const user = await newUser();
    const input = request(user);
    started(await service().begin(input));
    clock.advance(IDEMPOTENCY_LOCK_TIMEOUT_MS);
    const results = await Promise.all(Array.from({ length: 12 }, () => service().begin(input)));
    expect(results.filter((r) => r.kind === 'started')).toHaveLength(1);
  });

  it('frees the key on abandon, so the client can retry', async () => {
    const user = await newUser();
    const input = request(user);
    const first = started(await service().begin(input));
    expect(await service().abandon(first.claim)).toBe(true);
    const retry = started(await service().begin(input));
    expect(await rowCount(input.key)).toBe(1);
    expect(await service().complete(first.claim, { status: 200, body: {} })).toBe(false);
    expect(await service().complete(retry.claim, { status: 200, body: {} })).toBe(true);
  });

  it('does not abandon a finished record', async () => {
    const user = await newUser();
    const input = request(user);
    const first = started(await service().begin(input));
    await service().complete(first.claim, { status: 200, body: { done: 1 } });
    expect(await service().abandon(first.claim)).toBe(false);
    expect((await service().begin(input)).kind).toBe('replay');
  });

  it('completes inside the caller transaction: a rollback leaves the record IN_PROGRESS', async () => {
    const user = await newUser();
    const input = request(user);
    const first = started(await service().begin(input));
    await expect(
      withDbContext(api(), { kind: 'tenant', orgId: '', userId: user }, async (tx) => {
        expect(await service().complete(first.claim, { status: 200, body: {} }, tx)).toBe(true);
        throw new Error('the business write failed');
      }),
    ).rejects.toThrow('the business write failed');
    expect((await service().begin(input)).kind).toBe('in_progress');

    await withDbContext(api(), { kind: 'tenant', orgId: '', userId: user }, (tx) =>
      service().complete(first.claim, { status: 200, body: { kept: true } }, tx),
    );
    expect((await service().begin(input)).kind).toBe('replay');
  });

  describe('isolation', () => {
    it("never replays, collides with or reveals another user's key", async () => {
      const a = await newUser();
      const b = await newUser();
      const key = uuid();
      const inputA = request(a, { key });
      const first = started(await service().begin(inputA));
      await service().complete(first.claim, { status: 201, body: { secret: 'only-for-A' } });

      // The same key and the same request from B starts: it is not a replay of A's response.
      const resultB = await service().begin(request(b, { key }));
      expect(resultB.kind).toBe('started');
      // A different body under A's key is "reused" for A, but B has never used the key: it starts.
      expect((await service().begin({ ...inputA, requestHash: hash({ other: 1 }) })).kind).toBe(
        'reused',
      );
      // While A's request is in progress, B is not told so.
      const keyTwo = uuid();
      started(await service().begin(request(a, { key: keyTwo })));
      started(await service().begin(request(b, { key: keyTwo })));
      // A still gets A's own response.
      expect(await service().begin(inputA)).toEqual({
        kind: 'replay',
        response: { status: 201, body: { secret: 'only-for-A' } },
      });
    });

    it("does not rely on row-level security: on the owner connection, which ignores it, B still never sees A's record", async () => {
      const ownerService = new IdempotencyService(owner(), clock);
      const a = await newUser();
      const b = await newUser();
      const key = uuid();
      const first = started(await ownerService.begin(request(a, { key })));
      await ownerService.complete(first.claim, { status: 201, body: { secret: 'only-for-A' } });
      expect((await ownerService.begin(request(b, { key }))).kind).toBe('started');
      // B's own request is still in progress: it is told so, not given A's finished response.
      expect((await ownerService.begin(request(b, { key }))).kind).toBe('in_progress');
      expect(
        (await ownerService.begin(request(b, { key, requestHash: hash({ x: 1 }) }))).kind,
      ).toBe('reused');
      expect((await ownerService.begin(request(a, { key }))).kind).toBe('replay');
    });

    it("hides other users' rows from the API role at the database too", async () => {
      const a = await newUser();
      const b = await newUser();
      const input = request(a);
      started(await service().begin(input));
      const seenByB = await withDbContext(
        api(),
        { kind: 'tenant', orgId: '', userId: b },
        (tx) =>
          tx.$queryRaw`SELECT id FROM idempotency_record WHERE idempotency_key = ${input.key}`,
      );
      expect(seenByB).toEqual([]);
      const seenByA = await withDbContext(
        api(),
        { kind: 'tenant', orgId: '', userId: a },
        (tx) =>
          tx.$queryRaw`SELECT id FROM idempotency_record WHERE idempotency_key = ${input.key}`,
      );
      expect(seenByA).toHaveLength(1);
    });

    it('keeps two routes, and two resources of one route, apart', async () => {
      const user = await newUser();
      const key = uuid();
      const base = request(user, { key });
      const first = started(await service().begin(base));
      await service().complete(first.claim, { status: 201, body: { route: 1 } });
      expect(
        started(await service().begin({ ...base, route: 'POST /v1/test/other' })).takenOver,
      ).toBe(false);
      const one = started(
        await service().begin({ ...base, route: `POST /v1/test/things/${uuid()}/go` }),
      );
      const two = started(
        await service().begin({ ...base, route: `POST /v1/test/things/${uuid()}/go` }),
      );
      expect(one.claim.id).not.toBe(two.claim.id);
      expect(await rowCount(key)).toBe(4);
      expect(await service().begin(base)).toMatchObject({ kind: 'replay' });
    });
  });

  describe('inputs', () => {
    it('accepts 1 to 100 visible ASCII characters and nothing else', () => {
      expect(isValidIdempotencyKey('a')).toBe(true);
      expect(isValidIdempotencyKey('x'.repeat(100))).toBe(true);
      expect(isValidIdempotencyKey('0193-ABC_def.~!')).toBe(true);
      for (const bad of ['', 'x'.repeat(101), 'has space', 'tab\t', 'é', 'a\nb', undefined, 5]) {
        expect(isValidIdempotencyKey(bad)).toBe(false);
      }
    });

    it('refuses a bad key, a route that does not fit, and a missing user', async () => {
      const user = await newUser();
      await expect(service().begin(request(user, { key: ' ' }))).rejects.toThrow(RangeError);
      await expect(service().begin(request(user, { route: 'x'.repeat(201) }))).rejects.toThrow(
        RangeError,
      );
      await expect(service().begin(request('', {}))).rejects.toThrow(RangeError);
    });
  });

  describe('purge', () => {
    it('deletes expired rows only, as the worker, in batches', async () => {
      const user = await newUser();
      const live = request(user);
      const stale = request(user);
      const done = request(user);
      started(await service().begin(live));
      started(await service().begin(stale));
      const finished = started(await service().begin(done));
      await service().complete(finished.claim, { status: 200, body: {} });
      // Age the rows by moving the clock, then make a fresh live one.
      clock.advance(IDEMPOTENCY_RETENTION_MS + 1);
      const fresh = request(user);
      started(await service().begin(fresh));

      let total = 0;
      for (let pass = 0; pass < 50; pass += 1) {
        const { deleted } = await purgeExpiredIdempotencyRecords(worker(), clock, { batchSize: 2 });
        if (deleted === 0) break;
        total += deleted;
      }
      expect(total).toBeGreaterThanOrEqual(3);
      for (const gone of [live, stale, done]) expect(await rowCount(gone.key)).toBe(0);
      expect(await rowCount(fresh.key)).toBe(1);
      expect((await purgeExpiredIdempotencyRecords(worker(), clock)).deleted).toBe(0);
      await expect(
        purgeExpiredIdempotencyRecords(worker(), clock, { batchSize: 0 }),
      ).rejects.toThrow(RangeError);
    });

    it('cannot be done by the API role, which has no DELETE on the table', async () => {
      const user = await newUser();
      started(await service().begin(request(user)));
      const denied = await failure(() =>
        withDbContext(
          api(),
          { kind: 'system' },
          (tx) => tx.$executeRaw`DELETE FROM idempotency_record`,
        ),
      );
      expect(denied.state).toBe('42501');
    });
  });
});
