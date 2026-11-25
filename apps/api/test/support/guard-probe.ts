import 'reflect-metadata';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Headers,
  Module,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  assertNotSameUser,
  assertSiteInScope,
  MembershipRepository,
  TenantScope,
} from '@labconnect/core';
import { AuthGuard } from '../../src/modules/identity/auth.guard.js';
import { Authorised } from '../../src/modules/identity/authorised.decorator.js';
import { CurrentActor } from '../../src/modules/identity/current-actor.js';
import { IdentityModule } from '../../src/modules/identity/identity.module.js';
import { MembershipGuard } from '../../src/modules/identity/membership.guard.js';
import { MfaGuard } from '../../src/modules/identity/mfa.guard.js';
import { PermissionGuard } from '../../src/modules/identity/permission.guard.js';
import { PlatformModule } from '../../src/modules/platform/platform.module.js';

// Test-only controllers for the guards (P3-04). They are never part of the real app: a testing
// module adds them, and the real app's routes stay exactly those of the contract.

export interface ActorSummary {
  userId: string;
  membershipId: string | null;
  orgId: string | null;
  orgType: string | null;
  roles: readonly string[];
  siteIds: readonly string[];
  isPlatform: boolean;
  permissionCount: number;
}

const summary = (actor: CurrentActor): ActorSummary => ({
  userId: actor.userId,
  membershipId: actor.membershipId,
  orgId: actor.orgId,
  orgType: actor.orgType,
  roles: actor.roles,
  siteIds: actor.siteIds,
  isPlatform: actor.isPlatform,
  permissionCount: actor.permissions.size,
});

@Controller('guard-probe')
export class GuardProbeController {
  @Get('decide')
  @Authorised({ permission: 'booking.decide' })
  decide(@CurrentActor() actor: CurrentActor): ActorSummary {
    return summary(actor);
  }

  @Post('publish')
  @HttpCode(200)
  @Authorised({ permission: 'report.publish', stepUp: true })
  publish(@CurrentActor() actor: CurrentActor): ActorSummary {
    return summary(actor);
  }

  @Post('refund')
  @HttpCode(200)
  @Authorised({ permission: 'refund.approve', stepUp: true })
  refund(@CurrentActor() actor: CurrentActor): ActorSummary {
    return summary(actor);
  }

  @Post('publish-fresh')
  @HttpCode(200)
  @Authorised({ permission: 'report.publish', stepUp: 30 })
  publishFresh(@CurrentActor() actor: CurrentActor): ActorSummary {
    return summary(actor);
  }

  /** The guards without a permission declaration: the route a developer forgot to protect. */
  @Get('forgotten')
  @UseGuards(AuthGuard, MembershipGuard, PermissionGuard, MfaGuard)
  forgotten(@CurrentActor() actor: CurrentActor): ActorSummary {
    return summary(actor);
  }

  @Get('open')
  @Authorised({ noPermissionRequired: true })
  open(@CurrentActor() actor: CurrentActor): ActorSummary {
    return summary(actor);
  }

  /** Any member: `lab.search` is held by every role. Echoes what the client sent, to show it is ignored. */
  @Post('whoami')
  @HttpCode(200)
  @Authorised({ permission: 'lab.search' })
  whoami(
    @CurrentActor() actor: CurrentActor,
    @Body() body: { orgId?: string; organisationId?: string } | undefined,
    @Query('orgId') queryOrg: string | undefined,
    @Headers('x-org-id') headerOrg: string | undefined,
  ): { actor: ActorSummary; clientSent: Record<string, string | undefined> } {
    return {
      actor: summary(actor),
      clientSent: {
        bodyOrgId: body?.orgId,
        bodyOrganisationId: body?.organisationId,
        queryOrgId: queryOrg,
        headerOrgId: headerOrg,
      },
    };
  }

  @Get('sites/:siteId')
  @Authorised({ permission: 'lab_inbox.view' })
  site(@CurrentActor() actor: CurrentActor, @Param('siteId') siteId: string): { siteId: string } {
    assertSiteInScope(actor, siteId);
    return { siteId };
  }

  @Post('approve')
  @HttpCode(200)
  @Authorised({ permission: 'receipt.approve' })
  approve(
    @CurrentActor() actor: CurrentActor,
    @Body() body: { makerUserId: string },
  ): { approvedBy: string } {
    assertNotSameUser(actor, body.makerUserId);
    return { approvedBy: actor.userId };
  }

  @Authorised({ permission: 'lab.search' })
  @Get('class-level')
  classLevel(@CurrentActor() actor: CurrentActor): ActorSummary {
    return summary(actor);
  }
}

/** Needs the database: reads tenant rows through `TenantScope`, with whatever the client sends beside it. */
@Controller('scope-probe')
export class ScopeProbeController {
  constructor(private readonly scope: TenantScope) {}

  /** The customer sites the actor can see, and the organisation id the client asked for (ignored). */
  @Post('customer-sites')
  @HttpCode(200)
  @Authorised({ permission: 'lab.search' })
  async customerSites(
    @CurrentActor() actor: CurrentActor,
    @Body() body: { orgId?: string } | undefined,
    @Query('orgId') queryOrg: string | undefined,
    @Headers('x-org-id') headerOrg: string | undefined,
  ): Promise<{ visibleOrgIds: string[]; asked: (string | undefined)[] }> {
    const asked = [body?.orgId, queryOrg, headerOrg];
    // Even a handler that *tries* to use the client's id gets nothing from another tenant.
    const wanted = asked.find((id): id is string => id !== undefined);
    const visible = await this.scope.run(actor, async (tx) =>
      (
        await tx.customerSite.findMany({
          ...(wanted !== undefined && { where: { organisationId: wanted } }),
          select: { organisationId: true },
        })
      ).map((row) => row.organisationId),
    );
    return { visibleOrgIds: [...new Set(visible)], asked };
  }

  @Get('members')
  @Authorised({ permission: 'org_user.manage' })
  members(@CurrentActor() actor: CurrentActor): Promise<{ userIds: string[] }> {
    return this.scope.run(actor, async (tx) => ({
      userIds: (await new MembershipRepository(tx, actor).list()).map((member) => member.userId),
    }));
  }

  @Get('members/:id')
  @Authorised({ permission: 'org_user.manage' })
  member(
    @CurrentActor() actor: CurrentActor,
    @Param('id') id: string,
  ): Promise<{ userId: string }> {
    return this.scope.run(actor, async (tx) => {
      const member = await new MembershipRepository(tx, actor).get(id);
      return { userId: member.userId };
    });
  }
}

/** The probes on top of the real identity module, for the database-backed tests. */
@Module({
  imports: [IdentityModule, PlatformModule],
  controllers: [GuardProbeController, ScopeProbeController],
})
export class GuardProbeModule {}
