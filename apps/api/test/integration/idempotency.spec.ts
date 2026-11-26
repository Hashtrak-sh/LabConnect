// The Idempotency-Key interceptor over HTTP on a real database (I1-SHR-01). The routes are
// test-only controllers (test/support/idempotency-probe.ts): no real route uses the mechanism yet.
import { randomUUID } from 'node:crypto';
import { createCustomer } from '@labconnect/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    } = {},
  ) => {
    const token = await tokenOf(options.user ?? 'alice');
    const headers: Record<string, string> = {};
    if (options.key !== undefined && options.key !== null) headers['Idempotency-Key'] = options.key;
    if (options.requestId !== undefined) headers['X-Request-Id'] = options.requestId;
    return t.probe.post(`/v1/idem-probe/${path}`, {
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

  it('400 for a missing or malformed key, before anything runs', async () => {
    for (const key of [null, '', 'has space', 'x'.repeat(101), 'tab\there']) {
      const response = await call('create', { key });
      expect(response.status, `key ${JSON.stringify(key)}`).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
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
});
