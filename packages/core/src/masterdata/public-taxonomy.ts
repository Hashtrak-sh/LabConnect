import { Prisma, type PrismaClient } from '@labconnect/database';
import { istDateKey } from '../platform/business-calendar.js';
import type { Clock } from '../platform/clock.js';
import { CoreError } from '../platform/errors.js';
import { withPublicReadContext } from '../platform/public-context.js';

/*
 * The public read side of the taxonomies (`TaxonomyService`, MODULE_BOUNDARIES: the shared
 * masterdata module owns `md_taxonomy`, `md_node_type` and `md_node`). Taxonomies are public
 * reference data (TENANT_ISOLATION section 1), read as an anonymous visitor.
 */

/** An active value of a taxonomy, as a search filter shows it (`PublicTaxonomyNode`, FR-DIS-03). */
export interface PublicTaxonomyNodeView {
  code: string;
  name: string;
  /** `md_node_type.code`, for example `DISCIPLINE`. */
  nodeType: string;
  /** `null` at the top level. */
  parentCode: string | null;
}

export interface PublicTaxonomyQuery {
  /** Code of the parent node; `null` for the top level. */
  parent: string | null;
  cursor: string | null;
  /** 1 to 100. */
  limit: number;
}

export interface PublicTaxonomyPage {
  nodes: PublicTaxonomyNodeView[];
  nextCursor: string | null;
}

export interface TaxonomyDirectoryDeps {
  prisma: Pick<PrismaClient, '$transaction'>;
  clock: Clock;
}

interface NodeRow {
  id: string;
  code: string;
  name: string;
  node_type: string;
  parent_code: string | null;
}

const CURSOR_PREFIX = 'tx1.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidCursor(): CoreError {
  return new CoreError('VALIDATION_FAILED', {
    detail: 'The cursor is not valid. Start again from the first page.',
  });
}

function encodeCursor(name: string, id: string): string {
  return CURSOR_PREFIX + Buffer.from(JSON.stringify([name, id]), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): [string, string] {
  if (!cursor.startsWith(CURSOR_PREFIX)) throw invalidCursor();
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(cursor.slice(CURSOR_PREFIX.length), 'base64url').toString('utf8'),
    );
  } catch {
    throw invalidCursor();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'string' ||
    typeof parsed[1] !== 'string' ||
    !UUID.test(parsed[1])
  ) {
    throw invalidCursor();
  }
  return [parsed[0], parsed[1]];
}

export class TaxonomyDirectory {
  constructor(private readonly deps: TaxonomyDirectoryDeps) {}

  /**
   * A page of a taxonomy's active values (FR-DIS-03, `listTaxonomyNodes`): the top level, or the
   * children of `parent`, ordered by name. Active means status `ACTIVE` and inside the node's
   * effective dates today (IST). `null` when the taxonomy is not active or `parent` is not an
   * active node of it (404).
   */
  async listPublicNodes(
    taxonomyCode: string,
    query: PublicTaxonomyQuery,
  ): Promise<PublicTaxonomyPage | null> {
    const today = istDateKey(this.deps.clock.now());
    const after = query.cursor === null ? null : decodeCursor(query.cursor);
    const activeNode = (alias: string): Prisma.Sql => Prisma.sql`
      ${Prisma.raw(alias)}.status = 'ACTIVE'
      AND (${Prisma.raw(alias)}.effective_from IS NULL OR ${Prisma.raw(alias)}.effective_from <= ${today}::date)
      AND (${Prisma.raw(alias)}.effective_to IS NULL OR ${Prisma.raw(alias)}.effective_to >= ${today}::date)`;

    return withPublicReadContext(this.deps.prisma, async (tx) => {
      const taxonomies = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM md_taxonomy WHERE code = ${taxonomyCode} AND status = 'ACTIVE'`);
      const taxonomy = taxonomies[0];
      if (!taxonomy) return null;

      let parentFilter = Prisma.sql`n.parent_id IS NULL`;
      if (query.parent !== null) {
        const parents = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT p.id FROM md_node p
           WHERE p.taxonomy_id = ${taxonomy.id}::uuid AND p.code = ${query.parent}
             AND ${activeNode('p')}`);
        const parent = parents[0];
        if (!parent) return null;
        parentFilter = Prisma.sql`n.parent_id = ${parent.id}::uuid`;
      }
      const afterFilter =
        after === null
          ? Prisma.sql`TRUE`
          : Prisma.sql`(n.name, n.id::text) > (${after[0]}, ${after[1]})`;

      const rows = await tx.$queryRaw<NodeRow[]>(Prisma.sql`
        SELECT n.id, n.code, n.name, t.code AS node_type, pn.code AS parent_code
          FROM md_node n
          JOIN md_node_type t ON t.id = n.node_type_id
          LEFT JOIN md_node pn ON pn.id = n.parent_id
         WHERE n.taxonomy_id = ${taxonomy.id}::uuid AND ${parentFilter}
           AND ${activeNode('n')} AND ${afterFilter}
         ORDER BY n.name, n.id::text
         LIMIT ${query.limit + 1}`);

      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        nodes: page.map((row) => ({
          code: row.code,
          name: row.name,
          nodeType: row.node_type,
          parentCode: row.parent_code,
        })),
        nextCursor:
          rows.length > query.limit && last !== undefined ? encodeCursor(last.name, last.id) : null,
      };
    });
  }
}
