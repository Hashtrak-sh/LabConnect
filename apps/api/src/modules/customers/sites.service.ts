import { Inject, Injectable } from '@nestjs/common';
import {
  AuditService,
  type Clock,
  createCustomerSite,
  type CurrentActor,
  type CustomerSiteChanges,
  type CustomerSiteInput,
  type CustomerSiteView,
  getCustomerSite,
  listCustomerSites,
  type RequestMeta,
  requireCustomerAdmin,
  requireCustomerOrganisation,
  TenantScope,
  updateCustomerSite,
} from '@labconnect/core';
import type { MdStatus } from '@labconnect/database';
import { DomainError } from '../../common/domain-error.js';
import { CLOCK } from '../platform/platform.providers.js';

/** `CustomerSite` of the contract. */
export interface CustomerSiteBody {
  id: string;
  name: string;
  address: CustomerSiteView['address'];
  location: CustomerSiteView['location'];
  gstin: string | null;
  contact: CustomerSiteView['contact'];
  isDefaultBilling: boolean;
  status: MdStatus;
  createdAt: string;
  lockVersion: number;
}

export function toCustomerSiteBody(site: CustomerSiteView): CustomerSiteBody {
  return {
    id: site.id,
    name: site.name,
    address: site.address,
    location: site.location,
    gstin: site.gstin,
    contact: site.contact,
    isDefaultBilling: site.isDefaultBilling,
    status: site.status,
    createdAt: site.createdAt.toISOString(),
    lockVersion: site.lockVersion,
  };
}

/**
 * Customer sites (FR-ONB-03). Every query runs as the actor's organisation (`TenantScope.run`),
 * and the organisation always comes from the active membership: a site of another organisation
 * is `404`, exactly like an unknown id.
 */
@Injectable()
export class CustomerSitesService {
  constructor(
    private readonly scope: TenantScope,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  list(
    actor: CurrentActor,
    query: { status?: MdStatus; cursor?: string; limit?: number },
  ): ReturnType<typeof listCustomerSites> {
    const organisationId = requireCustomerOrganisation(actor);
    return this.scope.run(actor, (tx) => listCustomerSites(tx, { organisationId, ...query }));
  }

  async get(actor: CurrentActor, siteId: string): Promise<CustomerSiteView> {
    const organisationId = requireCustomerOrganisation(actor);
    const site = await this.scope.run(actor, (tx) =>
      getCustomerSite(tx, { organisationId, siteId }),
    );
    if (site === null) throw new DomainError('NOT_FOUND');
    return site;
  }

  create(
    actor: CurrentActor,
    site: CustomerSiteInput,
    meta: RequestMeta,
  ): Promise<CustomerSiteView> {
    const organisationId = requireCustomerAdmin(actor);
    return this.scope.run(actor, (tx) =>
      createCustomerSite(
        tx,
        { clock: this.clock, audit: this.audit },
        { actor, organisationId, site, meta },
      ),
    );
  }

  async update(
    actor: CurrentActor,
    input: { siteId: string; ifMatch: number; changes: CustomerSiteChanges },
    meta: RequestMeta,
  ): Promise<CustomerSiteView> {
    const organisationId = requireCustomerAdmin(actor);
    const result = await this.scope.run(actor, (tx) =>
      updateCustomerSite(
        tx,
        { clock: this.clock, audit: this.audit },
        { actor, organisationId, ...input, meta },
      ),
    );
    if (result.ok) return result.site;
    if (result.reason === 'NOT_FOUND') throw new DomainError('NOT_FOUND');
    if (result.reason === 'CONCURRENT_MODIFICATION') {
      throw new DomainError('CONCURRENT_MODIFICATION');
    }
    throw new DomainError('VALIDATION_FAILED', {
      detail: 'An inactive site cannot be the default billing site.',
      errors: [
        {
          path: 'isDefaultBilling',
          code: 'INACTIVE_SITE',
          message: 'An inactive site cannot be the default billing site.',
        },
      ],
    });
  }
}
