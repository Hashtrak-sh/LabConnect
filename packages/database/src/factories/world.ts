import { createHash } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
import { uuidv7 } from '../ids.js';
import { ensurePlatformOrganisation } from '../seed/platform-admin.js';

// Builders for organisations, users, master data and labs. Used by the test suites and
// by `seed:demo`. They write rows the way the application will, but without the
// application: no audit log, no outbox events, no notifications.
//
// Every builder takes a transaction client and expects `seed:reference` to have run.
// Everything they create is fictitious and says so ("DEMO" in names).

export type Tx = Prisma.TransactionClient;
type CustomerSegment = 'INDIVIDUAL' | 'BUSINESS' | 'INDUSTRY' | 'GOVERNMENT';
type RoleCode = Prisma.MembershipRoleUncheckedCreateInput['role'];

const DEFAULT_EMAIL_DOMAIN = 'demo.labconnect.test';
const timeOfDay = (hhmm: string): Date => new Date(`1970-01-01T${hhmm}:00.000Z`);

// ---------------------------------------------------------------- reference lookups

export interface Reference {
  /** Id of a value in a flat taxonomy, for example `node('REJECTION_REASON', 'NO_CAPACITY')`. */
  node(taxonomy: string, code: string): string;
  scope: {
    taxonomyId: string;
    types: Record<'DISCIPLINE' | 'GROUP' | 'PRODUCT' | 'PARAMETER', string>;
  };
  /** Id of the single VALUE node type of a flat taxonomy, for example `valueType('METHOD')`. */
  valueType(taxonomy: string): string;
  taxonomyId(taxonomy: string): string;
  nablBodyId: string;
  testingStandardId: string;
  /** `key_id` of the active signing key per purpose. */
  keys: Record<'BOOKING' | 'PACKAGE' | 'REPORT', string>;
}

/** Reads what `seed:reference` created. Fails with a clear message if it has not run. */
export async function loadReference(tx: Tx): Promise<Reference> {
  const missing = (what: string): never => {
    throw new Error(`${what} is missing. Run seed:reference (seedReference) first.`);
  };
  const taxonomies = await tx.mdTaxonomy.findMany({ select: { id: true, code: true } });
  const taxonomyCode = new Map(taxonomies.map((row) => [row.id, row.code]));
  const scope = taxonomies.find((row) => row.code === 'SCOPE') ?? missing('The SCOPE taxonomy');

  const allTypes = await tx.mdNodeType.findMany();
  const types = allTypes.filter((type) => type.taxonomyId === scope.id);
  const valueTypes = new Map(
    allTypes
      .filter((type) => type.code === 'VALUE')
      .map((type) => [taxonomyCode.get(type.taxonomyId) ?? '', type.id]),
  );
  const typeId = (code: string): string =>
    types.find((type) => type.code === code)?.id ?? missing(`The SCOPE level ${code}`);

  const flatNodes = await tx.mdNode.findMany({
    where: { taxonomyId: { not: scope.id } },
    select: { id: true, code: true, taxonomyId: true },
  });
  const nodes = new Map(
    flatNodes.map((node) => [`${taxonomyCode.get(node.taxonomyId) ?? ''}/${node.code}`, node.id]),
  );

  const body = await tx.accreditationBody.findFirst({ where: { code: 'NABL' } });
  const standard = await tx.accreditationStandard.findFirst({
    where: { code: 'ISO_IEC_17025_TESTING' },
  });
  const keys = await tx.qrSigningKey.findMany({ where: { status: 'ACTIVE' } });
  const keyId = (purpose: string): string =>
    keys.find((key) => key.purpose === purpose)?.keyId ?? missing(`The ${purpose} signing key`);

  return {
    node: (taxonomy, code) =>
      nodes.get(`${taxonomy}/${code}`) ?? missing(`The value ${taxonomy}/${code}`),
    scope: {
      taxonomyId: scope.id,
      types: {
        DISCIPLINE: typeId('DISCIPLINE'),
        GROUP: typeId('GROUP'),
        PRODUCT: typeId('PRODUCT'),
        PARAMETER: typeId('PARAMETER'),
      },
    },
    valueType: (taxonomy) => valueTypes.get(taxonomy) ?? missing(`The value type of ${taxonomy}`),
    taxonomyId: (taxonomy) =>
      taxonomies.find((row) => row.code === taxonomy)?.id ?? missing(`The taxonomy ${taxonomy}`),
    nablBodyId: body?.id ?? missing('The accreditation body NABL'),
    testingStandardId: standard?.id ?? missing('The standard ISO_IEC_17025_TESTING'),
    keys: { BOOKING: keyId('BOOKING'), PACKAGE: keyId('PACKAGE'), REPORT: keyId('REPORT') },
  };
}

// ---------------------------------------------------------------- users and memberships

export interface UserInput {
  email: string;
  fullName: string;
  designation?: string;
  platformStaff?: boolean;
}

export async function createUser(tx: Tx, input: UserInput): Promise<string> {
  const id = uuidv7();
  await tx.appUser.create({
    data: {
      id,
      email: input.email,
      fullName: input.fullName,
      designation: input.designation ?? null,
      status: 'ACTIVE',
      isPlatformStaff: input.platformStaff ?? false,
      emailVerifiedAt: new Date(),
    },
  });
  return id;
}

/** An active membership with one role. Returns the membership id. */
export async function addMember(
  tx: Tx,
  userId: string,
  organisationId: string,
  role: RoleCode,
  siteIds: string[] = [],
): Promise<string> {
  const id = uuidv7();
  await tx.membership.create({
    data: { id, userId, organisationId, status: 'ACTIVE', activatedAt: new Date() },
  });
  await tx.membershipRole.create({ data: { id: uuidv7(), membershipId: id, role } });
  if (siteIds.length > 0) {
    await tx.membershipSite.createMany({
      data: siteIds.map((labSiteId) => ({ id: uuidv7(), membershipId: id, labSiteId })),
    });
  }
  return id;
}

// ---------------------------------------------------------------- platform

export interface PlatformTeam {
  organisationId: string;
  ops: string;
  steward: string;
  finance: string;
  admin: string;
}

/** One user per platform role, in the platform organisation. `tag` keeps emails unique. */
export async function createPlatformTeam(
  tx: Tx,
  options: { tag?: string; emailDomain?: string } = {},
): Promise<PlatformTeam> {
  const tag = options.tag ?? uuidv7().slice(-8);
  const domain = options.emailDomain ?? DEFAULT_EMAIL_DOMAIN;
  const organisationId = await ensurePlatformOrganisation(tx);
  const member = async (name: string, label: string, role: RoleCode): Promise<string> => {
    const userId = await createUser(tx, {
      email: `${name}.${tag}@${domain}`,
      fullName: `DEMO ${label}`,
      platformStaff: true,
    });
    await addMember(tx, userId, organisationId, role);
    return userId;
  };
  return {
    organisationId,
    ops: await member('ops', 'Platform Ops', 'PLATFORM_OPS'),
    steward: await member('steward', 'Data Steward', 'PLATFORM_DATA_STEWARD'),
    finance: await member('finance', 'Platform Finance', 'PLATFORM_FINANCE'),
    admin: await member('admin', 'Platform Admin', 'PLATFORM_ADMIN'),
  };
}

/** A published change set, prepared by the steward and approved by the admin. */
export async function createPublishedChangeSet(
  tx: Tx,
  team: PlatformTeam,
  title: string,
): Promise<string> {
  const id = uuidv7();
  const now = new Date();
  await tx.mdChangeSet.create({
    data: {
      id,
      title,
      source: 'MANUAL',
      status: 'PUBLISHED',
      preparedByUserId: team.steward,
      submittedAt: now,
      approvedByUserId: team.admin,
      approvedAt: now,
      publishedAt: now,
    },
  });
  return id;
}

// ---------------------------------------------------------------- scope catalogue

export interface ParameterSpec {
  code: string;
  name: string;
  /** What people type for this test: abbreviations and other names. */
  aliases?: string[];
  /** Code of a unit in `FlatSpec.units`. */
  unitCode?: string;
  /** Code of a method in `FlatSpec.methods`. */
  methodCode?: string;
  /** Range a lab can report, shown as the scope line's range text. */
  range?: { min: number; max: number };
  /** A default price list line: price in paise and turnaround in days. */
  pricePaise?: bigint;
  tatDays?: number;
}

export interface ProductSpec {
  code: string;
  name: string;
  aliases?: string[];
  /** Sample a customer hands over for one test of this product (price item). */
  sample?: { qty: number; unitCode: string; packaging: string };
  parameters: ParameterSpec[];
}

export interface CatalogueSpec {
  code: string;
  name: string;
  groups: { code: string; name: string; products: ProductSpec[] }[];
}

/**
 * Values of the flat METHOD and UNIT taxonomies that a catalogue refers to. A unit with
 * `reuse` is one that `seed:reference` already has (looked up by that code, not created).
 */
export interface FlatSpec {
  methods: { code: string; name: string; standardCode?: string }[];
  units: { code: string; name: string; reuse?: string }[];
}

export interface ParameterRef {
  disciplineId: string;
  groupId: string;
  productId: string;
  parameterId: string;
  /** Names, for snapshots. */
  discipline: string;
  product: string;
  parameter: string;
  /** Codes. */
  productCode: string;
  parameterCode: string;
  /** Present when the catalogue spec gives them. */
  unit?: string;
  unitNodeId?: string;
  methodNodeId?: string;
  /** The method as published: its standard code if it has one, else its name. */
  methodText?: string;
  rangeText?: string;
  rangeMin?: number;
  rangeMax?: number;
  pricePaise?: bigint;
  tatDays?: number;
  sample?: { qty: number; unitNodeId: string; packaging: string };
}

export interface Catalogue {
  parameters: ParameterRef[];
  disciplineIds: string[];
}

/** A small tree that is enough for most tests: one discipline, six parameters. */
export const SMALL_CATALOGUE: CatalogueSpec[] = [
  {
    code: 'DEMO_CHEMICAL',
    name: 'DEMO Chemical',
    groups: [
      {
        code: 'DEMO_BUILDING_MATERIALS',
        name: 'DEMO Building materials',
        products: [
          {
            code: 'DEMO_CEMENT',
            name: 'DEMO Cement',
            parameters: [
              { code: 'DEMO_CEMENT_CHLORIDE', name: 'Chloride content' },
              { code: 'DEMO_CEMENT_SULPHATE', name: 'Sulphate content' },
              { code: 'DEMO_CEMENT_LOSS_ON_IGNITION', name: 'Loss on ignition' },
            ],
          },
          {
            code: 'DEMO_STEEL',
            name: 'DEMO Steel',
            parameters: [
              { code: 'DEMO_STEEL_CARBON', name: 'Carbon content' },
              { code: 'DEMO_STEEL_MANGANESE', name: 'Manganese content' },
              { code: 'DEMO_STEEL_SULPHUR', name: 'Sulphur content' },
            ],
          },
        ],
      },
    ],
  },
];

/** `1 to 14 pH units`, as a lab publishes a range. */
function rangeTextOf(range: { min: number; max: number } | undefined, unit: string): string {
  if (!range) return unit === 'Pass/Fail' ? 'Pass or fail' : `Reported in ${unit}`;
  return `${String(range.min)} to ${String(range.max)} ${unit}`;
}

/**
 * Creates SCOPE nodes (discipline → group → product → parameter), and the METHOD and UNIT
 * values that `flat` lists. Codes must not exist yet. Version rows point at the change set,
 * as publication would. Everything created carries the attribute `demo: true`.
 */
export async function createCatalogue(
  tx: Tx,
  reference: Reference,
  changeSetId: string,
  spec: CatalogueSpec[] = SMALL_CATALOGUE,
  flat: FlatSpec = { methods: [], units: [] },
): Promise<Catalogue> {
  const { taxonomyId, types } = reference.scope;
  const versions: Prisma.MdNodeVersionCreateManyInput[] = [];
  const now = new Date();
  const node = async (
    taxonomy: string | null,
    nodeTypeId: string,
    code: string,
    name: string,
    parentId: string | null,
    extra: { aliases?: string[]; attributes?: Record<string, string> } = {},
  ): Promise<string> => {
    const id = uuidv7();
    // One at a time: the path trigger reads the parent row.
    await tx.mdNode.create({
      data: {
        id,
        taxonomyId: taxonomy === null ? taxonomyId : reference.taxonomyId(taxonomy),
        nodeTypeId,
        parentId,
        code,
        name,
        aliases: extra.aliases ?? [],
        attributes: { demo: true, ...extra.attributes },
      },
    });
    versions.push({
      id: uuidv7(),
      nodeId: id,
      versionNo: 1,
      snapshot: { code, name, parentId },
      changeSetId,
      publishedAt: now,
    });
    return id;
  };

  const methods = new Map<string, { id: string; text: string }>();
  for (const method of flat.methods) {
    const id = await node('METHOD', reference.valueType('METHOD'), method.code, method.name, null, {
      attributes: method.standardCode ? { standard_code: method.standardCode } : {},
    });
    methods.set(method.code, { id, text: method.standardCode ?? method.name });
  }
  const units = new Map<string, { id: string; name: string }>();
  for (const unit of flat.units) {
    const id = unit.reuse
      ? reference.node('UNIT', unit.reuse)
      : await node('UNIT', reference.valueType('UNIT'), unit.code, unit.name, null);
    units.set(unit.code, { id, name: unit.name });
  }

  const catalogue: Catalogue = { parameters: [], disciplineIds: [] };
  for (const discipline of spec) {
    const disciplineId = await node(null, types.DISCIPLINE, discipline.code, discipline.name, null);
    catalogue.disciplineIds.push(disciplineId);
    for (const group of discipline.groups) {
      const groupId = await node(null, types.GROUP, group.code, group.name, disciplineId);
      for (const product of group.products) {
        const productId = await node(null, types.PRODUCT, product.code, product.name, groupId, {
          ...(product.aliases ? { aliases: product.aliases } : {}),
        });
        const sampleUnit = product.sample ? units.get(product.sample.unitCode) : undefined;
        if (product.sample && !sampleUnit) {
          throw new Error(
            `${product.code}: the unit ${product.sample.unitCode} is not in the spec.`,
          );
        }
        for (const parameter of product.parameters) {
          const unit = parameter.unitCode ? units.get(parameter.unitCode) : undefined;
          const method = parameter.methodCode ? methods.get(parameter.methodCode) : undefined;
          if (parameter.unitCode && !unit) {
            throw new Error(
              `${parameter.code}: the unit ${parameter.unitCode} is not in the spec.`,
            );
          }
          if (parameter.methodCode && !method) {
            throw new Error(
              `${parameter.code}: the method ${parameter.methodCode} is not in the spec.`,
            );
          }
          const parameterId = await node(
            null,
            types.PARAMETER,
            parameter.code,
            parameter.name,
            productId,
            {
              ...(parameter.aliases ? { aliases: parameter.aliases } : {}),
              ...(unit ? { attributes: { unit: unit.name } } : {}),
            },
          );
          catalogue.parameters.push({
            disciplineId,
            groupId,
            productId,
            parameterId,
            discipline: discipline.name,
            product: product.name,
            parameter: parameter.name,
            productCode: product.code,
            parameterCode: parameter.code,
            ...(unit ? { unit: unit.name, unitNodeId: unit.id } : {}),
            ...(method ? { methodNodeId: method.id, methodText: method.text } : {}),
            ...(unit
              ? {
                  rangeText: rangeTextOf(parameter.range, unit.name),
                  ...(parameter.range
                    ? { rangeMin: parameter.range.min, rangeMax: parameter.range.max }
                    : {}),
                }
              : {}),
            ...(parameter.pricePaise !== undefined ? { pricePaise: parameter.pricePaise } : {}),
            ...(parameter.tatDays !== undefined ? { tatDays: parameter.tatDays } : {}),
            ...(product.sample && sampleUnit
              ? {
                  sample: {
                    qty: product.sample.qty,
                    unitNodeId: sampleUnit.id,
                    packaging: product.sample.packaging,
                  },
                }
              : {}),
          });
        }
      }
    }
  }
  await tx.mdNodeVersion.createMany({ data: versions });
  return catalogue;
}

// ---------------------------------------------------------------- customers

export interface CustomerFixture {
  organisationId: string;
  segment: CustomerSegment;
  siteId: string;
  admin: string;
  /** Absent for an individual, who is the only member. */
  requester?: string;
  finance?: string;
}

export async function createCustomer(
  tx: Tx,
  options: { tag?: string; name?: string; segment?: CustomerSegment; emailDomain?: string } = {},
): Promise<CustomerFixture> {
  const tag = options.tag ?? uuidv7().slice(-8);
  const domain = options.emailDomain ?? DEFAULT_EMAIL_DOMAIN;
  const segment = options.segment ?? 'BUSINESS';
  const name = options.name ?? `DEMO Customer ${tag}`;
  const organisationId = uuidv7();
  await tx.organisation.create({
    data: {
      id: organisationId,
      orgType: 'CUSTOMER',
      customerSegment: segment,
      legalName: name,
      displayName: name,
      claimStatus: 'NOT_APPLICABLE',
      registeredAddress: DEMO_ADDRESS,
    },
  });
  await tx.organisationPrivate.create({ data: { id: uuidv7(), organisationId } });

  const siteId = uuidv7();
  await tx.customerSite.create({
    data: {
      id: siteId,
      organisationId,
      name: `${name} (main site)`,
      address: DEMO_ADDRESS,
      pincode: DEMO_ADDRESS.pincode,
      stateCode: DEMO_ADDRESS.state_code,
      isDefaultBilling: true,
    },
  });
  await tx.customerSettings.create({
    data: { id: uuidv7(), organisationId, defaultCustomerSiteId: siteId },
  });

  const member = async (prefix: string, label: string, role: RoleCode): Promise<string> => {
    const userId = await createUser(tx, {
      email: `${prefix}.${tag}@${domain}`,
      fullName: `DEMO ${label} (${name})`,
    });
    await addMember(tx, userId, organisationId, role);
    return userId;
  };
  const fixture: CustomerFixture = {
    organisationId,
    segment,
    siteId,
    admin: await member('customer.admin', 'Customer Admin', 'CUSTOMER_ADMIN'),
  };
  if (segment !== 'INDIVIDUAL') {
    fixture.requester = await member('customer.requester', 'Requester', 'CUSTOMER_REQUESTER');
    fixture.finance = await member('customer.finance', 'Customer Finance', 'CUSTOMER_FINANCE');
  }
  return fixture;
}

// ---------------------------------------------------------------- labs

const DEMO_ADDRESS = {
  line1: 'DEMO Plot 1, DEMO Industrial Area',
  city: 'Delhi',
  district: 'New Delhi',
  state_code: 'DL',
  pincode: '110001',
};

export interface SiteSpec {
  name?: string;
  city?: string;
  stateCode?: string;
  pincode?: string;
  district?: string;
  /** Address lines. Say "DEMO" in them: the address is made up. */
  line1?: string;
  line2?: string;
  /** Approved map pin. Omit for a site that is still waiting for geocoding. */
  lat?: number;
  lon?: number;
}

export interface LabOptions {
  /** Unique within the database. Used in codes, certificate numbers and emails. */
  tag?: string;
  name?: string;
  /**
   * Onboarded: claimed, KYC and bank verified, Makers and Checkers, a published price
   * list, receiving hours and slots, so the site is bookable (BR-001).
   * Not onboarded: a listed, unclaimed lab with accreditation and scope only.
   */
  onboarded?: boolean;
  sites?: SiteSpec[];
  /** Scope lines per site, taken from the catalogue starting at `parameterOffset`. */
  parametersPerSite?: number;
  parameterOffset?: number;
  /**
   * The scope lines of site number `siteIndex`, chosen by the caller. When given, it replaces
   * `parametersPerSite`. A price and turnaround override the parameter's own; without either,
   * `price` and 5 days apply.
   */
  lines?: (siteIndex: number) => LineSpec[];
  accreditationStatus?: 'VALID' | 'SUSPENDED' | 'WITHDRAWN' | 'EXPIRED';
  makers?: number;
  checkers?: number;
  /** Days of slots to create from `now`, Sundays skipped. */
  slotDays?: number;
  /** Price of the n-th scope line of a site, in paise. */
  price?: (index: number) => bigint;
  emailDomain?: string;
  now?: Date;
}

export interface LineSpec {
  parameter: ParameterRef;
  pricePaise?: bigint;
  tatDays?: number;
}

export interface ScopeLineFixture {
  id: string;
  versionId: string;
  /** Present on onboarded labs. */
  priceItemId?: string;
  pricePaise?: bigint;
  tatDays?: number;
  parameter: ParameterRef;
}

export interface LabSiteFixture {
  id: string;
  siteCode: string;
  name: string;
  accreditationId: string;
  certificateNo: string;
  scopeLines: ScopeLineFixture[];
  priceListId?: string;
  /** Open slots, earliest first. */
  slotIds: string[];
}

export interface LabFixture {
  organisationId: string;
  name: string;
  onboarded: boolean;
  sites: LabSiteFixture[];
  /** User ids. Every Maker and Checker is assigned to every site of the lab. */
  makers: string[];
  checkers: string[];
}

export interface LabContext {
  reference: Reference;
  platform: PlatformTeam;
  catalogue: Catalogue;
  changeSetId: string;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** The calendar date in India of an instant, as a UTC-midnight Date (for `date` columns). */
export function istDate(instant: Date): Date {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}
/** An instant from an Indian calendar date and a time of day there. */
export function istInstant(date: Date, hours: number, minutes = 0): Date {
  return new Date(date.getTime() + (hours * 60 + minutes) * 60_000 - IST_OFFSET_MS);
}
const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * 86_400_000);

export async function createLab(
  tx: Tx,
  context: LabContext,
  options: LabOptions = {},
): Promise<LabFixture> {
  const { reference, platform, catalogue, changeSetId } = context;
  const tag = options.tag ?? uuidv7().slice(-8).toUpperCase();
  const domain = options.emailDomain ?? DEFAULT_EMAIL_DOMAIN;
  const name = options.name ?? `DEMO Lab ${tag}`;
  const onboarded = options.onboarded ?? true;
  const now = options.now ?? new Date();
  const today = istDate(now);
  const siteSpecs = options.sites ?? [{}];
  const perSite = options.parametersPerSite ?? Math.min(3, catalogue.parameters.length);
  const accreditationStatus = options.accreditationStatus ?? 'VALID';
  if (catalogue.parameters.length === 0) throw new Error('The catalogue has no parameters.');
  if (!options.lines && perSite > catalogue.parameters.length) {
    throw new Error('parametersPerSite is larger than the catalogue.');
  }

  const organisationId = uuidv7();
  await tx.organisation.create({
    data: {
      id: organisationId,
      orgType: 'LAB',
      legalName: name,
      displayName: name,
      claimStatus: onboarded ? 'CLAIMED' : 'UNCLAIMED',
      kycStatus: onboarded ? 'VERIFIED' : 'NOT_STARTED',
      nablLabRef: `DEMO-LAB-${tag}`,
      registeredAddress: DEMO_ADDRESS,
    },
  });
  await tx.organisationPrivate.create({ data: { id: uuidv7(), organisationId } });
  await tx.organisationVersion.create({
    data: {
      id: uuidv7(),
      organisationId,
      versionNo: 1,
      snapshot: { legalName: name },
      changeSetId,
      publishedAt: now,
    },
  });

  // ---- sites, accreditation and scope
  const sites: LabSiteFixture[] = [];
  for (const [siteIndex, spec] of siteSpecs.entries()) {
    const siteId = uuidv7();
    const stateCode = spec.stateCode ?? 'DL';
    const siteCode = `LS-${stateCode}-D${tag}-${String(siteIndex + 1)}`;
    const siteName = spec.name ?? `${name}, site ${String(siteIndex + 1)}`;
    const pincode = spec.pincode ?? DEMO_ADDRESS.pincode;
    const address = {
      line1: spec.line1 ?? `DEMO Plot ${String(siteIndex + 1)}, DEMO Industrial Area`,
      ...(spec.line2 ? { line2: spec.line2 } : {}),
      city: spec.city ?? 'Delhi',
      ...(spec.district ? { district: spec.district } : {}),
      state_code: stateCode,
      pincode,
    };
    const located = spec.lat !== undefined && spec.lon !== undefined;
    await tx.labSite.create({
      data: {
        id: siteId,
        organisationId,
        siteCode,
        name: siteName,
        address,
        pincode,
        stateCode,
        geocodeStatus: located ? 'MANUAL_APPROVED' : 'PENDING',
        geocodeConfidence: located ? 1 : null,
        isBookable: onboarded && accreditationStatus === 'VALID',
        listingStatus: onboarded && accreditationStatus === 'VALID' ? 'BOOKABLE' : 'LISTED',
        submissionInstructions: onboarded
          ? 'DEMO: hand the sealed sample to the receiving desk.'
          : null,
      },
    });
    if (located) {
      await tx.$executeRaw`
        UPDATE lab_site SET geo_point = ST_SetSRID(ST_MakePoint(${spec.lon}, ${spec.lat}), 4326)::geography
         WHERE id = ${siteId}::uuid`;
    }
    await tx.labSitePrivate.create({
      data: {
        id: uuidv7(),
        organisationId,
        labSiteId: siteId,
        contactEmail: `site.${tag.toLowerCase()}.${String(siteIndex + 1)}@${domain}`,
      },
    });
    await tx.labSiteVersion.create({
      data: {
        id: uuidv7(),
        labSiteId: siteId,
        versionNo: 1,
        snapshot: { siteCode, name: siteName, address },
        changeSetId,
        publishedAt: now,
      },
    });

    const accreditationId = uuidv7();
    const certificateNo = `DEMO-TC-${tag}-${String(siteIndex + 1)}`;
    const expired = accreditationStatus === 'EXPIRED';
    const accreditation = {
      certificateNo,
      validFrom: addDays(today, expired ? -900 : -200),
      validTo: addDays(today, expired ? -30 : 530),
      status: accreditationStatus,
    };
    await tx.accreditation.create({
      data: {
        id: accreditationId,
        organisationId,
        labSiteId: siteId,
        accreditationBodyId: reference.nablBodyId,
        standardId: reference.testingStandardId,
        labCategory: 'TESTING',
        statusAsOf: today,
        sourceRef: 'DEMO',
        ...accreditation,
      },
    });
    await tx.accreditationVersion.create({
      data: {
        id: uuidv7(),
        accreditationId,
        versionNo: 1,
        snapshot: {
          certificateNo,
          status: accreditationStatus,
          validTo: accreditation.validTo.toISOString().slice(0, 10),
        },
        changeSetId,
        publishedAt: now,
      },
    });

    const offset = (options.parameterOffset ?? 0) + siteIndex * perSite;
    const chosen: LineSpec[] =
      options.lines?.(siteIndex) ??
      Array.from({ length: perSite }, (_, index) => {
        const parameter = catalogue.parameters[(offset + index) % catalogue.parameters.length];
        if (!parameter) throw new Error('unreachable: the catalogue is not empty');
        return { parameter };
      });
    if (chosen.length === 0) throw new Error('A lab site needs at least one scope line.');
    const scopeLines: ScopeLineFixture[] = chosen.map((line) => ({
      id: uuidv7(),
      versionId: uuidv7(),
      parameter: line.parameter,
      ...(line.pricePaise !== undefined ? { pricePaise: line.pricePaise } : {}),
      ...(line.tatDays !== undefined ? { tatDays: line.tatDays } : {}),
    }));
    // A catalogue that knows the method (as published) gives it; the plain one gets a placeholder.
    const methodText = (index: number): string =>
      scopeLines[index]?.parameter.methodText ?? `DEMO method ${String(index + 1)}`;
    await tx.scopeLine.createMany({
      data: scopeLines.map((line, index) => ({
        id: line.id,
        organisationId,
        labSiteId: siteId,
        accreditationId,
        disciplineNodeId: line.parameter.disciplineId,
        groupNodeId: line.parameter.groupId,
        productNodeId: line.parameter.productId,
        parameterNodeId: line.parameter.parameterId,
        methodNodeId: line.parameter.methodNodeId ?? null,
        rangeText: line.parameter.rangeText ?? null,
        rangeMin: line.parameter.rangeMin ?? null,
        rangeMax: line.parameter.rangeMax ?? null,
        rangeUnitNodeId: line.parameter.unitNodeId ?? null,
        methodText: methodText(index),
        siteType: 'PERMANENT' as const,
        sourceRef: 'DEMO',
        naturalKeyHash: createHash('sha256')
          .update(`${siteId}|${line.parameter.parameterId}|${methodText(index)}||PERMANENT`)
          .digest(),
      })),
    });
    await tx.scopeLineVersion.createMany({
      data: scopeLines.map((line, index) => ({
        id: line.versionId,
        scopeLineId: line.id,
        versionNo: 1,
        snapshot: {
          discipline: line.parameter.discipline,
          product: line.parameter.product,
          parameter: line.parameter.parameter,
          method: methodText(index),
          certificateNo,
        },
        changeSetId,
        publishedAt: now,
      })),
    });

    sites.push({
      id: siteId,
      siteCode,
      name: siteName,
      accreditationId,
      certificateNo,
      scopeLines,
      slotIds: [],
    });
  }

  const lab: LabFixture = { organisationId, name, onboarded, sites, makers: [], checkers: [] };
  if (!onboarded) return lab;

  // ---- people: every Maker and Checker is assigned to every site
  const siteIds = sites.map((site) => site.id);
  const staff = async (count: number, prefix: string, role: RoleCode): Promise<string[]> => {
    const ids: string[] = [];
    for (let index = 1; index <= count; index++) {
      const label = role === 'LAB_MAKER' ? 'Maker' : 'Checker';
      const userId = await createUser(tx, {
        email: `${prefix}${String(index)}.${tag.toLowerCase()}@${domain}`,
        fullName: `DEMO ${label} ${String(index)} (${name})`,
        ...(role === 'LAB_CHECKER' ? { designation: 'DEMO Quality Manager' } : {}),
      });
      await addMember(tx, userId, organisationId, role, siteIds);
      ids.push(userId);
    }
    return ids;
  };
  lab.makers = await staff(options.makers ?? 1, 'maker', 'LAB_MAKER');
  lab.checkers = await staff(options.checkers ?? 1, 'checker', 'LAB_CHECKER');
  const checker = lab.checkers[0];
  if (!checker || lab.makers.length === 0) {
    throw new Error('An onboarded lab needs at least one Maker and one Checker (BR-001).');
  }

  // ---- KYC and bank, verified by platform finance. The bytes are placeholders, not ciphertext.
  const kycFileId = uuidv7();
  await tx.fileObject.create({
    data: {
      id: kycFileId,
      ownerOrgId: organisationId,
      purpose: 'KYC_DOCUMENT',
      bucket: 'demo',
      objectKey: `clean/kyc/${kycFileId}.pdf`,
      declaredContentType: 'application/pdf',
      detectedContentType: 'application/pdf',
      sizeBytes: 1024n,
      scanStatus: 'CLEAN',
      scanCompletedAt: now,
      uploadedByUserId: checker,
      retentionClass: 'KYC',
    },
  });
  await tx.kycDocument.create({
    data: {
      id: uuidv7(),
      organisationId,
      documentTypeNodeId: reference.node('KYC_DOCUMENT_TYPE', 'GST_CERTIFICATE'),
      fileId: kycFileId,
      status: 'VERIFIED',
      reviewedByUserId: platform.finance,
      reviewedAt: now,
    },
  });
  await tx.bankAccount.create({
    data: {
      id: uuidv7(),
      organisationId,
      accountHolderName: name,
      accountNumberCiphertext: Buffer.from('DEMO-NOT-A-REAL-ACCOUNT'),
      accountNumberLast4: '0000',
      ifsc: 'DEMO0000001',
      status: 'VERIFIED',
      verifiedByUserId: platform.finance,
      verifiedAt: now,
      isPrimary: true,
    },
  });

  // ---- per site: hours, retention, published price list, slots
  const price = options.price ?? ((index: number) => BigInt(100_000 + index * 25_000));
  const unitNodeId = reference.node('UNIT', 'KG');
  const slotDays = options.slotDays ?? 14;
  for (const site of sites) {
    const weekdays = [1, 2, 3, 4, 5, 6]; // Monday to Saturday
    await tx.receivingHours.createMany({
      data: weekdays.map((weekday) => ({
        id: uuidv7(),
        organisationId,
        labSiteId: site.id,
        weekday,
        opensAt: timeOfDay('09:30'),
        closesAt: timeOfDay('17:30'),
        cutoffAt: timeOfDay('16:30'),
      })),
    });
    await tx.retentionRule.create({
      data: { id: uuidv7(), organisationId, labSiteId: site.id, retentionDays: 30 },
    });

    const priceListId = uuidv7();
    await tx.priceList.create({
      data: { id: priceListId, organisationId, labSiteId: site.id, versionNo: 1 },
    });
    for (const [index, line] of site.scopeLines.entries()) {
      line.priceItemId = uuidv7();
      line.pricePaise = line.pricePaise ?? price(index);
      line.tatDays = line.tatDays ?? 5;
    }
    await tx.priceItem.createMany({
      data: site.scopeLines.map((line) => ({
        id: line.priceItemId ?? '',
        organisationId,
        priceListId,
        scopeLineId: line.id,
        pricePaise: line.pricePaise ?? 0n,
        sampleQty: line.parameter.sample?.qty ?? 1,
        sampleUnitNodeId: line.parameter.sample?.unitNodeId ?? unitNodeId,
        packagingInstructions:
          line.parameter.sample?.packaging ?? 'DEMO: sealed, labelled container.',
        tatDays: line.tatDays ?? 5,
      })),
    });
    await tx.priceList.update({
      where: { id: priceListId },
      data: {
        status: 'PUBLISHED',
        effectiveFrom: now,
        publishedAt: now,
        publishedByUserId: checker,
      },
    });
    site.priceListId = priceListId;

    const sessions = [
      { start: [10, 0], end: [13, 0] },
      { start: [14, 0], end: [17, 0] },
    ] as const;
    await tx.slotTemplate.createMany({
      data: weekdays.flatMap((weekday) =>
        sessions.map((session) => ({
          id: uuidv7(),
          organisationId,
          labSiteId: site.id,
          weekday,
          startTime: new Date(Date.UTC(1970, 0, 1, session.start[0], session.start[1])),
          endTime: new Date(Date.UTC(1970, 0, 1, session.end[0], session.end[1])),
          capacity: 5,
        })),
      ),
    });
    const slots: Prisma.SlotCreateManyInput[] = [];
    for (let offsetDays = 1; offsetDays <= slotDays; offsetDays++) {
      const date = addDays(today, offsetDays);
      if (date.getUTCDay() === 0) continue; // Sunday
      for (const session of sessions) {
        slots.push({
          id: uuidv7(),
          organisationId,
          labSiteId: site.id,
          slotDate: date,
          startsAt: istInstant(date, session.start[0], session.start[1]),
          endsAt: istInstant(date, session.end[0], session.end[1]),
          capacity: 5,
        });
      }
    }
    if (slots.length > 0) await tx.slot.createMany({ data: slots });
    site.slotIds = slots.map((slot) => slot.id);
  }

  return lab;
}

export { addDays };
