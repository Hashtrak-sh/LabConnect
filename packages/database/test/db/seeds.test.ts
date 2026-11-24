import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BookingStatus } from '../../src/generated/prisma/client.js';
import { DEMO_SCOPE_LINES_PER_SITE, DEMO_SITE_COUNT, seedDemo } from '../../src/seed/demo.js';
import { createLocalLoginUsers } from '../../src/seed/local-users.js';
import { seedPlatformAdmin } from '../../src/seed/platform-admin.js';
import {
  CONFIG_DEFAULTS,
  LEDGER_ACCOUNTS,
  NOTIFICATION_TEMPLATES,
  TAXONOMIES,
} from '../../src/seed/reference-data.js';
import { seedReference } from '../../src/seed/reference.js';
import { PATIENT, usePrisma } from './prisma.js';

// P1-10: seed:reference, seed:platform-admin and seed:demo
// (docs/03-database/MIGRATION_AND_SEED_STRATEGY.md section 3).

const docs = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'docs');
const doc = (path: string): string => readFileSync(join(docs, path), 'utf8');
const NOW = new Date('2026-11-24T06:00:00.000Z');

describe('seed:reference', () => {
  const { prisma } = usePrisma();

  it('adds the reference data, and nothing on a second run', async () => {
    const first = await prisma().$transaction((tx) => seedReference(tx, { now: NOW }), PATIENT);
    expect(first.md_taxonomy).toBe(TAXONOMIES.length);
    expect(first.config_parameter).toBe(CONFIG_DEFAULTS.length);
    expect(first.ledger_account).toBe(LEDGER_ACCOUNTS.length);
    expect(first.qr_signing_key).toBe(3);
    expect(first.holiday_calendar).toBe(6);

    const second = await prisma().$transaction((tx) => seedReference(tx, { now: NOW }), PATIENT);
    expect(second).toEqual({});
  });

  it('keeps a value an administrator changed', async () => {
    const key = 'booking.max_open_requests_per_customer';
    await prisma().configParameter.updateMany({ where: { key }, data: { value: 25 } });
    await prisma().$transaction((tx) => seedReference(tx, { now: NOW }), PATIENT);
    const rows = await prisma().configParameter.findMany({ where: { key } });
    expect(rows.map((row) => row.value)).toEqual([25]);
  });

  it('has the SCOPE levels in order and one VALUE level for each flat taxonomy', async () => {
    const taxonomies = await prisma().mdTaxonomy.findMany({ where: { isSystem: true } });
    expect(taxonomies.map((row) => row.code).sort()).toEqual(
      TAXONOMIES.map((taxonomy) => taxonomy.code).sort(),
    );
    const scope = taxonomies.find((row) => row.code === 'SCOPE');
    const levels = await prisma().mdNodeType.findMany({
      where: { taxonomyId: scope?.id ?? '' },
      orderBy: { level: 'asc' },
    });
    expect(levels.map((level) => level.code)).toEqual([
      'DISCIPLINE',
      'GROUP',
      'PRODUCT',
      'PARAMETER',
    ]);
    expect(levels[1]?.parentNodeTypeId).toBe(levels[0]?.id);
    expect(await prisma().mdNodeType.count({ where: { code: 'VALUE' } })).toBe(
      TAXONOMIES.length - 1,
    );
  });

  it('names every taxonomy that MASTER_DATA_MANAGEMENT.md lists', () => {
    const block = /md_taxonomy \(([^)]+)\)/.exec(doc('03-database/MASTER_DATA_MANAGEMENT.md'))?.[1];
    const listed = (block ?? '').match(/[A-Z][A-Z_]+/g) ?? [];
    expect(listed.length).toBeGreaterThan(5);
    const seeded = TAXONOMIES.map((taxonomy) => taxonomy.code);
    for (const code of listed) expect(seeded).toContain(code);
  });

  it('has the ledger accounts of the schema specification', async () => {
    const line = doc('03-database/SCHEMA_SPECIFICATION.md')
      .split('\n')
      .find((text) => text.startsWith('`code varchar(40)`'));
    const listed = (
      /\(([^)]+)\)/.exec(line?.slice('`code varchar(40)`'.length) ?? '')?.[1] ?? ''
    ).match(/[A-Z_]{4,}/g);
    const accounts = await prisma().ledgerAccount.findMany({ where: { partyOrgId: null } });
    expect(accounts.map((account) => account.code).sort()).toEqual([...(listed ?? [])].sort());
  });

  it('has a default for a rule that exists, and only supports testing for booking', async () => {
    const rules = doc('01-product/BUSINESS_RULES.md') + doc('01-product/CONFIRMED_DECISIONS.md');
    for (const config of CONFIG_DEFAULTS) {
      for (const rule of config.source.split(', ')) expect(rules).toContain(rule);
    }
    const standards = await prisma().accreditationStandard.findMany();
    expect(
      standards.filter((standard) => standard.isBookable).map((standard) => standard.code),
    ).toEqual(['ISO_IEC_17025_TESTING']);
    expect(standards.find((standard) => standard.code === 'ISO_15189')?.isSupported).toBe(false);
  });

  it('seeds a platform fee of zero and 10% cancellation and no-show fees', async () => {
    const fees = await prisma().feeRule.findMany();
    const value = (type: string): bigint | undefined =>
      fees.find((fee) => fee.feeType === type)?.value;
    expect(value('PLATFORM_FEE')).toBe(0n);
    expect(value('CANCELLATION_FEE')).toBe(1000n);
    expect(value('NO_SHOW_FEE')).toBe(1000n);
  });

  it('has a template for every event and MVP channel of NOTIFICATIONS_MATRIX.md', async () => {
    const expected: string[] = [];
    for (const row of doc('01-product/NOTIFICATIONS_MATRIX.md').split('\n')) {
      const cells = row.split('|').map((cell) => cell.trim());
      const codes = cells[1]?.match(/`([a-z_.]+)`/g);
      if (!codes) continue;
      const channels = (cells[7] ?? '').split(',').map((letter) => letter.trim());
      for (const code of codes) {
        for (const letter of channels) {
          expected.push(`${code.replaceAll('`', '')}|${letter === 'E' ? 'EMAIL' : 'IN_APP'}`);
        }
      }
    }
    expect(expected.length).toBeGreaterThan(50);
    const templates = await prisma().notificationTemplate.findMany();
    expect(templates.map((row) => `${row.eventCode}|${row.channel}`).sort()).toEqual(
      expected.sort(),
    );
    // Only whitelisted variables, and never report content.
    const allowed = [
      'bookingNo',
      'labName',
      'deadline',
      'actionUrl',
      'reason',
      'otp',
      'organisationName',
    ];
    for (const template of NOTIFICATION_TEMPLATES) {
      for (const match of `${template.subject} ${template.body}`.matchAll(/\{\{(\w+)\}\}/g)) {
        expect(allowed).toContain(match[1]);
      }
      if (template.eventCode !== 'auth.otp') expect(template.body).not.toContain('{{otp}}');
    }
  });

  it('refuses to invent a KMS key outside a local environment', async () => {
    await prisma().qrSigningKey.updateMany({ data: { status: 'RETIRED' } });
    await expect(
      prisma().$transaction(
        (tx) => seedReference(tx, { now: NOW, env: { APP_ENV: 'uat' } }),
        PATIENT,
      ),
    ).rejects.toThrow('QR_KMS_KEY_ARN_BOOKING is not set');
    const arn = 'arn:aws:kms:ap-south-1:111111111111:key/uat';
    const env = {
      APP_ENV: 'uat',
      QR_KMS_KEY_ARN_BOOKING: arn,
      QR_KMS_KEY_ARN_PACKAGE: arn,
      QR_KMS_KEY_ARN_REPORT: arn,
    };
    // The retired keys keep their ids, so new keys need new ids: that is a rotation, not a seed.
    await expect(
      prisma().$transaction((tx) => seedReference(tx, { now: NOW, env }), PATIENT),
    ).rejects.toThrow();
    await prisma().qrSigningKey.updateMany({ data: { status: 'ACTIVE' } });
  });
});

describe('seed:platform-admin', () => {
  const { prisma } = usePrisma();
  const input = { email: 'First.Admin@Example.test', fullName: 'DEMO First Admin' };

  it('creates the first platform administrator once', async () => {
    const first = await prisma().$transaction((tx) => seedPlatformAdmin(tx, input));
    expect(first.created).toBe(true);
    const second = await prisma().$transaction((tx) => seedPlatformAdmin(tx, input));
    expect(second).toEqual({ ...first, created: false });

    const user = await prisma().appUser.findUniqueOrThrow({ where: { id: first.userId } });
    expect(user).toMatchObject({
      email: 'first.admin@example.test',
      isPlatformStaff: true,
      status: 'ACTIVE',
      mfaEnrolledAt: null, // enrolment is forced at first sign-in
    });
    const roles = await prisma().membershipRole.findMany({
      where: { membership: { userId: first.userId } },
    });
    expect(roles.map((role) => role.role)).toEqual(['PLATFORM_ADMIN']);
    expect(await prisma().organisation.count({ where: { orgType: 'PLATFORM' } })).toBe(1);
  });

  it('refuses an email that belongs to a customer or lab user', async () => {
    await prisma().appUser.create({
      data: {
        id: '018f0000-0000-7000-8000-000000000001',
        email: 'someone@example.test',
        fullName: 'DEMO Someone',
        status: 'ACTIVE',
      },
    });
    await expect(
      prisma().$transaction((tx) =>
        seedPlatformAdmin(tx, { email: 'someone@example.test', fullName: 'DEMO Someone' }),
      ),
    ).rejects.toThrow('not platform staff');
  });

  it('refuses an invalid email', async () => {
    await expect(
      prisma().$transaction((tx) => seedPlatformAdmin(tx, { email: 'nope', fullName: 'X' })),
    ).rejects.toThrow('not a valid address');
  });
});

describe('seed:demo', () => {
  const { prisma } = usePrisma();

  it('refuses to run in production', async () => {
    await expect(
      prisma().$transaction((tx) => seedDemo(tx, { env: { APP_ENV: 'production' } })),
    ).rejects.toThrow('refuses to run when APP_ENV=production');
    expect(await prisma().organisation.count()).toBe(0);
  });

  it('needs the reference data first', async () => {
    await expect(prisma().$transaction((tx) => seedDemo(tx, { now: NOW }))).rejects.toThrow(
      'Run seed:reference',
    );
  });

  it('creates the demo data once', async () => {
    const result = await prisma().$transaction(async (tx) => {
      await seedReference(tx, { now: NOW });
      return seedDemo(tx, { now: NOW });
    }, PATIENT);
    expect(result).toEqual({
      skipped: false,
      labSites: DEMO_SITE_COUNT,
      scopeLines: DEMO_SITE_COUNT * DEMO_SCOPE_LINES_PER_SITE,
      bookings: Object.keys(BookingStatus).length,
    });

    const again = await prisma().$transaction((tx) => seedDemo(tx, { now: NOW }), PATIENT);
    expect(again.skipped).toBe(true);
    expect(await prisma().labSite.count()).toBe(DEMO_SITE_COUNT);
  });

  it('has 200 sites and 5,000 scope lines, each with a published version', async () => {
    expect(await prisma().labSite.count()).toBe(200);
    expect(await prisma().scopeLine.count()).toBe(5000);
    expect(await prisma().scopeLineVersion.count()).toBe(5000);
    const [located] = await prisma().$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM lab_site
       WHERE ST_Y(geo_point::geometry) BETWEEN 28.3 AND 28.8
         AND ST_X(geo_point::geometry) BETWEEN 76.9 AND 77.6`;
    expect(located?.n).toBe(200n); // all within Delhi NCR
  });

  it('marks every organisation, site and user as DEMO', async () => {
    expect(
      await prisma().organisation.count({
        where: { NOT: { displayName: { contains: 'DEMO' } }, orgType: { not: 'PLATFORM' } },
      }),
    ).toBe(0);
    expect(await prisma().labSite.count({ where: { NOT: { name: { startsWith: 'DEMO' } } } })).toBe(
      0,
    );
    expect(
      await prisma().appUser.count({ where: { NOT: { fullName: { startsWith: 'DEMO' } } } }),
    ).toBe(0);
    expect(
      await prisma().appUser.count({
        where: { NOT: { email: { endsWith: '@demo.labconnect.test' } } },
      }),
    ).toBe(0);
  });

  it('has three onboarded labs whose four sites meet the bookability rule (BR-001)', async () => {
    const bookable = await prisma().labSite.findMany({
      where: { isBookable: true },
      include: { organisation: true },
    });
    expect(bookable).toHaveLength(4);
    expect(new Set(bookable.map((site) => site.organisationId)).size).toBe(3);
    for (const site of bookable) {
      expect(site.organisation).toMatchObject({ claimStatus: 'CLAIMED', kycStatus: 'VERIFIED' });
      expect(
        await prisma().bankAccount.count({
          where: { organisationId: site.organisationId, status: 'VERIFIED' },
        }),
      ).toBe(1);
      expect(
        await prisma().accreditation.count({
          where: {
            labSiteId: site.id,
            status: 'VALID',
            validTo: { gt: NOW },
            labCategory: 'TESTING',
          },
        }),
      ).toBe(1);
      expect(
        await prisma().priceList.count({ where: { labSiteId: site.id, status: 'PUBLISHED' } }),
      ).toBe(1);
      const staff = await prisma().membershipRole.findMany({
        where: {
          revokedAt: null,
          membership: { status: 'ACTIVE', membershipSites: { some: { labSiteId: site.id } } },
        },
        include: { membership: true },
      });
      const users = (role: string): string[] =>
        staff.filter((row) => row.role === role).map((row) => row.membership.userId);
      expect(users('LAB_MAKER').length).toBeGreaterThan(0);
      expect(users('LAB_CHECKER').length).toBeGreaterThan(0);
      expect(users('LAB_MAKER').some((id) => users('LAB_CHECKER').includes(id))).toBe(false);
      expect(
        await prisma().slot.count({ where: { labSiteId: site.id, status: 'OPEN' } }),
      ).toBeGreaterThan(0);
    }
    // No site without a valid accreditation is bookable.
    expect(
      await prisma().labSite.count({
        where: { isBookable: true, accreditations: { none: { status: 'VALID' } } },
      }),
    ).toBe(0);
  });

  it('has three customers, one per segment, and one booking in every state', async () => {
    const customers = await prisma().organisation.findMany({ where: { orgType: 'CUSTOMER' } });
    expect(customers.map((customer) => customer.customerSegment).sort()).toEqual([
      'BUSINESS',
      'GOVERNMENT',
      'INDIVIDUAL',
    ]);
    const bookings = await prisma().booking.groupBy({ by: ['status'], _count: true });
    expect(bookings.map((row) => row.status).sort()).toEqual(Object.keys(BookingStatus).sort());
    expect(bookings.every((row) => row._count === 1)).toBe(true);
  });

  it('keeps the slot counters equal to the live holds', async () => {
    const wrong = await prisma().$queryRaw<unknown[]>`
      SELECT s.id FROM slot s
        LEFT JOIN slot_hold h ON h.slot_id = s.id AND h.released_at IS NULL
       GROUP BY s.id
      HAVING s.held_count <> count(*) FILTER (WHERE h.kind = 'SOFT')
          OR s.booked_count <> count(*) FILTER (WHERE h.kind = 'CONFIRMED')`;
    expect(wrong).toEqual([]);
  });
});

describe('local login users', () => {
  const { prisma } = usePrisma();
  const suffix = Math.random().toString(36).slice(2, 8);
  const env = {
    API_DATABASE_URL: `postgresql://lc_local_api_${suffix}:pa'ss@localhost:5432/x`,
    WORKER_DATABASE_URL: `postgresql://lc_local_worker_${suffix}:secret@localhost:5432/x`,
  };

  it('creates one login per application role, once, and only locally', async () => {
    const created = await prisma().$transaction((tx) => createLocalLoginUsers(tx, env));
    expect(created).toEqual([`lc_local_api_${suffix}`, `lc_local_worker_${suffix}`]);
    expect(await prisma().$transaction((tx) => createLocalLoginUsers(tx, env))).toEqual([]);

    const roles = await prisma().$queryRaw<{ member: string; role: string; login: boolean }[]>`
      SELECT m.rolname AS member, r.rolname AS role, m.rolcanlogin AS login
        FROM pg_auth_members a
        JOIN pg_roles m ON m.oid = a.member
        JOIN pg_roles r ON r.oid = a.roleid
       WHERE m.rolname LIKE ${`lc_local_%_${suffix}`} ORDER BY 1`;
    expect(roles).toEqual([
      { member: `lc_local_api_${suffix}`, role: 'app_rw', login: true },
      { member: `lc_local_worker_${suffix}`, role: 'app_worker', login: true },
    ]);

    await expect(
      prisma().$transaction((tx) => createLocalLoginUsers(tx, { ...env, APP_ENV: 'uat' })),
    ).rejects.toThrow('local databases only');
    await expect(
      prisma().$transaction((tx) =>
        createLocalLoginUsers(tx, { ...env, API_DATABASE_URL: 'postgresql://Robert"; DROP:x@h/x' }),
      ),
    ).rejects.toThrow();
  });
});
