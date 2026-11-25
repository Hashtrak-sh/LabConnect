import { type ConfigScope, type Prisma, type PrismaClient, uuidv7 } from '@labconnect/database';
import { AUDIT_ACTIONS, type AuditActor, type AuditService } from './audit.js';
import type { Clock } from './clock.js';

/** Reads and writes need only the config table, so a plain client or a transaction both work. */
export type ConfigDb = Pick<PrismaClient, 'configParameter'> | Prisma.TransactionClient;

/** One scope a value can be defined for. `GLOBAL` has no id; the others require one. */
export interface ConfigScopeRef {
  type: ConfigScope;
  id?: string;
}

export interface ConfigReadOptions {
  /**
   * Scopes to try, most specific first (for example `[LAB_SITE, LAB_ORG]`). The `GLOBAL`
   * scope is always tried last. The service does not know how a site relates to its
   * organisation, so the caller lists the chain (OQ-62).
   */
  scopes?: ConfigScopeRef[];
  /** The instant the value must be effective at. Defaults to the clock's now. */
  at?: Date;
}

export interface ConfigValue<T> {
  value: T;
  scope: ConfigScopeRef;
  effectiveFrom: Date;
}

/** No row is effective for the key, in any scope tried, at that instant. There is no silent default. */
export class ConfigParameterMissingError extends Error {
  constructor(
    readonly key: string,
    readonly at: Date,
  ) {
    super(`No configuration value for "${key}" is effective at ${at.toISOString()}.`);
    this.name = 'ConfigParameterMissingError';
  }
}

/** A stored value that the caller's parser rejected. The value is not repeated in the message. */
export class ConfigParameterInvalidError extends Error {
  constructor(
    readonly key: string,
    cause: unknown,
  ) {
    super(`The configuration value for "${key}" is not valid.`, { cause });
    this.name = 'ConfigParameterInvalidError';
  }
}

export class ConfigChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigChangeError';
  }
}

/** Parsers for the usual value shapes. Each throws on anything else. */
function parseInteger(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) {
    throw new TypeError('expected an integer');
  }
  return raw;
}

export const configParsers: {
  integer: (raw: unknown) => number;
  nonNegativeInteger: (raw: unknown) => number;
  positiveInteger: (raw: unknown) => number;
  boolean: (raw: unknown) => boolean;
  string: (raw: unknown) => string;
} = {
  integer: parseInteger,
  nonNegativeInteger: (raw) => {
    const value = parseInteger(raw);
    if (value < 0) throw new RangeError('expected a non-negative integer');
    return value;
  },
  positiveInteger: (raw) => {
    const value = parseInteger(raw);
    if (value < 1) throw new RangeError('expected a positive integer');
    return value;
  },
  boolean: (raw) => {
    if (typeof raw !== 'boolean') throw new TypeError('expected true or false');
    return raw;
  },
  string: (raw) => {
    if (typeof raw !== 'string') throw new TypeError('expected a string');
    return raw;
  },
};

export interface ConfigChange {
  key: string;
  scope: ConfigScopeRef;
  /** Any JSON value; the caller validates it against the key's schema first. */
  value: Prisma.InputJsonValue;
  /** Why the value changes. Required and stored with the new row. */
  reason: string;
  /** When the new value starts to apply. Defaults to the clock's now. */
  effectiveFrom?: Date;
  /** Who made the change, for `created_by_user_id` and the audit entry. */
  actor: AuditActor | 'SYSTEM';
  requestId?: string;
}

/**
 * Effective configuration (SCHEMA_SPECIFICATION.md 1.1). Values are versioned: a change
 * closes the current row (`effective_to`) and inserts a new one, so what applied at any
 * past instant can always be read back. Named `ConfigParameters` so it does not clash with
 * Nest's `ConfigService`.
 */
export class ConfigParameters {
  constructor(
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** The value effective for the key, parsed; throws if there is none or the parser rejects it. */
  async get<T>(
    db: ConfigDb,
    key: string,
    parse: (raw: unknown) => T,
    options: ConfigReadOptions = {},
  ): Promise<T> {
    return (await this.getWithScope(db, key, parse, options)).value;
  }

  /** Like `get`, and says which scope supplied the value and since when. */
  async getWithScope<T>(
    db: ConfigDb,
    key: string,
    parse: (raw: unknown) => T,
    options: ConfigReadOptions = {},
  ): Promise<ConfigValue<T>> {
    const at = options.at ?? this.clock.now();
    const chain = [...(options.scopes ?? []), { type: 'GLOBAL' as const }];
    for (const scope of chain) validateScope(scope);

    const rows = await db.configParameter.findMany({
      where: {
        key,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
        AND: [
          {
            OR: chain.map((scope) => ({
              scopeType: scope.type,
              scopeId: scope.type === 'GLOBAL' ? null : (scope.id ?? null),
            })),
          },
        ],
      },
    });

    for (const scope of chain) {
      const row = rows.find(
        (candidate) =>
          candidate.scopeType === scope.type &&
          (candidate.scopeId ?? undefined) === (scope.type === 'GLOBAL' ? undefined : scope.id),
      );
      if (!row) continue;
      try {
        return {
          value: parse(row.value),
          scope: scope.id === undefined ? { type: scope.type } : { type: scope.type, id: scope.id },
          effectiveFrom: row.effectiveFrom,
        };
      } catch (error) {
        throw new ConfigParameterInvalidError(key, error);
      }
    }
    throw new ConfigParameterMissingError(key, at);
  }

  /**
   * Changes a value from `effectiveFrom` on: closes the open row for the key and scope,
   * inserts the new row and writes a `config.change` audit entry, all in the caller's
   * transaction. Two concurrent changes cannot both succeed: the row is locked, and the
   * table's exclusion constraint rejects overlapping windows.
   */
  async set(tx: Prisma.TransactionClient, change: ConfigChange): Promise<{ id: string }> {
    validateScope(change.scope);
    if (change.reason.trim().length === 0) {
      throw new ConfigChangeError('A configuration change needs a reason.');
    }
    const from = change.effectiveFrom ?? this.clock.now();
    const scopeId = change.scope.type === 'GLOBAL' ? null : (change.scope.id ?? null);

    // Lock the open row, if any, so that a second writer waits for this transaction.
    const open = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM config_parameter
       WHERE key = ${change.key} AND scope_type = ${change.scope.type}::config_scope
         AND scope_id IS NOT DISTINCT FROM ${scopeId}::uuid AND effective_to IS NULL
       FOR UPDATE`;
    const current = open[0]
      ? await tx.configParameter.findUniqueOrThrow({ where: { id: open[0].id } })
      : null;

    if (current && current.effectiveFrom >= from) {
      throw new ConfigChangeError(
        'The new value must start after the current one (versions are never overwritten).',
      );
    }
    if (current) {
      await tx.configParameter.update({
        where: { id: current.id },
        data: { effectiveTo: from },
      });
    }

    const id = uuidv7(this.clock.now().getTime());
    const actorUserId = change.actor === 'SYSTEM' ? null : change.actor.userId;
    await tx.configParameter.createMany({
      data: [
        {
          id,
          key: change.key,
          scopeType: change.scope.type,
          scopeId,
          value: change.value,
          effectiveFrom: from,
          changeReason: change.reason,
          createdByUserId: actorUserId,
        },
      ],
    });

    const entry = {
      actor: change.actor,
      action: AUDIT_ACTIONS.CONFIG_CHANGE,
      entityType: 'config_parameter',
      entityId: id,
      before: current ? { key: change.key, scope: change.scope, value: current.value } : undefined,
      after: { key: change.key, scope: change.scope, value: change.value },
      reason: change.reason,
    };
    await this.audit.record(
      tx,
      change.requestId ? { ...entry, requestId: change.requestId } : entry,
    );
    return { id };
  }
}

function validateScope(scope: ConfigScopeRef): void {
  if (scope.type === 'GLOBAL' && scope.id !== undefined) {
    throw new ConfigChangeError('The GLOBAL scope has no id.');
  }
  if (scope.type !== 'GLOBAL' && scope.id === undefined) {
    throw new ConfigChangeError(`The ${scope.type} scope needs an id.`);
  }
}
