import 'reflect-metadata';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { IdempotencyService } from '@labconnect/core';
import { describe, expect, it, vi } from 'vitest';
import { IdempotencyInterceptor, routeOf } from './idempotency.interceptor.js';

describe('routeOf', () => {
  it('is the method and the concrete path, without the query or a trailing slash', () => {
    expect(routeOf({ method: 'post', path: '/v1/lab/claims/abc/verify-otp/' })).toBe(
      'POST /v1/lab/claims/abc/verify-otp',
    );
    expect(routeOf({ method: 'POST', path: '/' })).toBe('POST /');
  });

  it('fits the column: a path that is too long is cut and hashed, and stays distinct', () => {
    const long = (tail: string) =>
      routeOf({ method: 'POST', path: `/v1/${'a'.repeat(300)}${tail}` });
    expect(long('x')).toHaveLength(150 + 1 + 32);
    expect(long('x')).not.toBe(long('y'));
    expect(long('x')).toBe(long('x'));
  });
});

describe('IdempotencyInterceptor, without a user', () => {
  const contextOf = (request: object): ExecutionContext =>
    ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

  it('refuses before touching the store or the handler (fail closed)', async () => {
    const begin = vi.fn();
    const service = { begin } as unknown as IdempotencyService;
    const handle = vi.fn();
    const interceptor = new IdempotencyInterceptor(service);
    const request = {
      headers: { 'idempotency-key': 'k' },
      method: 'POST',
      path: '/v1/x',
      body: {},
    };
    await expect(
      interceptor.intercept(contextOf(request), { handle } as CallHandler),
    ).rejects.toThrow(/authenticated user/);
    expect(begin).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });
});
