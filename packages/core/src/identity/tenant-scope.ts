import {
  type DbContext,
  type DbContextOptions,
  type Prisma,
  type PrismaClient,
  uuidv7,
  withDbContext,
} from '@labconnect/database';
import type { AuditService } from '../platform/audit.js';
import { type CurrentActor, requireOrganisation } from './actor.js';
import { IdentityError } from './errors.js';
import { isUuid } from './repository.js';

// The only door to the database for request-level work (TENANT_ISOLATION.md section 3, ADR-005).
//
// Every unit of work runs in ONE interactive transaction whose first statement sets the row-level
// security settings (`withDbContext`). The context is derived from the CurrentActor, which is
// derived from the session and the database. Nothing here takes an organisation id from a request,
// except `runOnBehalfOf`, the single recorded exception (OQ-53).
//
// Rules for the `work` callback:
// - Use only the `tx` it receives. A query through any other client runs on another connection,
//   without the settings, and sees no tenant rows.
// - Keep it short. The transaction holds a pooled connection (Prisma's default timeout is 5 s).
//   Never call anything slow or external inside it: no payment gateway, mail, file or HTTP call.
//   Do those before or after the transaction; write an outbox event inside it instead.
// - One request-level unit of work is one `run`. Do not nest scopes.

const MAX_REASON_LENGTH = 200;

/**
 * The database context of an actor. A member of a customer or lab organisation runs as that
 * organisation (`tenant`); platform staff run as `platform`, without an organisation (the policies
 * give the platform role-based access, and the services narrow it by permission). A user with no
 * membership has no context: `403 FORBIDDEN`.
 */
export function dbContextFor(actor: CurrentActor): DbContext {
  const member = requireOrganisation(actor);
  return member.isPlatform
    ? { kind: 'platform', userId: member.userId }
    : { kind: 'tenant', orgId: member.orgId, userId: member.userId };
}

export type ScopedWork<T> = (tx: Prisma.TransactionClient) => Promise<T>;

export class TenantScope {
  constructor(
    private readonly prisma: Pick<PrismaClient, '$transaction'>,
    private readonly audit: AuditService,
  ) {}

  /**
   * Runs `work` as the actor: its organisation, or the platform for platform staff. The normal
   * way for a service to touch tenant data.
   */
  run<T>(actor: CurrentActor, work: ScopedWork<T>, options?: DbContextOptions): Promise<T> {
    return rejecting(() => withDbContext(this.prisma, dbContextFor(actor), work, options));
  }

  /**
   * Runs `work` as one user and no organisation: the policies show the user only their own rows
   * (sessions, MFA factors, their own memberships). For the flows that come before an
   * organisation is chosen (identity, `/me`) and for resolving the actor itself.
   */
  runAsUser<T>(userId: string, work: ScopedWork<T>, options?: DbContextOptions): Promise<T> {
    return withDbContext(this.prisma, { kind: 'tenant', orgId: '', userId }, work, options);
  }

  /**
   * Runs `work` as a user inside an organisation that does not exist yet and that the work
   * creates (customer self-sign-up, FR-ONB-01): the context carries the user and the new
   * organisation's id, so the policies let the work write that organisation's rows and nothing
   * of any other tenant.
   *
   * The id is made here, a fresh UUIDv7 for `at`, and handed to `work`, which must create the
   * organisation with it. No caller can pass one: the `membership` policy checks only
   * `organisation_id = app_org_id()`, so an existing organisation's id would let the work add a
   * member and a role to that organisation. The callers are listed in
   * `system-context.sources.spec.ts`, so a new one shows up in review.
   */
  runForNewOrganisation<T>(
    userId: string,
    at: Date,
    work: (tx: Prisma.TransactionClient, organisationId: string) => Promise<T>,
    options?: DbContextOptions,
  ): Promise<T> {
    const organisationId = uuidv7(at.getTime());
    return rejecting(() =>
      withDbContext(
        this.prisma,
        { kind: 'tenant', orgId: organisationId, userId },
        (tx) => work(tx, organisationId),
        options,
      ),
    );
  }

  /**
   * OQ-53: `PLATFORM_OPS` creates a booking on behalf of a customer. The customer organisation
   * comes from the request, the only place the API takes an organisation id from the client, so
   * it is checked here and nowhere else:
   * - only an actor that holds `PLATFORM_OPS` may; anyone else is `403 FORBIDDEN`;
   * - the organisation must exist, be a `CUSTOMER` and be `ACTIVE`, else `404 NOT_FOUND`;
   * - the work runs as the platform with that organisation set (`app.org_id`);
   * - an `platform.act_on_behalf` audit row is written first, in the same transaction, with the
   *   reason. The caller still records `on_behalf_of` on the record it creates.
   */
  async runOnBehalfOf<T>(
    actor: CurrentActor,
    target: { organisationId: string; reason: string; requestId?: string },
    work: ScopedWork<T>,
    options?: DbContextOptions,
  ): Promise<T> {
    if (!actor.isPlatform || !actor.roles.includes('PLATFORM_OPS')) {
      throw new IdentityError('FORBIDDEN', {
        detail: 'Only platform operations staff may act on behalf of an organisation.',
      });
    }
    const reason = checkedReason(target.reason);
    if (!isUuid(target.organisationId)) throw new IdentityError('NOT_FOUND');
    const member = requireOrganisation(actor);

    return withDbContext(
      this.prisma,
      { kind: 'platform', userId: member.userId, orgId: target.organisationId },
      async (tx) => {
        const organisation = await tx.organisation.findUnique({
          where: { id: target.organisationId },
          select: { orgType: true, status: true },
        });
        if (organisation?.orgType !== 'CUSTOMER' || organisation.status !== 'ACTIVE') {
          throw new IdentityError('NOT_FOUND');
        }
        await this.audit.record(tx, {
          actor: {
            userId: member.userId,
            membershipId: member.membershipId,
            role: 'PLATFORM_OPS',
            orgId: member.orgId,
          },
          action: 'platform.act_on_behalf',
          entityType: 'organisation',
          entityId: target.organisationId,
          reason,
          ...(target.requestId !== undefined && { requestId: target.requestId }),
        });
        return work(tx);
      },
      options,
    );
  }

  /**
   * Runs `work` as `system`: every tenant's rows are visible (OQ-30). It is not for feature
   * code: use it only where there is no user yet (finding a session by its token, signing in) or
   * for a job. The name is greppable on purpose and a test lists every caller, so a new one shows
   * up in review. `reason` says why a request or job needs to see across tenants; it is required.
   */
  runAsSystem<T>(reason: string, work: ScopedWork<T>, options?: DbContextOptions): Promise<T> {
    return rejecting(() => {
      checkedReason(reason);
      return withDbContext(this.prisma, { kind: 'system' }, work, options);
    });
  }
}

/** A refusal made before the transaction opens is a rejected promise, like every other failure. */
function rejecting<T>(start: () => Promise<T>): Promise<T> {
  try {
    return start();
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

function checkedReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_REASON_LENGTH) {
    throw new RangeError(`A reason of 1 to ${String(MAX_REASON_LENGTH)} characters is required.`);
  }
  return trimmed;
}
