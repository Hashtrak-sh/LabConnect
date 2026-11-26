import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /health', () => {
  it('answers 200 with status ok and forbids caching', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});
