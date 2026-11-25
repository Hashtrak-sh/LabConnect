import type { Prisma } from '@labconnect/database';
import type { RoleCode } from '@labconnect/shared';
import { IdentityError } from './errors.js';
import { isUuid, TenantRepository } from './repository.js';

/** A member of the actor's organisation. No email or name: `app_user` is not this table's. */
export interface MemberView {
  id: string;
  userId: string;
  status: 'INVITED' | 'ACTIVE' | 'DEACTIVATED';
  roles: RoleCode[];
  siteIds: string[];
  createdAt: Date;
}

const select = {
  id: true,
  userId: true,
  status: true,
  createdAt: true,
  membershipRoles: { where: { revokedAt: null }, select: { role: true } },
  membershipSites: { where: { revokedAt: null }, select: { labSiteId: true } },
} satisfies Prisma.MembershipSelect;

type Row = Prisma.MembershipGetPayload<{ select: typeof select }>;

function toView(row: Row): MemberView {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    roles: row.membershipRoles.map((entry) => entry.role),
    siteIds: row.membershipSites.map((entry) => entry.labSiteId),
    createdAt: row.createdAt,
  };
}

/**
 * The worked example of the repository pattern (see `TenantRepository`): the memberships of the
 * actor's own organisation. Every query carries `organisationId = actor's organisation` besides
 * what row-level security does. Read-only; the membership commands belong to the identity
 * module's user-management task.
 */
export class MembershipRepository extends TenantRepository {
  /** The organisation's memberships, oldest first. */
  async list(): Promise<MemberView[]> {
    const rows = await this.tx.membership.findMany({
      where: { organisationId: this.orgId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select,
    });
    return rows.map(toView);
  }

  /** One membership of the organisation, or `null`: unknown, another organisation's, or not a UUID. */
  async find(id: string): Promise<MemberView | null> {
    if (!isUuid(id)) return null;
    const row = await this.tx.membership.findFirst({
      where: { id, organisationId: this.orgId },
      select,
    });
    return row ? toView(row) : null;
  }

  /** `find`, or `404 NOT_FOUND`. */
  async get(id: string): Promise<MemberView> {
    const member = await this.find(id);
    if (!member) throw new IdentityError('NOT_FOUND');
    return member;
  }
}
