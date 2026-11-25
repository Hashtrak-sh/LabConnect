import { describe, expect, it, vi } from 'vitest';
import { createApiPrisma, createLazyPrisma, createWorkerPrisma } from './prisma.js';

/** Reads a member that needs the real client, without calling it. */
const touch = (client: object): unknown => Reflect.get(client, '$transaction');

describe('createLazyPrisma', () => {
  it('does not ask for the connection string until the client is used', async () => {
    const connectionString = vi.fn(() => 'postgresql://u:p@localhost:5432/none');
    const lazy = createLazyPrisma(connectionString);
    expect(connectionString).not.toHaveBeenCalled();
    await lazy.disconnect();
    expect(connectionString).not.toHaveBeenCalled();
  });

  it('answers probes by frameworks and Promise machinery without connecting', () => {
    const connectionString = vi.fn(() => {
      throw new Error('must not be called');
    });
    const { client } = createLazyPrisma(connectionString);
    const probe = client as unknown as Record<string | symbol, unknown>;
    expect(probe.then).toBeUndefined();
    expect(probe.onModuleInit).toBeUndefined();
    expect(probe.toJSON).toBeUndefined();
    expect(probe[Symbol.toPrimitive]).toBeUndefined();
    expect(connectionString).not.toHaveBeenCalled();
  });

  it('builds the client on first real use and reuses it', async () => {
    const connectionString = vi.fn(() => 'postgresql://u:p@127.0.0.1:1/none');
    const lazy = createLazyPrisma(connectionString, { max: 1 });
    const first = touch(lazy.client);
    const second = touch(lazy.client);
    expect(typeof first).toBe('function');
    expect(typeof second).toBe('function');
    expect(connectionString).toHaveBeenCalledTimes(1);
    expect(lazy.client.auditLog).toBeDefined();
    await lazy.disconnect();
  });
});

describe('createApiPrisma and createWorkerPrisma', () => {
  it('name the missing variable when the first query is attempted', () => {
    expect(() => touch(createApiPrisma({}).client)).toThrow('API_DATABASE_URL is not set.');
    expect(() => touch(createWorkerPrisma({}).client)).toThrow('WORKER_DATABASE_URL is not set.');
  });

  it('boot without the variables', () => {
    expect(() => createApiPrisma({})).not.toThrow();
    expect(() => createWorkerPrisma({})).not.toThrow();
  });
});
