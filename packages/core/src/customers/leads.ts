import { Prisma, type PrismaClient, uuidv7 } from '@labconnect/database';
import type { LabDirectoryService } from '../labs/public-directory.js';
import { CoreError } from '../platform/errors.js';
import { withPublicWriteContext } from '../platform/public-context.js';

/**
 * The search that led to a lead (`LeadSearchCriteria`). Never a latitude or longitude: the
 * device location is not stored (MAPS_AND_GEOCODING section 3).
 */
export interface LeadSearchCriteria {
  q?: string;
  pincode?: string;
  radiusKm?: number;
  discipline?: string;
  parameter?: string;
  method?: string;
  tatMax?: number;
  priceMax?: number;
  category?: string;
}

/**
 * A "Request this lab" lead on a listed site (`REQUEST_LAB`, AC-DIS-04) or a "Request a lab"
 * lead after a search with no result (`NO_RESULT`, FR-DIS-07, EC-05). The caller has checked the
 * shape against the contract (`LeadCreate`).
 */
export type LeadInput =
  | {
      kind: 'REQUEST_LAB';
      labSiteId: string;
      query: LeadSearchCriteria | null;
      contactEmail: string | null;
    }
  | { kind: 'NO_RESULT'; query: LeadSearchCriteria; contactEmail: string | null };

export interface LeadServiceDeps {
  prisma: Pick<PrismaClient, '$transaction'>;
  labs: Pick<LabDirectoryService, 'getPublicSite'>;
}

/**
 * Leads for Ops (`lead_request`, owned by the customers module). Anyone may create one; nobody
 * outside the platform team can read them back (`lead_read`), so nothing about the lead is
 * returned. A duplicate lead is harmless: Ops works through them (FR-ADM-06).
 */
export class LeadService {
  constructor(private readonly deps: LeadServiceDeps) {}

  async createLead(input: LeadInput): Promise<void> {
    if (
      input.kind === 'REQUEST_LAB' &&
      (await this.deps.labs.getPublicSite(input.labSiteId)) === null
    ) {
      throw new CoreError('VALIDATION_FAILED', { detail: 'labSiteId is not a listed lab site.' });
    }
    const labSiteId = input.kind === 'REQUEST_LAB' ? input.labSiteId : null;
    const query = input.query === null ? null : JSON.stringify(input.query);
    await withPublicWriteContext(this.deps.prisma, async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO lead_request (id, kind, lab_site_id, query, contact_email)
        VALUES (${uuidv7()}::uuid, ${input.kind}::lead_kind, ${labSiteId}::uuid,
                ${query}::jsonb, ${input.contactEmail}::citext)`);
    });
  }
}
