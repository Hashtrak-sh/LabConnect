import type { Prisma } from '@labconnect/database';
import { type CurrentActor, type OrganisationActor, requireOrganisation } from './actor.js';

// The repository pattern (CODING_STANDARDS.md section 2, TENANT_ISOLATION.md section 2 rule 3).
//
// A repository is the only place Prisma is called on its tables. It is built from the transaction
// of a `TenantScope` and the actor of the request:
//
//   const members = await scope.run(actor, (tx) => new MembershipRepository(tx, actor).list());
//
// Two layers keep a tenant out of another's rows, and neither replaces the other:
//   1. row-level security in the database (the `tx` carries the actor's organisation);
//   2. the repository adds the organisation predicate itself, in every method. If a method ever
//      ran under a wider context (`system`, `platform`), or a policy had a hole, the query is
//      still limited to the actor's organisation.
//
// A row that is not in scope is *not found* (`null`), never "forbidden": existence does not leak
// (rule 5). Lab site scope (rule 4) is enforced here and nowhere else, since RLS compares
// organisations, not sites: a repository of lab-site data filters by `labSiteScope`.

export abstract class TenantRepository {
  /** The organisation every query is limited to. From the actor, never from a parameter. */
  protected readonly orgId: string;
  protected readonly member: OrganisationActor;

  constructor(
    protected readonly tx: Prisma.TransactionClient,
    protected readonly actor: CurrentActor,
  ) {
    // A user with no membership has no organisation: 403 before any query is built.
    this.member = requireOrganisation(actor);
    this.orgId = this.member.orgId;
  }

  /**
   * The lab sites a query on site-bound lab data may return: `'ALL'` for platform staff, else
   * the member's assigned sites (an empty list means none). Use it as `{ labSiteId: { in: ids } }`.
   */
  protected labSiteScope(): 'ALL' | readonly string[] {
    return this.member.allSites ? 'ALL' : this.member.siteIds;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids come from URLs. Anything that is not a UUID cannot exist: not found, not a database error. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
