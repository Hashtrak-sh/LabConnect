// Test-only controllers for the isolation harness (P3-05), backed by real tenant tables through
// `TenantScope` and the repository base, exactly how a real endpoint is built:
//
//   members          memberships of the actor's organisation (MembershipRepository, the worked example)
//   customer-sites   a customer-owned table, with an organisation predicate in the repository
//   lab-sites        lab sites, which RLS shows to everyone: only the repository keeps a lab to its
//                    own sites, and `labSiteScope()` narrows a lab user to the sites assigned to them
//   platform-wide    a deliberate raw read through RLS, to show what the platform context sees
//
// `FixtureLeakyController` is the negative control: the same endpoints with the organisation
// predicate dropped, run under the system context. The isolation kit must reject it.
import { Controller, Get, Headers, Module, Param, Query } from '@nestjs/common';
import {
  type CurrentActor as Actor,
  isUuid,
  TenantRepository,
  TenantScope,
} from '@labconnect/core';
import { MembershipRepository } from '@labconnect/core';
import { DomainError } from '../../../src/common/domain-error.js';
import { Authorised } from '../../../src/modules/identity/authorised.decorator.js';
import { CurrentActor } from '../../../src/modules/identity/current-actor.js';
import { IdentityModule } from '../../../src/modules/identity/identity.module.js';
import { PlatformModule } from '../../../src/modules/platform/platform.module.js';

interface SiteView {
  id: string;
  name: string;
}

class CustomerSiteRepository extends TenantRepository {
  async list(): Promise<SiteView[]> {
    return this.tx.customerSite.findMany({
      where: { organisationId: this.orgId },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
  }

  async find(id: string): Promise<SiteView | null> {
    if (!isUuid(id)) return null;
    return this.tx.customerSite.findFirst({
      where: { id, organisationId: this.orgId },
      select: { id: true, name: true },
    });
  }
}

class LabSiteRepository extends TenantRepository {
  private where(): object {
    const scope = this.labSiteScope();
    return scope === 'ALL'
      ? { organisationId: this.orgId }
      : { organisationId: this.orgId, id: { in: [...scope] } };
  }

  async list(): Promise<SiteView[]> {
    return this.tx.labSite.findMany({
      where: this.where(),
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
  }

  async find(id: string): Promise<SiteView | null> {
    if (!isUuid(id)) return null;
    return this.tx.labSite.findFirst({
      where: { AND: [this.where(), { id }] },
      select: { id: true, name: true },
    });
  }
}

const found = <T>(row: T | null): T => {
  if (row === null) throw new DomainError('NOT_FOUND');
  return row;
};

@Controller('fx-iso')
export class FixtureIsolationController {
  constructor(private readonly scope: TenantScope) {}

  /**
   * Echoes what the client sent beside the request, to show it changes nothing: the handler
   * hands the value to nothing, because the repository takes its organisation from the actor.
   */
  @Get('members')
  @Authorised({ permission: 'org_user.manage' })
  members(
    @CurrentActor() actor: Actor,
    @Query('orgId') queryOrg: string | undefined,
    @Headers('x-org-id') headerOrg: string | undefined,
  ): Promise<{ ids: string[]; asked: (string | undefined)[] }> {
    return this.scope.run(actor, async (tx) => ({
      ids: (await new MembershipRepository(tx, actor).list()).map((member) => member.id),
      asked: [queryOrg, headerOrg],
    }));
  }

  @Get('members/:id')
  @Authorised({ permission: 'org_user.manage' })
  member(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
  ): Promise<{ id: string; userId: string }> {
    return this.scope.run(actor, async (tx) => {
      const member = await new MembershipRepository(tx, actor).get(id);
      return { id: member.id, userId: member.userId };
    });
  }

  @Get('customer-sites')
  @Authorised({ permission: 'lab.search' })
  customerSites(@CurrentActor() actor: Actor): Promise<{ ids: string[] }> {
    return this.scope.run(actor, async (tx) => ({
      ids: (await new CustomerSiteRepository(tx, actor).list()).map((site) => site.id),
    }));
  }

  @Get('customer-sites/:id')
  @Authorised({ permission: 'lab.search' })
  customerSite(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<SiteView> {
    return this.scope.run(actor, async (tx) =>
      found(await new CustomerSiteRepository(tx, actor).find(id)),
    );
  }

  @Get('lab-sites')
  @Authorised({ permission: 'lab_inbox.view' })
  labSites(@CurrentActor() actor: Actor): Promise<{ ids: string[] }> {
    return this.scope.run(actor, async (tx) => ({
      ids: (await new LabSiteRepository(tx, actor).list()).map((site) => site.id),
    }));
  }

  @Get('lab-sites/:id')
  @Authorised({ permission: 'lab_inbox.view' })
  labSite(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<SiteView> {
    return this.scope.run(actor, async (tx) =>
      found(await new LabSiteRepository(tx, actor).find(id)),
    );
  }

  /**
   * No repository: a raw read of every customer site through the actor's database context. A
   * tenant sees its own rows (RLS); the platform context sees all of them (OQ-111).
   */
  @Get('platform-wide/customer-sites')
  @Authorised({ permission: 'lab.search' })
  platformWide(@CurrentActor() actor: Actor): Promise<{ organisationIds: string[] }> {
    return this.scope.run(actor, async (tx) => ({
      organisationIds: [
        ...new Set(
          (await tx.customerSite.findMany({ select: { organisationId: true } })).map(
            (site) => site.organisationId,
          ),
        ),
      ],
    }));
  }
}

/** The negative control: no organisation predicate, system context. */
@Controller('fx-iso-leaky')
export class FixtureLeakyController {
  constructor(private readonly scope: TenantScope) {}

  @Get('members')
  @Authorised({ permission: 'org_user.manage' })
  members(): Promise<{ ids: string[] }> {
    return this.scope.runAsSystem('fixture: leaky negative control', async (tx) => ({
      ids: (await tx.membership.findMany({ select: { id: true } })).map((row) => row.id),
    }));
  }

  @Get('members/:id')
  @Authorised({ permission: 'org_user.manage' })
  member(
    @CurrentActor() _actor: Actor,
    @Param('id') id: string,
  ): Promise<{ id: string; userId: string }> {
    return this.scope.runAsSystem('fixture: leaky negative control', async (tx) => {
      const row = found(
        isUuid(id)
          ? await tx.membership.findFirst({ where: { id }, select: { id: true, userId: true } })
          : null,
      );
      return row;
    });
  }
}

@Module({
  imports: [IdentityModule, PlatformModule],
  controllers: [FixtureIsolationController, FixtureLeakyController],
})
export class IsolationFixtureModule {}
