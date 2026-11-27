import { type MdStatus, Prisma, uuidv7 } from '@labconnect/database';
import type { CurrentActor } from '../identity/actor.js';
import { auditMeta, type RequestMeta } from '../identity/errors.js';
import type { AuditService } from '../platform/audit.js';
import type { Clock } from '../platform/clock.js';
import { CoreError } from '../platform/errors.js';
import { addressFromStored, type PostalAddressInput } from './organisations.js';

/** A contact person at a site (`CustomerSiteContact`). */
export interface SiteContact {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface CustomerSiteInput {
  name: string;
  address: PostalAddressInput;
  gstin?: string;
  contact?: SiteContact;
  isDefaultBilling?: boolean;
}

/** `CustomerSiteUpdate`: only the listed fields change; `null` clears a nullable one. */
export interface CustomerSiteChanges {
  name?: string;
  address?: PostalAddressInput;
  gstin?: string | null;
  contact?: SiteContact | null;
  isDefaultBilling?: boolean;
  status?: MdStatus;
}

/** A customer site as the API returns it (`CustomerSite`). */
export interface CustomerSiteView {
  id: string;
  name: string;
  address: PostalAddressInput;
  location: { lat: number; lng: number } | null;
  gstin: string | null;
  contact: SiteContact | null;
  isDefaultBilling: boolean;
  status: MdStatus;
  createdAt: Date;
  lockVersion: number;
}

export interface CustomerSiteDeps {
  clock: Clock;
  audit: AuditService;
}

export const CUSTOMER_SITE_LIST_LIMITS = { default: 50, max: 100 } as const;

/** A request the contract refuses on a customer site route. */
export class CustomerSiteError extends CoreError {
  override name = 'CustomerSiteError';
}

/**
 * The organisation a customer route acts for: the active membership's, and only a customer one
 * (TENANT_ISOLATION §2: never an id from the request). A lab or platform membership is `403`:
 * `org_user.manage` is also held by `LAB_CHECKER` and platform staff, for their own users.
 */
export function requireCustomerOrganisation(actor: CurrentActor): string {
  if (actor.orgType !== 'CUSTOMER' || actor.orgId === null) {
    throw new CustomerSiteError('FORBIDDEN', {
      detail: 'Only a member of a customer organisation can use its sites.',
    });
  }
  return actor.orgId;
}

/** Writes need `CUSTOMER_ADMIN` of a customer organisation. */
export function requireCustomerAdmin(actor: CurrentActor): string {
  const organisationId = requireCustomerOrganisation(actor);
  if (!actor.roles.includes('CUSTOMER_ADMIN')) {
    throw new CustomerSiteError('FORBIDDEN', {
      detail: 'Only a customer administrator can change the sites.',
    });
  }
  return organisationId;
}

interface SiteRow {
  id: string;
  name: string;
  address: Prisma.JsonValue;
  lat: number | null;
  lng: number | null;
  gstin: string | null;
  contact: Prisma.JsonValue | null;
  is_default_billing: boolean;
  status: MdStatus;
  created_at: Date;
  lock_version: number;
}

const SITE_COLUMNS = Prisma.sql`
  id, name, address, ST_Y(geo_point::geometry) AS lat, ST_X(geo_point::geometry) AS lng, gstin,
  contact, is_default_billing, status, created_at, lock_version`;

function contactFromStored(value: Prisma.JsonValue | null): SiteContact | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const text = (key: string): string | null => {
    const field = value[key];
    return typeof field === 'string' ? field : null;
  };
  return { name: text('name'), email: text('email'), phone: text('phone') };
}

function toView(row: SiteRow): CustomerSiteView {
  const address = addressFromStored(row.address);
  return {
    id: row.id,
    name: row.name,
    // Every stored site has an address (the column is NOT NULL and written by this module).
    address: address ?? {
      line1: '',
      line2: null,
      city: '',
      district: null,
      stateCode: '',
      pincode: '',
    },
    location: row.lat === null || row.lng === null ? null : { lat: row.lat, lng: row.lng },
    gstin: row.gstin,
    contact: contactFromStored(row.contact),
    isDefaultBilling: row.is_default_billing,
    status: row.status,
    createdAt: row.created_at,
    lockVersion: row.lock_version,
  };
}

function storedAddress(address: PostalAddressInput): Prisma.InputJsonObject {
  return {
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    district: address.district,
    state_code: address.stateCode,
    pincode: address.pincode,
  };
}

function storedContact(contact: SiteContact): Prisma.InputJsonObject {
  return { name: contact.name ?? null, email: contact.email ?? null, phone: contact.phone ?? null };
}

async function readSite(
  tx: Prisma.TransactionClient,
  organisationId: string,
  siteId: string,
): Promise<CustomerSiteView | null> {
  const rows = await tx.$queryRaw<SiteRow[]>(Prisma.sql`
    SELECT ${SITE_COLUMNS} FROM customer_site
     WHERE id = ${siteId}::uuid AND organisation_id = ${organisationId}::uuid`);
  return rows[0] === undefined ? null : toView(rows[0]);
}

/**
 * Serialises the changes of one organisation's default billing site: the settings row exists
 * once per organisation, so holding it makes "clear the others, set this one" atomic.
 */
async function lockOrganisationSites(
  tx: Prisma.TransactionClient,
  organisationId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM customer_settings WHERE organisation_id = ${organisationId}::uuid FOR UPDATE`;
}

async function clearOtherDefaults(
  tx: Prisma.TransactionClient,
  organisationId: string,
  exceptSiteId: string,
): Promise<void> {
  await tx.customerSite.updateMany({
    where: { organisationId, isDefaultBilling: true, id: { not: exceptSiteId } },
    data: { isDefaultBilling: false, lockVersion: { increment: 1 } },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The cursor holds only the id of the last site of the page: the position (its name and id) is
 * looked up again, so no site name travels in a URL (CLAUDE.md §5: a site name can be personal).
 */
function encodeCursor(siteId: string): string {
  return Buffer.from(JSON.stringify({ i: siteId }), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    parsed = undefined;
  }
  const id =
    typeof parsed === 'object' && parsed !== null ? (parsed as { i?: unknown }).i : undefined;
  if (typeof id === 'string' && UUID.test(id)) return id.toLowerCase();
  throw new CustomerSiteError('VALIDATION_FAILED', { detail: 'The cursor cannot be read.' });
}

/** `listCustomerSites`: the organisation's sites by name, then id, a page at a time. */
export async function listCustomerSites(
  tx: Prisma.TransactionClient,
  input: {
    organisationId: string;
    status?: MdStatus | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  },
): Promise<{ data: CustomerSiteView[]; page: { nextCursor: string | null; limit: number } }> {
  const limit = input.limit ?? CUSTOMER_SITE_LIST_LIMITS.default;
  if (!Number.isInteger(limit) || limit < 1 || limit > CUSTOMER_SITE_LIST_LIMITS.max) {
    throw new CustomerSiteError('VALIDATION_FAILED', {
      detail: `limit must be a whole number from 1 to ${String(CUSTOMER_SITE_LIST_LIMITS.max)}.`,
    });
  }
  const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
  const statusFilter =
    input.status === undefined ? Prisma.empty : Prisma.sql`AND status = ${input.status}::md_status`;
  const cursorFilter =
    after === undefined
      ? Prisma.empty
      : // The cursor's site, looked up in this organisation only: another organisation's id
        // matches no row, the comparison is NULL and the page is empty.
        Prisma.sql`AND (name, id) > (SELECT c.name, c.id FROM customer_site c
                                         WHERE c.id = ${after}::uuid
                                           AND c.organisation_id = ${input.organisationId}::uuid)`;
  const rows = await tx.$queryRaw<SiteRow[]>(Prisma.sql`
    SELECT ${SITE_COLUMNS} FROM customer_site
     WHERE organisation_id = ${input.organisationId}::uuid ${statusFilter} ${cursorFilter}
     ORDER BY name, id
     LIMIT ${limit + 1}`);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    data: page.map(toView),
    page: {
      nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last.id) : null,
      limit,
    },
  };
}

/** `getCustomerSite`: one site of the organisation; another organisation's id is `null`. */
export function getCustomerSite(
  tx: Prisma.TransactionClient,
  input: { organisationId: string; siteId: string },
): Promise<CustomerSiteView | null> {
  return readSite(tx, input.organisationId, input.siteId);
}

/**
 * `createCustomerSite` (FR-ONB-03). The site is `ACTIVE`, with no location until its address is
 * geocoded (no geocoder runs yet, MAPS_AND_GEOCODING). `isDefaultBilling` clears the flag on the
 * organisation's other sites. Audited as `customer_site.create`.
 */
export async function createCustomerSite(
  tx: Prisma.TransactionClient,
  deps: CustomerSiteDeps,
  input: {
    actor: CurrentActor;
    organisationId: string;
    site: CustomerSiteInput;
    meta: RequestMeta;
  },
): Promise<CustomerSiteView> {
  const now = deps.clock.now();
  const id = uuidv7(now.getTime());
  const { site } = input;
  if (site.isDefaultBilling === true) {
    await lockOrganisationSites(tx, input.organisationId);
    await clearOtherDefaults(tx, input.organisationId, id);
  }
  await tx.customerSite.create({
    data: {
      id,
      organisationId: input.organisationId,
      name: site.name,
      address: storedAddress(site.address),
      pincode: site.address.pincode,
      stateCode: site.address.stateCode,
      gstin: site.gstin ?? null,
      ...(site.contact !== undefined && { contact: storedContact(site.contact) }),
      isDefaultBilling: site.isDefaultBilling === true,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      createdByUserId: input.actor.userId,
    },
  });
  const view = await readSite(tx, input.organisationId, id);
  if (view === null) throw new Error('The new customer site cannot be read back.');
  await deps.audit.record(tx, {
    actor: auditActor(input.actor, input.organisationId),
    action: 'customer_site.create',
    entityType: 'customer_site',
    entityId: id,
    after: { name: view.name, isDefaultBilling: view.isDefaultBilling },
    ...auditMeta(input.meta),
  });
  return view;
}

export type UpdateCustomerSiteResult =
  | { ok: true; site: CustomerSiteView }
  | { ok: false; reason: 'NOT_FOUND' | 'CONCURRENT_MODIFICATION' | 'INACTIVE_DEFAULT' };

/**
 * `updateCustomerSite`. Needs the current `lock_version` (`If-Match`). A changed address clears
 * the location (it is geocoded again). Retiring a site (`INACTIVE`) also takes away its default
 * billing flag, and the organisation's default search site when it was that one; an inactive site
 * cannot be made the default (`INACTIVE_DEFAULT`). Audited as `customer_site.update`.
 */
export async function updateCustomerSite(
  tx: Prisma.TransactionClient,
  deps: CustomerSiteDeps,
  input: {
    actor: CurrentActor;
    organisationId: string;
    siteId: string;
    ifMatch: number;
    changes: CustomerSiteChanges;
    meta: RequestMeta;
  },
): Promise<UpdateCustomerSiteResult> {
  const { changes, organisationId, siteId } = input;
  // Every update takes the organisation's settings-row lock first, before any site row: the same
  // order as create, so a retire racing a new default cannot deadlock.
  await lockOrganisationSites(tx, organisationId);
  const before = await readSite(tx, organisationId, siteId);
  if (before === null) return { ok: false, reason: 'NOT_FOUND' };
  if (before.lockVersion !== input.ifMatch) return { ok: false, reason: 'CONCURRENT_MODIFICATION' };

  const status = changes.status ?? before.status;
  if (changes.isDefaultBilling === true && status !== 'ACTIVE') {
    return { ok: false, reason: 'INACTIVE_DEFAULT' };
  }
  const isDefaultBilling =
    status === 'ACTIVE' ? (changes.isDefaultBilling ?? before.isDefaultBilling) : false;

  // The guarded update comes first, and nothing else is written before it succeeds: a refused
  // update is returned (not thrown), so the transaction commits whatever ran before it.
  const updated = await tx.customerSite.updateMany({
    where: { id: siteId, organisationId, lockVersion: input.ifMatch },
    data: {
      ...(changes.name !== undefined && { name: changes.name }),
      ...(changes.address !== undefined && {
        address: storedAddress(changes.address),
        pincode: changes.address.pincode,
        stateCode: changes.address.stateCode,
      }),
      ...(changes.gstin !== undefined && { gstin: changes.gstin }),
      ...(changes.contact !== undefined && {
        contact: changes.contact === null ? Prisma.DbNull : storedContact(changes.contact),
      }),
      isDefaultBilling,
      status,
      lockVersion: { increment: 1 },
    },
  });
  if (updated.count === 0) return { ok: false, reason: 'CONCURRENT_MODIFICATION' };
  if (isDefaultBilling && !before.isDefaultBilling) {
    await clearOtherDefaults(tx, organisationId, siteId);
  }
  if (changes.address !== undefined) {
    await tx.$executeRaw`UPDATE customer_site SET geo_point = NULL WHERE id = ${siteId}::uuid AND organisation_id = ${organisationId}::uuid`;
  }
  if (status !== 'ACTIVE') {
    await tx.customerSettings.updateMany({
      where: { organisationId, defaultCustomerSiteId: siteId },
      data: { defaultCustomerSiteId: null, lockVersion: { increment: 1 } },
    });
  }

  const site = await readSite(tx, organisationId, siteId);
  if (site === null) return { ok: false, reason: 'NOT_FOUND' };
  await deps.audit.record(tx, {
    actor: auditActor(input.actor, organisationId),
    action: 'customer_site.update',
    entityType: 'customer_site',
    entityId: siteId,
    before: { name: before.name, isDefaultBilling: before.isDefaultBilling, status: before.status },
    after: { name: site.name, isDefaultBilling: site.isDefaultBilling, status: site.status },
    ...auditMeta(input.meta),
  });
  return { ok: true, site };
}

function auditActor(actor: CurrentActor, organisationId: string) {
  return {
    userId: actor.userId,
    ...(actor.membershipId !== null && { membershipId: actor.membershipId }),
    ...(actor.roles.includes('CUSTOMER_ADMIN') && { role: 'CUSTOMER_ADMIN' as const }),
    orgId: organisationId,
  };
}
