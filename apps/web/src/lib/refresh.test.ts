import { describe, expect, it } from 'vitest';
import { createRefresher } from './refresh';

/** A fake `/auth/refresh` that counts its calls and answers when told to. */
function fakeApi(status = 200) {
  const calls: string[] = [];
  const pending: (() => void)[] = [];
  let next = 0;
  const call = (refreshToken: string): Promise<Response | null> => {
    calls.push(refreshToken);
    next += 1;
    const n = next;
    return new Promise((resolve) => {
      pending.push(() => {
        resolve(
          status === 0
            ? null
            : new Response(
                status === 200
                  ? JSON.stringify({ accessToken: `access-${String(n)}`, expiresIn: 600 })
                  : '{}',
                {
                  status,
                  headers:
                    status === 200
                      ? {
                          'Set-Cookie': `lc_refresh=rotated-${String(n)}; Max-Age=43200; Path=/v1/auth; HttpOnly`,
                        }
                      : {},
                },
              ),
        );
      });
    });
  };
  const answerAll = () => {
    for (const answer of pending.splice(0)) answer();
  };
  return { call, calls, answerAll };
}

describe('one session refresh per refresh token (OQ-91)', () => {
  it('shares one API call between requests that arrive together, and they get the same new tokens', async () => {
    const api = fakeApi();
    const refresh = createRefresher({ call: api.call });
    const first = refresh('old-token');
    const second = refresh('old-token');
    const third = refresh('old-token');
    await new Promise((resolve) => setTimeout(resolve, 0));
    api.answerAll();
    const outcomes = await Promise.all([first, second, third]);
    expect(api.calls).toEqual(['old-token']);
    for (const outcome of outcomes) {
      expect(outcome).toEqual({
        kind: 'ok',
        accessToken: 'access-1',
        expiresIn: 600,
        refresh: { value: 'rotated-1', maxAge: 43_200 },
      });
    }
  });

  it('gives a request that still carries the old token the stored outcome for a few seconds, then lets go', async () => {
    let now = 1_000_000;
    const api = fakeApi();
    const refresh = createRefresher({ call: api.call, now: () => now, keepMs: 10_000 });
    const first = refresh('old-token');
    await new Promise((resolve) => setTimeout(resolve, 0));
    api.answerAll();
    await first;

    now += 9_000;
    const late = await refresh('old-token');
    expect(late).toMatchObject({ kind: 'ok', accessToken: 'access-1' });
    expect(api.calls).toHaveLength(1);

    now += 2_000;
    const after = refresh('old-token');
    await new Promise((resolve) => setTimeout(resolve, 0));
    api.answerAll();
    await after;
    expect(api.calls).toHaveLength(2);
  });

  it('keeps tokens apart: two sessions refresh separately', async () => {
    const api = fakeApi();
    const refresh = createRefresher({ call: api.call });
    const a = refresh('token-a');
    const b = refresh('token-b');
    await new Promise((resolve) => setTimeout(resolve, 0));
    api.answerAll();
    await Promise.all([a, b]);
    expect(api.calls.sort()).toEqual(['token-a', 'token-b']);
  });

  it('tells an ended session (401) from a refused request (403), and retries after an unreachable API', async () => {
    const ended = fakeApi(401);
    const endedRefresh = createRefresher({ call: ended.call });
    const one = endedRefresh('spent');
    await new Promise((resolve) => setTimeout(resolve, 0));
    ended.answerAll();
    expect(await one).toEqual({ kind: 'ended' });

    const refused = fakeApi(403);
    const refusedRefresh = createRefresher({ call: refused.call });
    const two = refusedRefresh('token');
    await new Promise((resolve) => setTimeout(resolve, 0));
    refused.answerAll();
    expect(await two).toEqual({ kind: 'refused' });

    const down = fakeApi(0);
    const downRefresh = createRefresher({ call: down.call });
    const three = downRefresh('token');
    await new Promise((resolve) => setTimeout(resolve, 0));
    down.answerAll();
    expect(await three).toEqual({ kind: 'unavailable' });
    const four = downRefresh('token');
    await new Promise((resolve) => setTimeout(resolve, 0));
    down.answerAll();
    await four;
    expect(down.calls).toHaveLength(2);
  });

  it('never keeps the token itself', async () => {
    const api = fakeApi();
    const refresh = createRefresher({ call: api.call });
    const pending = refresh('secret-refresh-token');
    await new Promise((resolve) => setTimeout(resolve, 0));
    api.answerAll();
    await pending;
    // The only place the token goes is the API call.
    expect(api.calls).toEqual(['secret-refresh-token']);
  });
});
