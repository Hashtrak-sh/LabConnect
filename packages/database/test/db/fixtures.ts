import { randomUUID } from 'node:crypto';
import { type Db, insert, type Row, setLocal, update } from './helpers.js';

/**
 * The smallest set of rows a booking needs: two customers, two labs, the platform,
 * users in each role, master data, and one published price list per lab.
 * Everything is fictitious.
 */
export interface World {
  users: {
    customerAdmin: string;
    otherCustomerAdmin: string;
    maker: string;
    checker: string;
    otherChecker: string;
    ops: string;
    admin: string;
  };
  orgs: {
    customer: string;
    otherCustomer: string;
    lab: string;
    otherLab: string;
    platform: string;
  };
  memberships: { customerAdmin: string; maker: string; checker: string; ops: string };
  nodes: Record<
    | 'discipline'
    | 'group'
    | 'product'
    | 'parameter'
    | 'unit'
    | 'condition'
    | 'cancelReason'
    | 'rejectReason'
    | 'holdReason'
    | 'disputeType'
    | 'refundReason'
    | 'kycType',
    string
  >;
  nodeTypes: {
    discipline: string;
    group: string;
    product: string;
    parameter: string;
    unit: string;
  };
  taxonomies: { scope: string; unit: string };
  changeSet: string;
  lab: LabFixture;
  otherLab: LabFixture;
  signingKey: string;
}

export interface LabFixture {
  org: string;
  site: string;
  accreditation: string;
  scopeLine: string;
  scopeLineVersion: string;
  priceList: string;
  priceItem: string;
}

let counter = 0;
const next = (): string => String(++counter).padStart(5, '0');

export async function createWorld(db: Db): Promise<World> {
  const user = (email: string, staff = false): Promise<string> =>
    insert(db, 'app_user', {
      email,
      full_name: email.split('@')[0],
      status: 'ACTIVE',
      is_platform_staff: staff,
    });
  const users = {
    customerAdmin: await user('customer.admin@example.test'),
    otherCustomerAdmin: await user('other.customer@example.test'),
    maker: await user('maker@example.test'),
    checker: await user('checker@example.test'),
    otherChecker: await user('other.checker@example.test'),
    ops: await user('ops@example.test', true),
    admin: await user('admin@example.test', true),
  };

  const org = (type: string, name: string): Promise<string> =>
    insert(db, 'organisation', {
      org_type: type,
      customer_segment: type === 'CUSTOMER' ? 'BUSINESS' : null,
      legal_name: name,
      display_name: name,
      claim_status: type === 'LAB' ? 'CLAIMED' : 'NOT_APPLICABLE',
    });
  const orgs = {
    customer: await org('CUSTOMER', 'DEMO Customer One'),
    otherCustomer: await org('CUSTOMER', 'DEMO Customer Two'),
    lab: await org('LAB', 'DEMO Lab One'),
    otherLab: await org('LAB', 'DEMO Lab Two'),
    platform: await org('PLATFORM', 'DEMO Platform'),
  };

  const member = async (userId: string, orgId: string, role: string): Promise<string> => {
    const id = await insert(db, 'membership', {
      user_id: userId,
      organisation_id: orgId,
      status: 'ACTIVE',
    });
    await insert(db, 'membership_role', { membership_id: id, role });
    return id;
  };
  const memberships = {
    customerAdmin: await member(users.customerAdmin, orgs.customer, 'CUSTOMER_ADMIN'),
    maker: await member(users.maker, orgs.lab, 'LAB_MAKER'),
    checker: await member(users.checker, orgs.lab, 'LAB_CHECKER'),
    ops: await member(users.ops, orgs.platform, 'PLATFORM_OPS'),
  };
  await member(users.otherCustomerAdmin, orgs.otherCustomer, 'CUSTOMER_ADMIN');
  await member(users.otherChecker, orgs.otherLab, 'LAB_CHECKER');
  await member(users.admin, orgs.platform, 'PLATFORM_ADMIN');

  // ---- master data
  const taxonomy = (code: string): Promise<string> =>
    insert(db, 'md_taxonomy', { code, name: code, is_system: true });
  const nodeType = (taxonomyId: string, code: string, level: number): Promise<string> =>
    insert(db, 'md_node_type', { taxonomy_id: taxonomyId, code, name: code, level });
  const node = (
    taxonomyId: string,
    typeId: string,
    code: string,
    parent: string | null = null,
  ): Promise<string> =>
    insert(db, 'md_node', {
      taxonomy_id: taxonomyId,
      node_type_id: typeId,
      parent_id: parent,
      code,
      name: code,
    });

  const scope = await taxonomy('SCOPE');
  const nodeTypes = {
    discipline: await nodeType(scope, 'DISCIPLINE', 1),
    group: await nodeType(scope, 'GROUP', 2),
    product: await nodeType(scope, 'PRODUCT', 3),
    parameter: await nodeType(scope, 'PARAMETER', 4),
    unit: '',
  };
  const discipline = await node(scope, nodeTypes.discipline, 'CHEMICAL');
  const group = await node(scope, nodeTypes.group, 'BUILDING_MATERIALS', discipline);
  const product = await node(scope, nodeTypes.product, 'CEMENT', group);
  const parameter = await node(scope, nodeTypes.parameter, 'CHLORIDE_CONTENT', product);

  const flat = async (
    code: string,
    nodeCode: string,
  ): Promise<{ taxonomy: string; type: string; node: string }> => {
    const t = await taxonomy(code);
    const type = await nodeType(t, 'VALUE', 1);
    return { taxonomy: t, type, node: await node(t, type, nodeCode) };
  };
  const unit = await flat('UNIT', 'KG');
  nodeTypes.unit = unit.type;
  const nodes = {
    discipline,
    group,
    product,
    parameter,
    unit: unit.node,
    condition: (await flat('SAMPLE_CONDITION', 'INTACT')).node,
    cancelReason: (await flat('CANCELLATION_REASON', 'CUSTOMER_REQUEST')).node,
    rejectReason: (await flat('REJECTION_REASON', 'NO_CAPACITY')).node,
    holdReason: (await flat('HOLD_REASON', 'INSUFFICIENT_QUANTITY')).node,
    disputeType: (await flat('DISPUTE_TYPE', 'RESULT_QUERY')).node,
    refundReason: (await flat('REFUND_REASON', 'CANCELLATION')).node,
    kycType: (await flat('KYC_DOCUMENT_TYPE', 'GST_CERTIFICATE')).node,
  };
  await taxonomy('METHOD');

  const changeSet = await insert(db, 'md_change_set', {
    title: 'Fixture data',
    source: 'MANUAL',
    prepared_by_user_id: users.ops,
  });
  const body = await insert(db, 'accreditation_body', { code: 'NABL', name: 'NABL' });
  const standard = await insert(db, 'accreditation_standard', {
    code: 'ISO_IEC_17025_TESTING',
    name: 'ISO/IEC 17025 (testing)',
    lab_category: 'TESTING',
    is_bookable: true,
  });

  const lab = async (orgId: string, tag: string): Promise<LabFixture> => {
    const site = await insert(db, 'lab_site', {
      organisation_id: orgId,
      site_code: `LS-DL-${tag}`,
      name: `DEMO Site ${tag}`,
      address: { line1: 'DEMO', city: 'Delhi', state_code: 'DL', pincode: '110001' },
      pincode: '110001',
      state_code: 'DL',
    });
    const accreditation = await insert(db, 'accreditation', {
      organisation_id: orgId,
      lab_site_id: site,
      accreditation_body_id: body,
      standard_id: standard,
      lab_category: 'TESTING',
      certificate_no: `TC-${tag}`,
      valid_from: '2026-01-01',
      valid_to: '2027-12-31',
      status: 'VALID',
      status_as_of: '2026-11-01',
    });
    const scopeLine = await insert(db, 'scope_line', {
      organisation_id: orgId,
      lab_site_id: site,
      accreditation_id: accreditation,
      discipline_node_id: discipline,
      parameter_node_id: parameter,
      site_type: 'PERMANENT',
      natural_key_hash: Buffer.from(`hash-${tag}`),
    });
    const scopeLineVersion = await insert(db, 'scope_line_version', {
      scope_line_id: scopeLine,
      version_no: 1,
      snapshot: { parameter: 'CHLORIDE_CONTENT' },
      change_set_id: changeSet,
      published_at: new Date(),
    });
    const priceList = await insert(db, 'price_list', {
      organisation_id: orgId,
      lab_site_id: site,
      version_no: 1,
    });
    const priceItem = await insert(db, 'price_item', {
      organisation_id: orgId,
      price_list_id: priceList,
      scope_line_id: scopeLine,
      price_paise: 100_000,
      sample_qty: 1,
      sample_unit_node_id: unit.node,
      tat_days: 5,
    });
    await update(db, 'price_list', priceList, {
      status: 'PUBLISHED',
      effective_from: new Date(),
      published_at: new Date(),
    });
    return { org: orgId, site, accreditation, scopeLine, scopeLineVersion, priceList, priceItem };
  };

  const world: World = {
    users,
    orgs,
    memberships,
    nodes,
    nodeTypes,
    taxonomies: { scope, unit: unit.taxonomy },
    changeSet,
    lab: await lab(orgs.lab, '000001'),
    otherLab: await lab(orgs.otherLab, '000002'),
    signingKey: 'k1',
  };
  await insert(db, 'qr_signing_key', {
    key_id: 'k1',
    purpose: 'PACKAGE',
    kms_key_arn: 'arn:aws:kms:ap-south-1:000000000000:key/demo',
    status: 'ACTIVE',
  });
  return world;
}

// ---------------------------------------------------------------- bookings

export interface Booking {
  id: string;
  customerOrg: string;
  labOrg: string;
  line: string;
  keys: { booking_id: string; customer_org_id: string; lab_org_id: string };
}

/** Creates a REQUESTED booking with one line, the way T-01 does. 100000 + 18% GST = 118000 paise. */
export async function createBooking(
  db: Db,
  world: World,
  options: { customerOrg?: string; lab?: LabFixture; overrides?: Row } = {},
): Promise<Booking> {
  const lab = options.lab ?? world.lab;
  const customerOrg = options.customerOrg ?? world.orgs.customer;
  await setLocal(db, 'app.transition_id', 'T-01');
  const id = await insert(db, 'booking', {
    booking_no: `LC-2611-${next()}`,
    customer_org_id: customerOrg,
    requester_user_id: world.users.customerAdmin,
    lab_site_id: lab.site,
    lab_org_id: lab.org,
    status: 'REQUESTED',
    item_name: 'DEMO cement sample',
    declared_package_count: 1,
    preferred_drop_date: '2026-12-01',
    price_list_id: lab.priceList,
    subtotal_paise: 100_000,
    gst_paise: 18_000,
    total_paise: 118_000,
    lab_snapshot: { site: 'DEMO' },
    ...options.overrides,
  });
  const keys = { booking_id: id, customer_org_id: customerOrg, lab_org_id: lab.org };
  const line = await insert(db, 'booking_line', {
    ...keys,
    line_no: 1,
    scope_line_id: lab.scopeLine,
    scope_line_version_id: lab.scopeLineVersion,
    price_item_id: lab.priceItem,
    snapshot: { parameter: 'CHLORIDE_CONTENT' },
    unit_price_paise: 100_000,
    sample_prep_paise: 0,
    gst_rate_bp: 1800,
    gst_paise: 18_000,
    line_total_paise: 118_000,
  });
  return { id, customerOrg, labOrg: lab.org, line, keys };
}

/** Moves a booking along one transition, as the booking engine does. */
export async function transition(
  db: Db,
  bookingId: string,
  transitionId: string,
  to: string,
  extra: Row = {},
): Promise<void> {
  await setLocal(db, 'app.transition_id', transitionId);
  await update(db, 'booking', bookingId, { status: to, ...extra });
}

const PATH: [string, string][] = [
  ['T-03', 'ACCEPTED'],
  ['T-09', 'PAID'],
  ['T-11', 'HANDOVER_SET'],
  ['T-13', 'SAMPLE_RECORDED'],
  ['T-14', 'RECEIVED'],
  ['T-18', 'UNDER_TEST'],
  ['T-19', 'REPORT_IN_REVIEW'],
  ['T-21', 'REPORT_RELEASED'],
];

/** Walks the happy path up to and including the given state. */
export async function advanceTo(db: Db, bookingId: string, state: string): Promise<void> {
  for (const [transitionId, to] of PATH) {
    await transition(db, bookingId, transitionId, to);
    if (to === state) return;
  }
  throw new Error(`state ${state} is not on the happy path`);
}

export async function createPackage(
  db: Db,
  world: World,
  booking: Booking,
  values: Row = {},
): Promise<string> {
  return insert(db, 'package', {
    ...booking.keys,
    seq_no: 1,
    total_packages: 1,
    short_code: randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase(),
    qr_payload: 'demo-payload',
    signing_key_id: world.signingKey,
    ...values,
  });
}

export async function createReceipt(
  db: Db,
  world: World,
  booking: Booking,
  values: Row = {},
): Promise<string> {
  return insert(db, 'receipt_record', {
    ...booking.keys,
    version_no: 1,
    received_at: new Date(),
    declared_package_count: 1,
    actual_package_count: 1,
    condition_node_id: world.nodes.condition,
    item_matches: true,
    batch_matches: true,
    quantity_sufficient: true,
    seal_intact: true,
    maker_user_id: world.users.maker,
    submitted_at: new Date(),
    ...values,
  });
}

export async function createPaymentOrder(
  db: Db,
  world: World,
  booking: Booking,
  values: Row = {},
): Promise<string> {
  return insert(db, 'payment_order', {
    ...booking.keys,
    attempt_no: 1,
    idempotency_key: randomUUID(),
    gateway: 'FAKE',
    amount_paise: 118_000,
    initiated_by_user_id: world.users.customerAdmin,
    ...values,
  });
}

export async function capture(
  db: Db,
  booking: Booking,
  paymentOrderId: string,
  amount = 118_000,
): Promise<string> {
  return insert(db, 'payment_transaction', {
    payment_order_id: paymentOrderId,
    customer_org_id: booking.customerOrg,
    lab_org_id: booking.labOrg,
    gateway: 'FAKE',
    gateway_txn_ref: randomUUID(),
    txn_type: 'CAPTURE',
    amount_paise: amount,
    status: 'SUCCESS',
  });
}

export async function createReport(
  db: Db,
  world: World,
  booking: Booking,
  values: Row = {},
): Promise<string> {
  return insert(db, 'report', { ...booking.keys, lab_site_id: world.lab.site, ...values });
}

/** A report version in DRAFT. Pass `submitted: true` for a version that satisfies the IN_REVIEW checks. */
export async function createReportVersion(
  db: Db,
  world: World,
  booking: Booking,
  reportId: string,
  options: { submitted?: boolean; values?: Row } = {},
): Promise<string> {
  let submitted: Row = {};
  if (options.submitted) {
    const packageId = await createPackage(db, world, booking, {
      seq_no: 90 + (counter % 9),
      label_version: ++counter,
    });
    const file = await insert(db, 'file_object', {
      purpose: 'REPORT_ORIGINAL',
      bucket: 'demo',
      object_key: `clean/${randomUUID()}.pdf`,
      declared_content_type: 'application/pdf',
      size_bytes: 1024,
      retention_class: 'REPORT',
    });
    const event = await insert(db, 'custody_event', {
      ...booking.keys,
      package_id: packageId,
      event_type: 'REPORT_BOUND',
    });
    submitted = {
      status: 'IN_REVIEW',
      issue_date: '2026-12-10',
      original_file_id: file,
      original_sha256: Buffer.from('original'),
      bound_package_id: packageId,
      bind_event_id: event,
      submitted_at: new Date(),
      verification_code: randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase(),
      signing_key_id: world.signingKey,
    };
  }
  return insert(db, 'report_version', {
    ...booking.keys,
    report_id: reportId,
    version_no: 1,
    maker_user_id: world.users.maker,
    ...submitted,
    ...options.values,
  });
}

/** The columns a version needs to be RELEASED (C-55). */
export async function releaseValues(db: Db, world: World): Promise<Row> {
  const stamped = await insert(db, 'file_object', {
    purpose: 'REPORT_STAMPED',
    bucket: 'demo',
    object_key: `clean/${randomUUID()}-stamped.pdf`,
    declared_content_type: 'application/pdf',
    size_bytes: 2048,
    retention_class: 'REPORT',
  });
  return {
    status: 'RELEASED',
    checker_user_id: world.users.checker,
    checker_mfa_at: new Date(),
    decided_at: new Date(),
    released_at: new Date(),
    stamped_file_id: stamped,
    stamped_sha256: Buffer.from('stamped'),
  };
}
