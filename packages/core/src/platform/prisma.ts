import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@labconnect/database';

export interface LazyPrisma {
  /** A client that connects on first use. Safe to create when no database is configured. */
  client: PrismaClient;
  /** Closes the connection if one was ever opened. */
  disconnect(): Promise<void>;
}

/**
 * A Prisma client that is built, and connects, only when something first uses it. The API
 * and the worker create theirs at start-up, and they must still start (in tests, or while
 * a database is being provisioned) when no database is configured; a missing connection
 * string then fails at the first query, with a clear message, not at boot.
 */
export function createLazyPrisma(
  connectionString: () => string,
  options: { max?: number } = {},
): LazyPrisma {
  let instance: PrismaClient | undefined;
  const real = (): PrismaClient => {
    instance ??= new PrismaClient({
      adapter: new PrismaPg({
        connectionString: connectionString(),
        ...(options.max === undefined ? {} : { max: options.max }),
      }),
    });
    return instance;
  };
  const client = new Proxy({} as PrismaClient, {
    get(_target, property) {
      const target = real();
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  return {
    client,
    async disconnect() {
      if (instance) await instance.$disconnect();
      instance = undefined;
    },
  };
}

function fromEnv(variable: string, env: Record<string, string | undefined>): () => string {
  return () => {
    const value = env[variable];
    if (!value) throw new Error(`${variable} is not set.`);
    return value;
  };
}

/** The API's client: connects as the `app_rw` login user in `API_DATABASE_URL`. */
export function createApiPrisma(
  env: Record<string, string | undefined> = process.env,
  options: { max?: number } = {},
): LazyPrisma {
  return createLazyPrisma(fromEnv('API_DATABASE_URL', env), options);
}

/** The worker's client: connects as the `app_worker` login user in `WORKER_DATABASE_URL`. */
export function createWorkerPrisma(
  env: Record<string, string | undefined> = process.env,
  options: { max?: number } = {},
): LazyPrisma {
  return createLazyPrisma(fromEnv('WORKER_DATABASE_URL', env), options);
}
