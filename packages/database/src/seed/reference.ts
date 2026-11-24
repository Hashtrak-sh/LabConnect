import type { Prisma } from '../generated/prisma/client.js';
import { uuidv7 } from '../ids.js';
import { isLocalEnv } from './env.js';
import {
  ACCREDITATION_BODIES,
  ACCREDITATION_STANDARDS,
  CONFIG_DEFAULTS,
  FEE_RULES,
  FIXED_NATIONAL_HOLIDAYS,
  LEDGER_ACCOUNTS,
  LOCAL_KMS_KEY_ARN,
  NOTIFICATION_TEMPLATES,
  QR_KEYS,
  REFERENCE_EFFECTIVE_FROM,
  TAXONOMIES,
} from './reference-data.js';

export type Tx = Prisma.TransactionClient;

export interface ReferenceSeedOptions {
  /** Defaults to process.env. Read for APP_ENV and the QR key ARNs. */
  env?: Record<string, string | undefined>;
  /** Decides which years the holiday calendar covers. */
  now?: Date;
}

/** Rows created per table. A second run on the same database creates none. */
export type SeedCounts = Record<string, number>;

/**
 * `seed:reference`: the rows every environment needs before the application can work.
 * Runs on every deploy. It only adds what is missing, by stable code, and never changes
 * or removes a row, so values an administrator has edited are kept.
 */
export async function seedReference(
  tx: Tx,
  options: ReferenceSeedOptions = {},
): Promise<SeedCounts> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const counts: SeedCounts = {};
  const add = (table: string, n: number): void => {
    counts[table] = (counts[table] ?? 0) + n;
  };

  // ---- taxonomies, levels and starter values
  for (const taxonomy of TAXONOMIES) {
    let row = await tx.mdTaxonomy.findUnique({ where: { code: taxonomy.code } });
    if (!row) {
      row = await tx.mdTaxonomy.create({
        data: {
          id: uuidv7(),
          code: taxonomy.code,
          name: taxonomy.name,
          isHierarchical: taxonomy.hierarchical,
          isSystem: true,
        },
      });
      add('md_taxonomy', 1);
    }

    const types = await tx.mdNodeType.findMany({ where: { taxonomyId: row.id } });
    let parentTypeId: string | null = null;
    let leafTypeId = '';
    for (const [index, level] of taxonomy.levels.entries()) {
      let type = types.find((candidate) => candidate.code === level.code);
      if (!type) {
        type = await tx.mdNodeType.create({
          data: {
            id: uuidv7(),
            taxonomyId: row.id,
            code: level.code,
            name: level.name,
            level: index + 1,
            parentNodeTypeId: parentTypeId,
          },
        });
        add('md_node_type', 1);
      }
      parentTypeId = type.id;
      leafTypeId = type.id;
    }

    if (taxonomy.nodes.length > 0) {
      const existing = new Set(
        (await tx.mdNode.findMany({ where: { taxonomyId: row.id }, select: { code: true } })).map(
          (node) => node.code,
        ),
      );
      const missing = taxonomy.nodes.filter((node) => !existing.has(node.code));
      if (missing.length > 0) {
        await tx.mdNode.createMany({
          data: missing.map((node) => ({
            id: uuidv7(),
            taxonomyId: row.id,
            nodeTypeId: leafTypeId,
            code: node.code,
            name: node.name,
          })),
        });
        add('md_node', missing.length);
      }
    }
  }

  // ---- accreditation bodies and standards
  for (const body of ACCREDITATION_BODIES) {
    if (!(await tx.accreditationBody.findFirst({ where: { code: body.code } }))) {
      await tx.accreditationBody.create({ data: { id: uuidv7(), ...body } });
      add('accreditation_body', 1);
    }
  }
  for (const standard of ACCREDITATION_STANDARDS) {
    if (!(await tx.accreditationStandard.findFirst({ where: { code: standard.code } }))) {
      await tx.accreditationStandard.create({ data: { id: uuidv7(), ...standard } });
      add('accreditation_standard', 1);
    }
  }

  // ---- ledger chart of accounts (platform-wide accounts only)
  for (const account of LEDGER_ACCOUNTS) {
    if (!(await tx.ledgerAccount.findFirst({ where: { code: account.code, partyOrgId: null } }))) {
      await tx.ledgerAccount.create({ data: { id: uuidv7(), ...account } });
      add('ledger_account', 1);
    }
  }

  // ---- fee rules: one GLOBAL rule per fee type, unless any GLOBAL rule already exists
  for (const rule of FEE_RULES) {
    const exists = await tx.feeRule.findFirst({
      where: { feeType: rule.feeType, scopeType: 'GLOBAL', scopeId: null },
    });
    if (!exists) {
      await tx.feeRule.create({
        data: {
          id: uuidv7(),
          ...rule,
          scopeType: 'GLOBAL',
          effectiveFrom: REFERENCE_EFFECTIVE_FROM,
        },
      });
      add('fee_rule', 1);
    }
  }

  // ---- configuration defaults: one GLOBAL value per key, unless the key already has one
  const configured = new Set(
    (
      await tx.configParameter.findMany({
        where: { scopeType: 'GLOBAL', scopeId: null },
        select: { key: true },
      })
    ).map((row) => row.key),
  );
  const newConfig = CONFIG_DEFAULTS.filter((config) => !configured.has(config.key));
  if (newConfig.length > 0) {
    await tx.configParameter.createMany({
      data: newConfig.map((config) => ({
        id: uuidv7(),
        key: config.key,
        scopeType: 'GLOBAL' as const,
        value: config.value,
        effectiveFrom: REFERENCE_EFFECTIVE_FROM,
        changeReason: `Initial default (${config.source})`,
      })),
    });
    add('config_parameter', newConfig.length);
  }

  // ---- notification templates: version 1 per event and channel, unless any version exists
  const templated = new Set(
    (
      await tx.notificationTemplate.findMany({
        where: { locale: 'en-IN' },
        select: { eventCode: true, channel: true },
      })
    ).map((row) => `${row.eventCode}|${row.channel}`),
  );
  const newTemplates = NOTIFICATION_TEMPLATES.flatMap((template) =>
    template.channels
      .filter((channel) => !templated.has(`${template.eventCode}|${channel}`))
      .map((channel) => ({
        id: uuidv7(),
        eventCode: template.eventCode,
        channel,
        locale: 'en-IN',
        version: 1,
        subject: template.subject,
        body: template.body,
      })),
  );
  if (newTemplates.length > 0) {
    await tx.notificationTemplate.createMany({ data: newTemplates });
    add('notification_template', newTemplates.length);
  }

  // ---- holiday calendar: the fixed national holidays of this year and the next (IST)
  const year = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(now),
  );
  for (const y of [year, year + 1]) {
    for (const holiday of FIXED_NATIONAL_HOLIDAYS) {
      const holidayDate = new Date(Date.UTC(y, holiday.month - 1, holiday.day));
      const exists = await tx.holidayCalendar.findFirst({
        where: { holidayDate, regionCode: null },
      });
      if (!exists) {
        await tx.holidayCalendar.create({
          data: { id: uuidv7(), holidayDate, name: holiday.name },
        });
        add('holiday_calendar', 1);
      }
    }
  }

  // ---- QR signing keys: one ACTIVE key per purpose, pointing at the environment's KMS key
  for (const key of QR_KEYS) {
    const active = await tx.qrSigningKey.findFirst({
      where: { purpose: key.purpose, status: 'ACTIVE' },
    });
    if (active) continue;
    const arn = env[key.env] ?? (isLocalEnv(env) ? LOCAL_KMS_KEY_ARN : undefined);
    if (!arn) {
      throw new Error(
        `${key.env} is not set. It must hold the ARN of the KMS HMAC key for ${key.purpose} QR codes in this environment.`,
      );
    }
    await tx.qrSigningKey.create({
      data: {
        id: uuidv7(),
        keyId: key.keyId,
        purpose: key.purpose,
        kmsKeyArn: arn,
        status: 'ACTIVE',
        activatedAt: now,
      },
    });
    add('qr_signing_key', 1);
  }

  return counts;
}
