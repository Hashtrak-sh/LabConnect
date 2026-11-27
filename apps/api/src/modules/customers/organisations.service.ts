import { Inject, Injectable } from '@nestjs/common';
import {
  AuditService,
  type Clock,
  createCustomerOrganisation,
  type CurrentActor,
  type CustomerOrganisationInput,
  type CustomerOrganisationView,
  type RequestMeta,
  TenantScope,
} from '@labconnect/core';
import { Prisma } from '@labconnect/database';
import { DomainError } from '../../common/domain-error.js';
import { CLOCK } from '../platform/platform.providers.js';

/** `CustomerOrganisation` of the contract (`components/schemas/customer.yaml`). */
export interface CustomerOrganisationBody {
  id: string;
  customerSegment: CustomerOrganisationView['customerSegment'];
  legalName: string;
  displayName: string;
  gstin: string | null;
  registeredAddress: CustomerOrganisationView['registeredAddress'];
  status: CustomerOrganisationView['status'];
  createdAt: string;
  lockVersion: number;
}

export function toCustomerOrganisationBody(
  organisation: CustomerOrganisationView,
): CustomerOrganisationBody {
  return {
    id: organisation.id,
    customerSegment: organisation.customerSegment,
    legalName: organisation.legalName,
    displayName: organisation.displayName,
    gstin: organisation.gstin,
    registeredAddress: organisation.registeredAddress,
    status: organisation.status,
    createdAt: organisation.createdAt.toISOString(),
    lockVersion: organisation.lockVersion,
  };
}

const GSTIN_TAKEN = new DomainError('VALIDATION_FAILED', {
  detail: 'Another customer organisation already uses this GSTIN.',
  errors: [
    {
      path: 'gstin',
      code: 'GSTIN_TAKEN',
      message: 'Another customer organisation already uses this GSTIN.',
    },
  ],
});

/**
 * Customer organisations (FR-ONB-01). The sign-up runs in the tenant context of the organisation
 * it creates, whose id is generated here: the caller has no membership yet, and `system` would
 * be far wider than needed (TenantScope.runForNewOrganisation).
 */
@Injectable()
export class CustomerOrganisationsService {
  constructor(
    private readonly scope: TenantScope,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** `createCustomerOrganisation`. */
  async create(
    actor: CurrentActor,
    input: CustomerOrganisationInput,
    meta: RequestMeta,
  ): Promise<CustomerOrganisationView> {
    // RR-5, before anything is written: platform staff cannot join a customer organisation.
    if (actor.isPlatform) {
      throw new DomainError('FORBIDDEN', {
        detail: 'Platform staff cannot join a customer organisation.',
      });
    }
    let result: Awaited<ReturnType<typeof createCustomerOrganisation>>;
    try {
      // The scope makes the new organisation's id; this code never chooses one.
      result = await this.scope.runForNewOrganisation(
        actor.userId,
        this.clock.now(),
        (tx, organisationId) =>
          createCustomerOrganisation(
            tx,
            { clock: this.clock, audit: this.audit },
            { userId: actor.userId, organisationId, organisation: input, meta },
          ),
      );
    } catch (error) {
      // Two sign-ups with one GSTIN at the same moment: the unique index decides.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw GSTIN_TAKEN;
      }
      throw error;
    }
    if (result.ok) return result.organisation;
    if (result.reason === 'GSTIN_TAKEN') throw GSTIN_TAKEN;
    if (result.reason === 'USER_IS_PLATFORM_STAFF') {
      throw new DomainError('FORBIDDEN', {
        detail: 'Platform staff cannot join a customer organisation.',
      });
    }
    // A disabled user has no session; anything else not active is refused the same way.
    throw new DomainError('FORBIDDEN', { detail: 'This account cannot create an organisation.' });
  }
}
