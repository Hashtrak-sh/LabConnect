import { PrismaPg } from '@prisma/adapter-pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DbContext, withDbContext } from '../../src/db-context.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { type Booking, createBooking, createWorld, type World } from './fixtures.js';
import { PG, useDatabase, uuid } from './helpers.js';

// P1-08: row-level security through Prisma and a connection pool (ADR-005).
// row-level-security.test.ts proves the policies with raw SQL on one connection. This
// file proves that the application path (Prisma, the pg driver adapter, withDbContext,
// a shared pool, and PgBouncer in transaction mode) carries the settings to the right
// transaction and to no other.

const PASSWORD = 'test';
const PATIENT = { maxWait: 60_000, timeout: 60_000 };

/** SQLSTATE of a database error that Prisma wrapped. */
function sqlState(error: unknown): string | undefined {
  const meta = (error as { meta?: { driverAdapterError?: { cause?: { originalCode?: string } } } })
    .meta;
  return meta?.driverAdapterError?.cause?.originalCode;
}

async function failure(body: () => Promise<unknown>): Promise<{ code?: string; state?: string }> {
  try {
    await body();
  } catch (error) {
    return { code: (error as { code?: string }).code, state: sqlState(error) };
  }
  return expect.fail('expected the operation to fail, but it succeeded');
}

describe('row-level security through Prisma (P1-08, ADR-005)', () => {
  const { db, url } = useDatabase();
  let world: World;
  let a: Booking; // customer one ↔ lab one
  let b: Booking; // customer two ↔ lab two
  let apiRole: string;
  let workerRole: string;
  let api: PrismaClient; // the API's role, pool of 4
  let worker: PrismaClient;
  const clients: PrismaClient[] = [];

  const connect = (connectionString: string, max: number): PrismaClient => {
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString, max }) });
    clients.push(client);
    return client;
  };
  const loginUrl = (role: string, base = url()): string => {
    const parsed = new URL(base);
    parsed.username = role;
    parsed.password = PASSWORD;
    return parsed.toString();
  };

  const customerA = (): DbContext => ({
    kind: 'tenant',
    orgId: world.orgs.customer,
    userId: world.users.customerAdmin,
  });
  const customerB = (): DbContext => ({
    kind: 'tenant',
    orgId: world.orgs.otherCustomer,
    userId: world.users.otherCustomerAdmin,
  });
  const labA = (): DbContext => ({
    kind: 'tenant',
    orgId: world.orgs.lab,
    userId: world.users.checker,
  });
  const platform = (): DbContext => ({ kind: 'platform', userId: world.users.ops });

  const bookingIds = async (
    client: Pick<PrismaClient, 'booking'> | Parameters<Parameters<typeof withDbContext>[2]>[0],
  ): Promise<string[]> =>
    (await client.booking.findMany({ select: { id: true } })).map((row) => row.id).sort();

  beforeAll(async () => {
    const owner = db();
    await owner.query('BEGIN');
    world = await createWorld(owner);
    a = await createBooking(owner, world);
    b = await createBooking(owner, world, {
      customerOrg: world.orgs.otherCustomer,
      lab: world.otherLab,
    });
    await owner.query('COMMIT');

    // Login users, as each environment's infrastructure creates them: they hold no
    // privileges of their own and inherit those of app_rw or app_worker.
    const suffix = uuid().slice(0, 8);
    apiRole = `lc_api_${suffix}`;
    workerRole = `lc_worker_${suffix}`;
    await owner.query(`CREATE ROLE ${apiRole} LOGIN PASSWORD '${PASSWORD}' INHERIT IN ROLE app_rw`);
    await owner.query(
      `CREATE ROLE ${workerRole} LOGIN PASSWORD '${PASSWORD}' INHERIT IN ROLE app_worker`,
    );
    api = connect(loginUrl(apiRole), 4);
    worker = connect(loginUrl(workerRole), 2);
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.$disconnect()));
  });

  /**
   * Runs many units of work at once over one pool: four contexts plus queries with no
   * context, with random pauses inside the transaction and some deliberate failures.
   * Every unit checks, before and after its pause, that it sees exactly its own rows.
   * Returns which contexts each database connection served.
   */
  async function hammer(client: PrismaClient, units: number): Promise<Map<number, Set<string>>> {
    const served = new Map<number, Set<string>>();
    const cases = [
      { name: 'customerA', context: customerA, sees: [a.id] },
      { name: 'customerB', context: customerB, sees: [b.id] },
      { name: 'labA', context: labA, sees: [a.id] },
      { name: 'platform', context: platform, sees: [a.id, b.id].sort() },
    ];
    const mismatches: string[] = [];

    await Promise.all(
      Array.from({ length: units }, async (_, index) => {
        const which = index % (cases.length + 1);
        const chosen = cases[which];
        if (!chosen) {
          const seen = await bookingIds(client);
          if (seen.length > 0) mismatches.push(`unit ${String(index)} with no context saw rows`);
          return;
        }
        const fails = index % 7 === 0;
        try {
          await withDbContext(
            client,
            chosen.context(),
            async (tx) => {
              const before = await bookingIds(tx);
              const pause = Math.random() * 0.01;
              const [backend] = await tx.$queryRaw<{ pid: number }[]>`
                SELECT pg_backend_pid()::int AS pid FROM pg_sleep(${pause})`;
              const after = await bookingIds(tx);
              if (backend) {
                const names = served.get(backend.pid) ?? new Set<string>();
                names.add(chosen.name);
                served.set(backend.pid, names);
              }
              for (const seen of [before, after]) {
                if (seen.join() !== chosen.sees.join()) {
                  mismatches.push(`unit ${String(index)} as ${chosen.name} saw ${seen.join()}`);
                }
              }
              if (fails) throw new Error('deliberate failure');
            },
            PATIENT,
          );
        } catch (error) {
          if (!fails || (error as Error).message !== 'deliberate failure') throw error;
        }
      }),
    );

    expect(mismatches).toEqual([]);
    return served;
  }

  describe('visibility', () => {
    it('shows nothing, without an error, when no context is set', async () => {
      expect(await bookingIds(api)).toEqual([]);
    });

    it('shows each party its own bookings and the platform all of them', async () => {
      expect(await withDbContext(api, customerA(), bookingIds)).toEqual([a.id]);
      expect(await withDbContext(api, customerB(), bookingIds)).toEqual([b.id]);
      expect(await withDbContext(api, labA(), bookingIds)).toEqual([a.id]);
      expect(await withDbContext(api, platform(), bookingIds)).toEqual([a.id, b.id].sort());
    });

    it('fails, rather than opens, when the organisation id is not a UUID', async () => {
      const result = await failure(() =>
        withDbContext(api, { kind: 'tenant', orgId: 'not-a-uuid', userId: 'x' }, bookingIds),
      );
      expect(result.state).toBe('22P02');
    });

    it('gives a query sent through the outer client no context', async () => {
      const seen = await withDbContext(api, customerA(), () => bookingIds(api));
      expect(seen).toEqual([]);
    });
  });

  describe('a reused connection', () => {
    // A pool of one: every query below runs on the same database connection.
    let single: PrismaClient;
    beforeAll(() => {
      single = connect(loginUrl(apiRole), 1);
    });

    it('carries nothing over after a commit', async () => {
      expect(await withDbContext(single, customerA(), bookingIds)).toEqual([a.id]);
      const [row] = await single.$queryRaw<{ org: string | null }[]>`
        SELECT current_setting('app.org_id', true) AS org`;
      // Empty string, not NULL: the policy helpers treat both as "no access".
      expect(row?.org).toBe('');
      expect(await bookingIds(single)).toEqual([]);
      expect(await withDbContext(single, customerB(), bookingIds)).toEqual([b.id]);
    });

    it('carries nothing over after a rollback', async () => {
      await expect(
        withDbContext(single, platform(), async (tx) => {
          expect(await bookingIds(tx)).toHaveLength(2);
          throw new Error('rolled back');
        }),
      ).rejects.toThrow('rolled back');
      expect(await bookingIds(single)).toEqual([]);
      expect(await withDbContext(single, customerA(), bookingIds)).toEqual([a.id]);
    });
  });

  describe('writes', () => {
    it("cannot change another tenant's booking", async () => {
      const one = await failure(() =>
        withDbContext(api, customerA(), (tx) =>
          tx.booking.update({ where: { id: b.id }, data: { itemName: 'changed' } }),
        ),
      );
      expect(one.code).toBe('P2025'); // Prisma: record not found
      const many = await withDbContext(api, customerA(), (tx) =>
        tx.booking.updateMany({ where: { id: b.id }, data: { itemName: 'changed' } }),
      );
      expect(many.count).toBe(0);
      const { rows } = await db().query('SELECT item_name FROM booking WHERE id = $1', [b.id]);
      expect(rows).toEqual([{ item_name: 'DEMO cement sample' }]);
    });

    it('cannot insert a row that belongs to another organisation (WITH CHECK)', async () => {
      const draft = (lab: World['lab'], versionNo: number) => ({
        id: uuid(),
        organisationId: lab.org,
        labSiteId: lab.site,
        versionNo,
      });
      const refused = await failure(() =>
        withDbContext(api, labA(), (tx) => tx.priceList.create({ data: draft(world.otherLab, 7) })),
      );
      expect(refused.state).toBe(PG.privilege);

      const created = await withDbContext(api, labA(), (tx) =>
        tx.priceList.create({ data: draft(world.lab, 7) }),
      );
      expect(created.status).toBe('DRAFT');
    });

    it('rolls back everything in the unit of work when it fails', async () => {
      const id = uuid();
      await expect(
        withDbContext(api, labA(), async (tx) => {
          await tx.priceList.create({
            data: { id, organisationId: world.lab.org, labSiteId: world.lab.site, versionNo: 8 },
          });
          throw new Error('after the insert');
        }),
      ).rejects.toThrow('after the insert');
      const { rowCount } = await db().query('SELECT 1 FROM price_list WHERE id = $1', [id]);
      expect(rowCount).toBe(0);
    });

    it('cannot delete a booking', async () => {
      const result = await failure(() =>
        withDbContext(api, customerA(), (tx) => tx.booking.delete({ where: { id: a.id } })),
      );
      expect(result.state).toBe(PG.privilege);
    });
  });

  describe('outbox', () => {
    const event = () => ({
      id: uuid(),
      aggregateType: 'booking',
      aggregateId: a.id,
      eventType: 'demo.created',
      payload: { demo: true },
      occurredAt: new Date(),
    });

    it('accepts createMany from the API but not create, which reads the row back', async () => {
      const added = await withDbContext(api, customerA(), (tx) =>
        tx.outboxEvent.createMany({ data: [event()] }),
      );
      expect(added.count).toBe(1);

      const refused = await failure(() =>
        withDbContext(api, customerA(), (tx) => tx.outboxEvent.create({ data: event() })),
      );
      expect(refused.state).toBe(PG.privilege);
    });

    it('can be read by the worker and not by the API', async () => {
      const refused = await failure(() =>
        withDbContext(api, platform(), (tx) => tx.outboxEvent.count()),
      );
      expect(refused.state).toBe(PG.privilege);
      const visible = await withDbContext(worker, { kind: 'system' }, (tx) =>
        tx.outboxEvent.count(),
      );
      expect(visible).toBeGreaterThan(0);
    });
  });

  describe('the system context', () => {
    it('is not tied to the database role: the API role can use it too (OQ-30)', async () => {
      // Recorded, not endorsed. The API needs it before a user is known (finding a
      // session by its token, a user by email), so the policies cannot refuse it by role.
      expect(await withDbContext(api, { kind: 'system' }, bookingIds)).toHaveLength(2);
    });
  });

  describe('under load', () => {
    it('keeps 600 concurrent units of work apart on a pool of 4', async () => {
      const served = await hammer(api, 600);
      // The same few connections served every context, so the isolation is per transaction.
      expect(served.size).toBeLessThanOrEqual(4);
      for (const names of served.values()) expect(names.size).toBeGreaterThan(1);
    });
  });

  describe('through PgBouncer in transaction mode', () => {
    let bouncer: StartedTestContainer | undefined;
    let pooled: PrismaClient;

    beforeAll(async () => {
      // PgBouncer hands a server connection to a client for one transaction only.
      // Three server connections behind a client pool of twelve.
      const port = new URL(url()).port;
      const config = [
        '[databases]',
        `* = host=host.docker.internal port=${port}`,
        '[pgbouncer]',
        'listen_addr = 0.0.0.0',
        'listen_port = 6432',
        'unix_socket_dir =',
        'auth_type = scram-sha-256',
        'auth_file = /etc/pgbouncer/userlist.txt',
        'pool_mode = transaction',
        'default_pool_size = 3',
        'max_client_conn = 100',
        'ignore_startup_parameters = extra_float_digits',
        '',
      ].join('\n');
      bouncer = await new GenericContainer('edoburu/pgbouncer:v1.26.1-p0')
        .withExposedPorts(6432)
        .withExtraHosts([{ host: 'host.docker.internal', ipAddress: 'host-gateway' }])
        .withCopyContentToContainer([
          { content: config, target: '/etc/pgbouncer/pgbouncer.ini', mode: 0o644 },
          {
            content: `"${apiRole}" "${PASSWORD}"\n`,
            target: '/etc/pgbouncer/userlist.txt',
            mode: 0o644,
          },
        ])
        .withWaitStrategy(Wait.forListeningPorts())
        .start();
      const through = new URL(url());
      through.hostname = bouncer.getHost();
      through.port = String(bouncer.getMappedPort(6432));
      pooled = connect(loginUrl(apiRole, through.toString()), 12);
    });

    afterAll(async () => {
      await bouncer?.stop();
    });

    it('shows each tenant its own rows and nothing without a context', async () => {
      expect(await bookingIds(pooled)).toEqual([]);
      expect(await withDbContext(pooled, customerA(), bookingIds)).toEqual([a.id]);
      expect(await withDbContext(pooled, customerB(), bookingIds)).toEqual([b.id]);
      expect(await bookingIds(pooled)).toEqual([]);
    });

    it('keeps 600 concurrent units of work apart on 3 server connections', async () => {
      const served = await hammer(pooled, 600);
      expect(served.size).toBeLessThanOrEqual(3);
      for (const names of served.values()) expect(names.size).toBeGreaterThan(1);
    });
  });
});
