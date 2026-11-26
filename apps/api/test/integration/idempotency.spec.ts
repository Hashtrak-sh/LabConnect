// The Idempotency-Key interceptor over HTTP on a real database (I1-SHR-01). The routes are
// test-only controllers (test/support/idempotency-probe.ts): no real route uses the mechanism yet.
import { randomUUID } from 'node:crypto';
import {
  IDEMPOTENCY_HEARTBEAT_INTERVAL_MS,
  IDEMPOTENCY_LOCK_TIMEOUT_MS,
  IdempotencyService,
} from '@labconnect/core';
import { Logger } from '@nestjs/common';
import { addMember, createCustomer } from '@labconnect/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { expectProblemResponse } from '../support/contract/index.js';
import { useIdentityApp } from '../support/identity-app.js';
import { IdempotencyProbeModule, idempotencyProbe } from '../support/idempotency-probe.js';

describe('Idempotency-Key over HTTP', () => {
  const t = useIdentityApp({ imports: [IdempotencyProbeModule] });
  const tokens = new Map<string, string>();

  const tokenOf = async (label: string): Promise<string> => {
    const cached = tokens.get(label);
    if (cached !== undefined) return cached;
    const customer = await t.owner((tx) => createCustomer(tx));
    const admin = await t.personOf(customer.admin);
    const { accessToken } = await t.signIn(admin.email);
    tokens.set(label, accessToken);
    return accessToken;
  };

  const call = async (
    path: string,
    options: {
      user?: string;
      key?: string | null;
      body?: object;
      requestId?: string;
      token?: string;
      membership?: string;
      query?: string;
    } = {},
  ) => {
    const token = options.token ?? (await tokenOf(options.user ?? 'alice'));
    const headers: Record<string, string> = {};
    if (options.membership !== undefined) headers['X-Active-Membership'] = options.membership;
    if (options.key !== undefined && options.key !== null) headers['Idempotency-Key'] = options.key;
    if (options.requestId !== undefined) headers['X-Request-Id'] = options.requestId;
    return t.probe.post(`/v1/idem-probe/${path}${options.query ?? ''}`, {
      token,
      post: false,
      headers,
      body: options.body ?? {},
    });
  };

  const recordsFor = async (key: string) =>
    (
      await t
        .db()
        .query<{ route: string; status: string; response_status: number | null }>(
          'SELECT route, status, response_status FROM idempotency_record WHERE idempotency_key = $1 ORDER BY route',
          [key],
        )
    ).rows;

  beforeEach(() => {
    idempotencyProbe.reset();
  });

  it('runs the handler once for two identical requests; the second gets the same answer', async () => {
    const key = randomUUID();
    const first = await call('create', { key, body: { name: 'x' } });
    const second = await call('create', { key, body: { name: 'x' } });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(first.body).toEqual({ run: 1, name: 'x' });
    expect(idempotencyProbe.runs).toBe(1);
    expect(await recordsFor(key)).toEqual([
      { route: 'POST /v1/idem-probe/create', status: 'COMPLETED', response_status: 201 },
    ]);
  });

  it("replays the handler's declared status (200 with @HttpCode)", async () => {
    const key = randomUUID();
    const first = await call('items/abc/touch', { key });
    const second = await call('items/abc/touch', { key });
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.body).toEqual(first.body);
    expect(idempotencyProbe.runs).toBe(1);
  });

  it('does not care about the key order of the body', async () => {
    const key = randomUUID();
    await call('create', { key, body: { a: 1, name: 'n' } });
    const again = await call('create', { key, body: { name: 'n', a: 1 } });
    expect(again.status).toBe(201);
    expect(idempotencyProbe.runs).toBe(1);
  });

  it('422 IDEMPOTENCY_KEY_REUSED for the same key with a different body; the handler does not run', async () => {
    const key = randomUUID();
    await call('create', { key, body: { name: 'one' } });
    const reused = await call('create', { key, body: { name: 'two' } });
    expect(reused.status).toBe(422);
    expect(reused.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 422 });
    expectProblemResponse(reused);
    expect(idempotencyProbe.runs).toBe(1);
  });

  it('400 for a missing or malformed key, before anything runs, and the detail names the header', async () => {
    for (const key of [null, '', 'has space', 'x'.repeat(101), 'tab	here']) {
      const response = await call('create', { key });
      expect(response.status, `key ${JSON.stringify(key)}`).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
      const detail = (response.body as { detail?: string }).detail ?? '';
      expect(detail, `key ${JSON.stringify(key)}`).toContain('Idempotency-Key');
      expect(detail).toContain('1 to 100');
      expectProblemResponse(response);
    }
    expect(idempotencyProbe.runs).toBe(0);
    // 100 characters is the longest allowed key.
    expect((await call('create', { key: 'k'.repeat(100) })).status).toBe(201);
  });

  it('answers 401 first when there is no session, key or not, and stores nothing', async () => {
    const key = randomUUID();
    const response = await t.probe.post('/v1/idem-probe/create', {
      post: false,
      headers: { 'Idempotency-Key': key },
      body: {},
    });
    expect(response.status).toBe(401);
    expect(idempotencyProbe.runs).toBe(0);
    expect(await recordsFor(key)).toEqual([]);
  });

  it('409 REQUEST_IN_PROGRESS for a concurrent duplicate; then the stored answer once it finishes', async () => {
    const key = randomUUID();
    let release: () => void = () => undefined;
    idempotencyProbe.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = call('slow', { key });
    await vi.waitFor(() => {
      expect(idempotencyProbe.runs).toBe(1);
    });
    const duplicate = await call('slow', { key });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ code: 'REQUEST_IN_PROGRESS', status: 409 });
    expectProblemResponse(duplicate);
    release();
    const finished = await first;
    expect(finished.status).toBe(200);
    const replay = await call('slow', { key });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(finished.body);
    expect(idempotencyProbe.runs).toBe(1);
  });

  it('runs a burst of identical requests once', async () => {
    const key = randomUUID();
    let release: () => void = () => undefined;
    idempotencyProbe.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const burst = Array.from({ length: 6 }, () => call('slow', { key }));
    await vi.waitFor(() => {
      expect(idempotencyProbe.runs).toBeGreaterThanOrEqual(1);
    });
    // Let the losers get their answer, then let the winner go.
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    const responses = await Promise.all(burst);
    expect(idempotencyProbe.runs).toBe(1);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(5);
  });

  it('leaves the key reusable after a 5xx, and stores no response for it', async () => {
    const key = randomUUID();
    idempotencyProbe.failNext = true;
    const failed = await call('flaky', { key });
    expect(failed.status).toBe(500);
    expect(failed.body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(await recordsFor(key)).toMatchObject([{ status: 'IN_PROGRESS', response_status: null }]);
    const retry = await call('flaky', { key });
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({ run: 2 });
    expect(await call('flaky', { key })).toMatchObject({ status: 200, body: { run: 2 } });
    expect(idempotencyProbe.runs).toBe(2);
  });

  it('stores a business 4xx and replays it as the same problem with the current request id', async () => {
    const key = randomUUID();
    const first = await call('conflict', { key, requestId: 'request-one' });
    const second = await call('conflict', { key, requestId: 'request-two' });
    expect(first.status).toBe(409);
    expect(second.status).toBe(409);
    expect(idempotencyProbe.runs).toBe(1);
    expect(first.body).toMatchObject({
      requestId: 'request-one',
      code: 'INVALID_STATE_TRANSITION',
    });
    expect(second.body).toEqual({ ...(first.body as object), requestId: 'request-two' });
    expect(second.body).toMatchObject({ meta: { currentState: 'CLOSED' } });
    expect(second.headers['x-request-id']).toBe('request-two');
    expect(second.headers['content-type']).toContain('application/problem+json');
    expectProblemResponse(second);
    expect(await recordsFor(key)).toMatchObject([{ status: 'COMPLETED', response_status: 409 }]);
  });

  it('replays a 422 with its field errors', async () => {
    const key = randomUUID();
    const first = await call('invalid', { key });
    const second = await call('invalid', { key });
    expect(second.status).toBe(422);
    expect(second.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'name', code: 'required', message: 'name is required' }],
    });
    expect(second.body).toEqual({
      ...(first.body as object),
      requestId: (second.body as { requestId: string }).requestId,
    });
    expect(idempotencyProbe.runs).toBe(1);
  });

  it('never stores a 403: the handler runs again', async () => {
    const key = randomUUID();
    expect((await call('forbidden', { key })).status).toBe(403);
    expect((await call('forbidden', { key })).status).toBe(403);
    expect(idempotencyProbe.runs).toBe(2);
    expect(await recordsFor(key)).toMatchObject([{ status: 'IN_PROGRESS' }]);
  });

  describe('scope', () => {
    it("is per user: another user's request with the same key runs on its own", async () => {
      const key = randomUUID();
      const alice = await call('create', { key, user: 'alice', body: { name: 'same' } });
      const bob = await call('create', { key, user: 'bob', body: { name: 'same' } });
      expect(alice.body).toEqual({ run: 1, name: 'same' });
      expect(bob.body).toEqual({ run: 2, name: 'same' });
      // And Bob using Alice's key with another body is not a "reuse".
      const bobOther = await call('create', { key, user: 'bob', body: { name: 'other' } });
      expect(bobOther.status).toBe(422);
      const carol = await call('create', { key, user: 'carol', body: { name: 'other' } });
      expect(carol.status).toBe(201);
      expect(await recordsFor(key)).toHaveLength(3);
    });

    it('is per route and per resource: one key on two routes or two ids runs each', async () => {
      const key = randomUUID();
      await call('create', { key });
      await call('items/one/touch', { key });
      await call('items/two/touch', { key });
      expect(idempotencyProbe.runs).toBe(3);
      await call('items/one/touch', { key });
      await call('items/two/touch', { key });
      await call('create', { key });
      expect(idempotencyProbe.runs).toBe(3);
      expect(await recordsFor(key)).toHaveLength(3);
    });

    describe('two organisations of one user', () => {
      const setup = async () => {
        const first = await t.owner((tx) => createCustomer(tx));
        const second = await t.owner((tx) => createCustomer(tx));
        const secondMembership = await t.owner((tx) =>
          addMember(tx, first.admin, second.organisationId, 'CUSTOMER_ADMIN'),
        );
        const { email } = await t.personOf(first.admin);
        const { accessToken: token } = await t.signIn(email);
        return { token, secondMembership };
      };

      it('refuses the same key and body under the other membership; nothing of the first answer leaks', async () => {
        const { token, secondMembership } = await setup();
        const key = randomUUID();
        const secret = `FIRST-ORG-ANSWER-${randomUUID()}`;
        const first = await call('create', { key, token, body: { name: secret } });
        expect(first.status).toBe(201);
        expect(idempotencyProbe.runs).toBe(1);
        const second = await call('create', {
          key,
          token,
          membership: secondMembership,
          body: { name: secret },
        });
        expect(second.status).toBe(422);
        expect(second.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 422 });
        expectProblemResponse(second);
        expect(idempotencyProbe.runs).toBe(1);
        const text = JSON.stringify(second.body);
        expect(text).not.toContain(secret);
        expect(text).not.toContain('"run"');
        // The first organisation's record is untouched and still replays for the first membership.
        const again = await call('create', { key, token, body: { name: secret } });
        expect(again.body).toEqual(first.body);
        expect(idempotencyProbe.runs).toBe(1);
      });

      it('runs both organisations when the keys differ', async () => {
        const { token, secondMembership } = await setup();
        const body = { name: 'same' };
        const first = await call('create', { key: randomUUID(), token, body });
        const second = await call('create', {
          key: randomUUID(),
          token,
          membership: secondMembership,
          body,
        });
        expect([first.status, second.status]).toEqual([201, 201]);
        expect(idempotencyProbe.runs).toBe(2);
      });
    });

    it('422 for the same key, body and membership with a different query string; the handler does not run', async () => {
      const key = randomUUID();
      const first = await call('create', { key, query: '?mode=a', body: { name: 'q' } });
      expect(first.status).toBe(201);
      const other = await call('create', { key, query: '?mode=b', body: { name: 'q' } });
      expect(other.status).toBe(422);
      expect(other.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      expect(idempotencyProbe.runs).toBe(1);
      // The same query in another parameter order is the same request.
      const k2 = randomUUID();
      await call('create', { key: k2, query: '?a=1&b=2', body: { name: 'q' } });
      const reordered = await call('create', { key: k2, query: '?b=2&a=1', body: { name: 'q' } });
      expect(reordered.status).toBe(201);
      expect(idempotencyProbe.runs).toBe(2);
    });

    it('a user with no membership still gets idempotency as before', async () => {
      const key = randomUUID();
      const { accessToken: token } = await t.signIn(`nomember-${randomUUID()}@example.test`);
      const first = await call('open', { key, token, body: { name: 'n' } });
      const second = await call('open', { key, token, body: { name: 'n' } });
      expect([first.status, second.status]).toEqual([200, 200]);
      expect(second.body).toEqual(first.body);
      expect(idempotencyProbe.runs).toBe(1);
      const other = await call('open', { key, token, body: { name: 'other' } });
      expect(other.status).toBe(422);
    });

    it('ignores the query string: personal data in it never reaches the record', async () => {
      const key = randomUUID();
      const token = await tokenOf('alice');
      await t.probe.post('/v1/idem-probe/create?email=someone@example.test', {
        token,
        post: false,
        headers: { 'Idempotency-Key': key },
        body: {},
      });
      const rows = await recordsFor(key);
      expect(rows.map((row) => row.route)).toEqual(['POST /v1/idem-probe/create']);
    });
  });

  it('fails closed on a route without authentication: 500, the handler never runs', async () => {
    const key = randomUUID();
    const token = await tokenOf('alice');
    for (const withToken of [false, true]) {
      const response = await t.probe.post('/v1/idem-probe/unguarded', {
        post: false,
        headers: {
          'Idempotency-Key': key,
          ...(withToken ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: {},
      });
      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR' });
    }
    expect(idempotencyProbe.runs).toBe(0);
    expect(await recordsFor(key)).toEqual([]);
  });

  describe('logs', () => {
    const lines: string[] = [];
    const spies: { mockRestore: () => void }[] = [];
    beforeEach(() => {
      lines.length = 0;
      for (const stream of [process.stdout, process.stderr]) {
        spies.push(
          vi.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
            lines.push(String(chunk));
            return true;
          }),
        );
      }
    });
    afterEach(() => {
      for (const spy of spies.splice(0)) spy.mockRestore();
    });

    it('never write the value of a malformed Idempotency-Key, nor echo it', async () => {
      const bad = `LEAKY KEY ${randomUUID()}`;
      const response = await call('create', { key: bad });
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).not.toContain(bad);
      expect(JSON.stringify(response.body)).not.toContain('LEAKY');
      expect(lines.join('')).not.toContain('LEAKY');
    });

    it('never write a request or response body', async () => {
      const marker = `MARKER-${randomUUID()}`;
      const key = randomUUID();
      await call('echo', { key, body: { secret: marker } });
      await call('echo', { key, body: { secret: marker } });
      await call('echo', { key, body: { secret: `${marker}-other` } });
      idempotencyProbe.failNext = true;
      await call('flaky', { key: randomUUID(), body: { secret: marker } });
      await call('conflict', { key: randomUUID(), body: { secret: marker } });
      const output = lines.join('');
      expect(output).not.toContain(marker);
      expect(output).not.toContain('reply:');
    });
  });

  describe('lease: a slow handler keeps its key', () => {
    // Only the heartbeat's interval is faked, so the database, HTTP and the test's waiting run for
    // real; the test clock moves with each beat, so the lock really ages.
    let renew: MockInstance<IdempotencyService['renew']>;
    // These tests move the test clock by minutes: each signs in fresh, so its token is current.
    const freshToken = () => tokenOf(`lease-${randomUUID()}`);
    let gate: () => void;
    const closeGate = () => {
      gate();
    };
    const hold = () => {
      idempotencyProbe.hold = new Promise<void>((resolve) => {
        gate = resolve;
      });
    };
    const handlerStarted = (runs: number) =>
      vi.waitFor(() => {
        expect(idempotencyProbe.runs).toBe(runs);
      });
    /** One heartbeat interval passes; resolves when the renewals it started have finished. */
    const beat = async () => {
      t.clock.advance(IDEMPOTENCY_HEARTBEAT_INTERVAL_MS);
      vi.advanceTimersByTime(IDEMPOTENCY_HEARTBEAT_INTERVAL_MS);
      await Promise.allSettled(renew.mock.results.map((r) => r.value as Promise<unknown>));
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      renew = vi.spyOn(t.app().get(IdempotencyService, { strict: false }), 'renew');
      hold();
    });
    afterEach(() => {
      closeGate();
      renew.mockRestore();
      vi.useRealTimers();
    });

    it('runs a handler slower than the lock timeout once; a repeat meanwhile is 409; a repeat after it is the stored answer; no timer is left', async () => {
      const key = randomUUID();
      const token = await freshToken();
      const first = call('slow', { key, token });
      await handlerStarted(1);
      expect(vi.getTimerCount()).toBe(1);
      // Two lock timeouts of handler time, in heartbeat steps.
      for (
        let i = 0;
        i < (IDEMPOTENCY_LOCK_TIMEOUT_MS * 2) / IDEMPOTENCY_HEARTBEAT_INTERVAL_MS;
        i += 1
      ) {
        await beat();
      }
      expect(renew).toHaveBeenCalledTimes(6);
      const during = await call('slow', { key, token });
      expect(during.status).toBe(409);
      expect(during.body).toMatchObject({ code: 'REQUEST_IN_PROGRESS' });
      expect(idempotencyProbe.runs).toBe(1);
      closeGate();
      const finished = await first;
      expect(finished.status).toBe(200);
      expect(finished.body).toEqual({ run: 1 });
      const replay = await call('slow', { key, token });
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual({ run: 1 });
      expect(idempotencyProbe.runs).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stops renewing after the maximum lease, logs once, and the record can then be taken over', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const key = randomUUID();
      // An access token lives 10 minutes, the same as the lease: sign in again for the repeat.
      const customer = await t.owner((tx) => createCustomer(tx));
      const { email } = await t.personOf(customer.admin);
      const token = (await t.signIn(email)).accessToken;
      const first = call('slow', { key, token });
      await handlerStarted(1);
      for (let i = 0; i < 31; i += 1) await beat();
      // 10 minutes of 20-second beats: the 30th beat ends the lease instead of renewing.
      expect(renew).toHaveBeenCalledTimes(29);
      expect(vi.getTimerCount()).toBe(0);
      expect(warn.mock.calls.filter(([m]) => String(m).includes('maximum lease'))).toHaveLength(1);
      // Not renewed any more: one lock timeout later a repeat takes the key over.
      t.clock.advance(IDEMPOTENCY_LOCK_TIMEOUT_MS);
      const takeover = call('slow', { key, token: (await t.signIn(email)).accessToken });
      await handlerStarted(2);
      closeGate();
      expect((await takeover).body).toEqual({ run: 2 });
      expect((await first).status).toBe(200);
      warn.mockRestore();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('leaves no timer after the handler throws, and the business answer is stored', async () => {
      idempotencyProbe.failAfterHold = true;
      const key = randomUUID();
      const token = await freshToken();
      const first = call('slow', { key, token });
      await handlerStarted(1);
      expect(vi.getTimerCount()).toBe(1);
      closeGate();
      expect((await first).status).toBe(409);
      expect(vi.getTimerCount()).toBe(0);
      expect((await call('slow', { key, token })).status).toBe(409);
      expect(idempotencyProbe.runs).toBe(1);
    });
  });
});
