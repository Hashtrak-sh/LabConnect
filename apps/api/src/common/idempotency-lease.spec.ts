import 'reflect-metadata';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import {
  IDEMPOTENCY_HEARTBEAT_INTERVAL_MS as BEAT,
  type IdempotencyClaim,
  type IdempotencyService,
} from '@labconnect/core';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdempotencyLease } from './idempotency-lease.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';

const claim = (n: number): IdempotencyClaim => ({
  id: 'record',
  actorUserId: 'user',
  lockedAt: new Date(n),
});
const logger = () => ({ error: vi.fn(), warn: vi.fn() });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('IdempotencyLease', () => {
  it('renews every interval and hands out the latest claim', async () => {
    const renew = vi.fn((c: IdempotencyClaim) => Promise.resolve(claim(c.lockedAt.getTime() + 1)));
    const lease = new IdempotencyLease({ renew }, claim(0), logger());
    await vi.advanceTimersByTimeAsync(BEAT * 2);
    expect(renew.mock.calls.map(([c]) => c.lockedAt.getTime())).toEqual([0, 1]);
    expect((await lease.stop()).lockedAt.getTime()).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs a failed renewal by error name only and retries at the next tick', async () => {
    const log = logger();
    const renew = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('password=hunter2 in the message'))
      .mockResolvedValue(claim(5));
    const lease = new IdempotencyLease({ renew }, claim(0), log);
    await vi.advanceTimersByTimeAsync(BEAT * 2);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(String(log.error.mock.calls[0]?.[0])).toContain('TypeError');
    expect(String(log.error.mock.calls[0]?.[0])).not.toContain('hunter2');
    expect((await lease.stop()).lockedAt.getTime()).toBe(5);
  });

  it('stops for good when the claim was lost', async () => {
    const renew = vi.fn().mockResolvedValue(null);
    const lease = new IdempotencyLease({ renew }, claim(0), logger());
    await vi.advanceTimersByTimeAsync(BEAT * 5);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect((await lease.stop()).lockedAt.getTime()).toBe(0);
  });

  it('stops renewing at the maximum lease and says so once', async () => {
    const log = logger();
    const renew = vi.fn((c: IdempotencyClaim) => Promise.resolve(c));
    new IdempotencyLease({ renew }, claim(0), log);
    await vi.advanceTimersByTimeAsync(BEAT * 100);
    expect(renew).toHaveBeenCalledTimes(29);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop waits for a renewal in flight and returns its claim', async () => {
    let finish: (c: IdempotencyClaim) => void = () => undefined;
    const renew = vi.fn(
      () =>
        new Promise<IdempotencyClaim>((resolve) => {
          finish = resolve;
        }),
    );
    const lease = new IdempotencyLease({ renew }, claim(0), logger());
    await vi.advanceTimersByTimeAsync(BEAT);
    const stopped = lease.stop();
    finish(claim(9));
    expect((await stopped).lockedAt.getTime()).toBe(9);
  });
});

describe('IdempotencyInterceptor timers', () => {
  it('leaves no timer when the client goes away and the stream is unsubscribed', async () => {
    const service = {
      begin: vi.fn().mockResolvedValue({ kind: 'started', claim: claim(0), takenOver: false }),
      renew: vi.fn(),
      complete: vi.fn(),
      abandon: vi.fn(),
    } as unknown as IdempotencyService;
    const request = {
      headers: { 'idempotency-key': 'k' },
      method: 'POST',
      path: '/v1/x',
      originalUrl: '/v1/x',
      body: {},
      actor: { userId: 'user', orgId: null, membershipId: null },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
    } as unknown as ExecutionContext;
    const subject = new Subject<unknown>();
    const stream = await new IdempotencyInterceptor(service).intercept(context, {
      handle: () => subject,
    } as CallHandler);
    const subscription = stream.subscribe();
    expect(vi.getTimerCount()).toBe(1);
    subscription.unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });
});
