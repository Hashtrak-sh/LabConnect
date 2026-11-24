import { randomBytes } from 'node:crypto';
import type { BookingStatus, Prisma } from '../generated/prisma/client.js';
import { uuidv7 } from '../ids.js';
import {
  addDays,
  type CustomerFixture,
  istDate,
  istInstant,
  type LabFixture,
  type LabSiteFixture,
  type Reference,
  type Tx,
} from './world.js';

// `bookingInState` builds a booking and walks it to a state along the transitions of
// docs/02-architecture/BOOKING_STATE_MACHINE.md, writing the rows each transition
// leaves behind: status history, slot hold, counter-offer, payment and its ledger
// journal, packages and custody events, receipt, hold case, report and its version,
// dispute and payout hold.
//
// It does NOT write what belongs to other parts of the application: audit log, outbox
// events, timers, notifications, refunds, financial documents and payouts.

type PartyType = 'CUSTOMER' | 'LAB' | 'PLATFORM' | 'SYSTEM';
type RoleCode = NonNullable<Prisma.BookingStatusHistoryUncheckedCreateInput['actorRole']>;

export interface BookingOptions {
  reference: Reference;
  customer: CustomerFixture;
  /** Must be an onboarded lab. */
  lab: LabFixture;
  /** Which site of the lab. Default: the first. */
  site?: LabSiteFixture;
  /** How many of the site's scope lines to book. Default 1. */
  lineCount?: number;
  /** Default 1. */
  packageCount?: number;
  /** A slot of the site, or null for none. Default: its earliest slot with room. */
  slotId?: string | null;
  /** Default: a random number in the format LC-YYMM-NNNNNNN. */
  bookingNo?: string;
  itemName?: string;
  now?: Date;
}

export interface BookingFixture {
  id: string;
  bookingNo: string;
  status: BookingStatus;
  customerOrgId: string;
  labOrgId: string;
  labSiteId: string;
  totalPaise: bigint;
  lineIds: string[];
  /** Filled as the booking passes the state that creates them. */
  slotId?: string;
  paymentOrderId?: string;
  packageIds: string[];
  receiptRecordId?: string;
  holdCaseId?: string;
  reportId?: string;
  reportVersionId?: string;
  disputeId?: string;
}

/** GST on one line: round half up of taxable × rate / 10000 (PAYMENTS_AND_LEDGER.md section 1). */
export function gstPaise(taxablePaise: bigint, rateBp: number): bigint {
  return (taxablePaise * BigInt(rateBp) + 5000n) / 10_000n;
}

interface Walk {
  tx: Tx;
  options: BookingOptions;
  booking: BookingFixture;
  keys: { bookingId: string; customerOrgId: string; labOrgId: string };
  maker: string;
  checker: string;
  customerUser: string;
  now: Date;
}

type Step = (walk: Walk) => Promise<void>;

/** Changes the status the only way the database allows, and records the history row. */
async function transition(
  walk: Walk,
  transitionId: string,
  to: BookingStatus,
  actor: { party: PartyType; userId?: string; role?: RoleCode },
  data: Prisma.BookingUncheckedUpdateInput = {},
  reason?: string,
): Promise<void> {
  const { tx, booking, keys } = walk;
  const from = booking.status;
  await tx.$executeRaw`SELECT set_config('app.transition_id', ${transitionId}, true)`;
  await tx.booking.update({ where: { id: booking.id }, data: { ...data, status: to } });
  await tx.$executeRaw`SELECT set_config('app.transition_id', '', true)`;
  await tx.bookingStatusHistory.create({
    data: {
      id: uuidv7(),
      ...keys,
      transitionId,
      fromStatus: from,
      toStatus: to,
      actorParty: actor.party,
      actorUserId: actor.userId ?? null,
      actorRole: actor.role ?? null,
      reason: reason ?? null,
    },
  });
  booking.status = to;
}

async function releaseSlot(walk: Walk): Promise<void> {
  const { tx, booking } = walk;
  if (!booking.slotId) return;
  const hold = await tx.slotHold.findFirst({
    where: { bookingId: booking.id, releasedAt: null },
  });
  if (!hold) return;
  await tx.slotHold.update({ where: { id: hold.id }, data: { releasedAt: walk.now } });
  await tx.slot.update({
    where: { id: hold.slotId },
    data:
      hold.kind === 'SOFT' ? { heldCount: { decrement: 1 } } : { bookedCount: { decrement: 1 } },
  });
}

async function custodyEvent(
  walk: Walk,
  eventType: Prisma.CustodyEventUncheckedCreateInput['eventType'],
  values: { packageId?: string; actorUserId?: string; actorRole?: RoleCode } = {},
): Promise<string> {
  const id = uuidv7();
  await walk.tx.custodyEvent.create({
    data: {
      id,
      ...walk.keys,
      eventType,
      labSiteId: walk.booking.labSiteId,
      packageId: values.packageId ?? null,
      actorUserId: values.actorUserId ?? null,
      actorRole: values.actorRole ?? null,
    },
  });
  return id;
}

async function file(
  walk: Walk,
  purpose: 'REPORT_ORIGINAL' | 'REPORT_STAMPED',
  uploadedByUserId: string | null,
): Promise<string> {
  const id = uuidv7();
  await walk.tx.fileObject.create({
    data: {
      id,
      ownerOrgId: walk.keys.labOrgId,
      customerOrgId: walk.keys.customerOrgId,
      labOrgId: walk.keys.labOrgId,
      purpose,
      bucket: 'demo',
      objectKey: `clean/reports/${id}.pdf`,
      declaredContentType: 'application/pdf',
      detectedContentType: 'application/pdf',
      sizeBytes: 2048n,
      sha256: randomBytes(32),
      scanStatus: 'CLEAN',
      scanCompletedAt: walk.now,
      uploadedByUserId,
      retentionClass: 'REPORT',
    },
  });
  return id;
}

// ---------------------------------------------------------------- steps

const accept: Step = async (walk) => {
  const { tx, booking, now } = walk;
  const hold = await tx.slotHold.findFirst({ where: { bookingId: booking.id, releasedAt: null } });
  if (hold) {
    // T-03: the hold converts to a booking.
    await tx.slotHold.update({
      where: { id: hold.id },
      data: { kind: 'CONFIRMED', expiresAt: null },
    });
    await tx.slot.update({
      where: { id: hold.slotId },
      data: { heldCount: { decrement: 1 }, bookedCount: { increment: 1 } },
    });
  }
  await transition(
    walk,
    'T-03',
    'ACCEPTED',
    { party: 'LAB', userId: walk.checker, role: 'LAB_CHECKER' },
    { paymentDueAt: new Date(now.getTime() + 24 * 3_600_000) },
  );
};

const counter: Step = async (walk) => {
  const { tx, keys, now } = walk;
  await tx.counterOffer.create({
    data: {
      id: uuidv7(),
      ...keys,
      proposedDropDate: addDays(istDate(now), 3),
      message: 'DEMO: the requested day is full. Please drop the sample one day later.',
      expiresAt: new Date(now.getTime() + 24 * 3_600_000),
      proposedByUserId: walk.checker,
    },
  });
  await transition(walk, 'T-04', 'COUNTERED', {
    party: 'LAB',
    userId: walk.checker,
    role: 'LAB_CHECKER',
  });
};

const reject: Step = async (walk) => {
  await releaseSlot(walk);
  await transition(
    walk,
    'T-05',
    'REJECTED',
    { party: 'LAB', userId: walk.checker, role: 'LAB_CHECKER' },
    {
      rejectionReasonNodeId: walk.options.reference.node('REJECTION_REASON', 'NO_CAPACITY'),
      rejectionNotes: 'DEMO: no capacity this week.',
    },
    'NO_CAPACITY',
  );
};

const expireDecision: Step = async (walk) => {
  await releaseSlot(walk);
  await transition(walk, 'T-06', 'EXPIRED', { party: 'SYSTEM' });
};

const cancel: Step = async (walk) => {
  await releaseSlot(walk);
  await transition(
    walk,
    'T-25',
    'CANCELLED',
    { party: 'CUSTOMER', userId: walk.customerUser, role: 'CUSTOMER_ADMIN' },
    {
      cancellationCodeNodeId: walk.options.reference.node(
        'CANCELLATION_REASON',
        'CUSTOMER_REQUEST',
      ),
      cancelledByParty: 'CUSTOMER',
      cancellationNotes: 'DEMO: no longer needed.',
    },
    'CUSTOMER_REQUEST',
  );
};

const expirePayment: Step = async (walk) => {
  await releaseSlot(walk);
  await transition(walk, 'T-10', 'EXPIRED_UNPAID', { party: 'SYSTEM' });
};

/** Finds or creates the ledger account of a code, platform-wide or for one party. */
async function ledgerAccount(tx: Tx, code: string, partyOrgId: string | null): Promise<string> {
  const existing = await tx.ledgerAccount.findFirst({ where: { code, partyOrgId } });
  if (existing) return existing.id;
  const general = await tx.ledgerAccount.findFirst({ where: { code, partyOrgId: null } });
  if (!general) throw new Error(`Ledger account ${code} is missing. Run seed:reference first.`);
  const id = uuidv7();
  await tx.ledgerAccount.create({
    data: { id, code, partyOrgId, normalBalance: general.normalBalance },
  });
  return id;
}

const pay: Step = async (walk) => {
  const { tx, booking, keys, now } = walk;
  const orderId = uuidv7();
  await tx.paymentOrder.create({
    data: {
      id: orderId,
      ...keys,
      attemptNo: 1,
      idempotencyKey: uuidv7(),
      gateway: 'FAKE',
      gatewayOrderRef: `FAKE-ORDER-${booking.bookingNo}`,
      amountPaise: booking.totalPaise,
      status: 'CAPTURED',
      initiatedByUserId: walk.customerUser,
    },
  });
  const transactionId = uuidv7();
  await tx.paymentTransaction.create({
    data: {
      id: transactionId,
      customerOrgId: keys.customerOrgId,
      labOrgId: keys.labOrgId,
      paymentOrderId: orderId,
      gateway: 'FAKE',
      gatewayTxnRef: `FAKE-TXN-${booking.bookingNo}`,
      txnType: 'CAPTURE',
      method: 'FAKE',
      amountPaise: booking.totalPaise,
      status: 'SUCCESS',
      gatewayReportedAt: now,
    },
  });
  // Payment captured: debit GATEWAY_CLEARING, credit CUSTOMER_PREPAYMENT of the customer.
  const journalId = uuidv7();
  await tx.ledgerJournal.create({
    data: {
      id: journalId,
      ...keys,
      journalType: 'PAYMENT_CAPTURED',
      paymentTransactionId: transactionId,
      description: `Payment captured for ${booking.bookingNo}`,
      occurredAt: now,
    },
  });
  await tx.ledgerEntry.createMany({
    data: [
      {
        id: uuidv7(),
        journalId,
        accountId: await ledgerAccount(tx, 'GATEWAY_CLEARING', null),
        debitPaise: booking.totalPaise,
      },
      {
        id: uuidv7(),
        journalId,
        accountId: await ledgerAccount(tx, 'CUSTOMER_PREPAYMENT', keys.customerOrgId),
        creditPaise: booking.totalPaise,
      },
    ],
  });
  booking.paymentOrderId = orderId;
  await transition(walk, 'T-09', 'PAID', { party: 'SYSTEM' });
};

const issueHandover: Step = async (walk) => {
  const { tx, booking, keys, options } = walk;
  const total = options.packageCount ?? 1;
  const keyId = options.reference.keys.PACKAGE;
  for (let seqNo = 1; seqNo <= total; seqNo++) {
    const id = uuidv7();
    await tx.package.create({
      data: {
        id,
        ...keys,
        seqNo,
        totalPackages: total,
        shortCode: randomBytes(3).toString('hex').toUpperCase(),
        // The MAC is a placeholder: real payloads are signed by KMS (QR_AND_VERIFICATION.md).
        qrPayload: `LC1.P.${booking.bookingNo}.${String(seqNo)}-${String(total)}.1.${keyId}.DEMO-NOT-SIGNED`,
        signingKeyId: keyId,
      },
    });
    await custodyEvent(walk, 'QR_ISSUED', { packageId: id });
    booking.packageIds.push(id);
  }
  const booked = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
  await transition(
    walk,
    'T-11',
    'HANDOVER_SET',
    { party: 'SYSTEM' },
    // BR-040: the end of the day of the drop, in India.
    { dropDeadlineAt: istInstant(addDays(booked.preferredDropDate, 1), 0) },
  );
};

const noShow: Step = async (walk) => {
  await releaseSlot(walk);
  await transition(walk, 'T-12', 'NO_SHOW', { party: 'SYSTEM' });
};

/** T-13. With `discrepancy`, the Maker records too little sample, which leads to a hold. */
const submitReceipt =
  (discrepancy: boolean): Step =>
  async (walk) => {
    const { tx, booking, keys, options, now } = walk;
    const maker = { actorUserId: walk.maker, actorRole: 'LAB_MAKER' as const };
    const receiptId = uuidv7();
    const scans: { packageId: string; eventId: string }[] = [];
    for (const packageId of booking.packageIds) {
      scans.push({
        packageId,
        eventId: await custodyEvent(walk, 'SCAN_ACCEPTED', { packageId, ...maker }),
      });
    }
    await tx.receiptRecord.create({
      data: {
        id: receiptId,
        ...keys,
        versionNo: 1,
        receivedAt: now,
        declaredPackageCount: booking.packageIds.length,
        actualPackageCount: booking.packageIds.length,
        conditionNodeId: options.reference.node('SAMPLE_CONDITION', 'INTACT'),
        itemMatches: true,
        batchMatches: true,
        quantitySufficient: !discrepancy,
        sealIntact: true,
        discrepancyFlag: discrepancy,
        discrepancyNotes: discrepancy ? 'DEMO: the quantity is less than the tests need.' : null,
        makerUserId: walk.maker,
        submittedAt: now,
      },
    });
    await tx.receiptPackage.createMany({
      data: scans.map((scan) => ({
        id: uuidv7(),
        ...keys,
        receiptRecordId: receiptId,
        packageId: scan.packageId,
        scannedAt: now,
        scanEventId: scan.eventId,
      })),
    });
    await custodyEvent(walk, 'RECEIPT_SUBMITTED', maker);
    booking.receiptRecordId = receiptId;
    await transition(walk, 'T-13', 'SAMPLE_RECORDED', {
      party: 'LAB',
      userId: walk.maker,
      role: 'LAB_MAKER',
    });
  };

const labSampleId = (walk: Walk): string => `DEMO-S-${walk.booking.bookingNo.slice(-7)}`;

const approveReceipt: Step = async (walk) => {
  const { tx, booking, now } = walk;
  const sampleId = labSampleId(walk);
  await tx.receiptRecord.update({
    where: { id: booking.receiptRecordId ?? '' },
    data: {
      decision: 'APPROVED',
      checkerUserId: walk.checker,
      decidedAt: now,
      labSampleId: sampleId,
    },
  });
  await tx.package.updateMany({
    where: { bookingId: booking.id, status: 'ISSUED' },
    data: { status: 'RECEIVED', receivedAt: now, labSampleId: sampleId },
  });
  await custodyEvent(walk, 'RECEIPT_APPROVED', {
    actorUserId: walk.checker,
    actorRole: 'LAB_CHECKER',
  });
  await transition(
    walk,
    'T-14',
    'RECEIVED',
    { party: 'LAB', userId: walk.checker, role: 'LAB_CHECKER' },
    { retainUntil: addDays(istDate(now), 30) },
  );
};

const confirmDiscrepancy: Step = async (walk) => {
  const { tx, booking, keys, options, now } = walk;
  await tx.receiptRecord.update({
    where: { id: booking.receiptRecordId ?? '' },
    data: {
      decision: 'HOLD_CONFIRMED',
      checkerUserId: walk.checker,
      decidedAt: now,
      labSampleId: labSampleId(walk),
    },
  });
  const holdCaseId = uuidv7();
  await tx.holdCase.create({
    data: {
      id: holdCaseId,
      ...keys,
      receiptRecordId: booking.receiptRecordId ?? '',
      reasonNodeId: options.reference.node('HOLD_REASON', 'INSUFFICIENT_QUANTITY'),
      details: 'DEMO: the quantity is less than the tests need.',
      dueAt: new Date(now.getTime() + 24 * 3_600_000),
    },
  });
  await custodyEvent(walk, 'RECEIPT_ON_HOLD', {
    actorUserId: walk.checker,
    actorRole: 'LAB_CHECKER',
  });
  booking.holdCaseId = holdCaseId;
  await transition(
    walk,
    'T-15',
    'ON_HOLD',
    { party: 'LAB', userId: walk.checker, role: 'LAB_CHECKER' },
    {},
    'INSUFFICIENT_QUANTITY',
  );
};

const startTesting: Step = async (walk) => {
  const { tx, booking, now } = walk;
  await tx.bookingLine.updateMany({
    where: { bookingId: booking.id },
    data: { status: 'IN_PROGRESS' },
  });
  await transition(
    walk,
    'T-18',
    'UNDER_TEST',
    { party: 'LAB', userId: walk.maker, role: 'LAB_MAKER' },
    { expectedReportDate: addDays(istDate(now), 5) },
  );
};

const submitReport: Step = async (walk) => {
  const { tx, booking, keys, options, now } = walk;
  const packageId = booking.packageIds[0];
  if (!packageId) throw new Error('unreachable: a booking under test has a package');
  const reportId = uuidv7();
  await tx.report.create({
    data: {
      id: reportId,
      ...keys,
      labSiteId: booking.labSiteId,
      reportNo: `DEMO-R-${booking.bookingNo}`,
      ulrNo: `DEMO-ULR-${booking.bookingNo}`,
    },
  });
  const originalFileId = await file(walk, 'REPORT_ORIGINAL', walk.maker);
  const bindEventId = await custodyEvent(walk, 'REPORT_BOUND', {
    packageId,
    actorUserId: walk.maker,
    actorRole: 'LAB_MAKER',
  });
  const versionId = uuidv7();
  await tx.reportVersion.create({
    data: {
      id: versionId,
      ...keys,
      reportId,
      versionNo: 1,
      status: 'IN_REVIEW',
      issueDate: istDate(now),
      originalFileId,
      originalSha256: randomBytes(32),
      boundPackageId: packageId,
      bindEventId,
      makerUserId: walk.maker,
      submittedAt: now,
      verificationCode: randomBytes(8).toString('hex').toUpperCase(),
      signingKeyId: options.reference.keys.REPORT,
    },
  });
  await tx.reportParameterResult.createMany({
    data: booking.lineIds.map((bookingLineId) => ({
      id: uuidv7(),
      ...keys,
      reportVersionId: versionId,
      bookingLineId,
      conformity: 'NOT_STATED' as const,
    })),
  });
  await tx.bookingLine.updateMany({ where: { bookingId: booking.id }, data: { status: 'DONE' } });
  booking.reportId = reportId;
  booking.reportVersionId = versionId;
  await transition(walk, 'T-19', 'REPORT_IN_REVIEW', {
    party: 'LAB',
    userId: walk.maker,
    role: 'LAB_MAKER',
  });
};

const publishReport: Step = async (walk) => {
  const { tx, booking, now } = walk;
  const stampedFileId = await file(walk, 'REPORT_STAMPED', null);
  await tx.reportVersion.update({
    where: { id: booking.reportVersionId ?? '' },
    data: {
      status: 'RELEASED',
      checkerUserId: walk.checker,
      checkerMfaAt: now,
      decidedAt: now,
      releasedAt: now,
      stampedFileId,
      stampedSha256: randomBytes(32),
    },
  });
  await tx.report.update({
    where: { id: booking.reportId ?? '' },
    data: { status: 'RELEASED', currentReleasedVersionId: booking.reportVersionId ?? null },
  });
  await transition(
    walk,
    'T-21',
    'REPORT_RELEASED',
    { party: 'LAB', userId: walk.checker, role: 'LAB_CHECKER' },
    { reportReleasedAt: now, disputeWindowEndsAt: new Date(now.getTime() + 72 * 3_600_000) },
  );
};

const raiseDispute: Step = async (walk) => {
  const { tx, booking, keys, options, now } = walk;
  const disputeId = uuidv7();
  await tx.dispute.create({
    data: {
      id: disputeId,
      ...keys,
      disputeNo: `D-${booking.bookingNo}`,
      typeNodeId: options.reference.node('DISPUTE_TYPE', 'RESULT_QUERY'),
      raisedByUserId: walk.customerUser,
      raisedByParty: 'CUSTOMER',
      description: 'DEMO: the result differs from an earlier test of the same batch.',
      labResponseDueAt: new Date(now.getTime() + 48 * 3_600_000),
    },
  });
  await tx.payoutHold.create({
    data: { id: uuidv7(), ...keys, reasonType: 'DISPUTE', disputeId },
  });
  booking.disputeId = disputeId;
  await transition(walk, 'T-22', 'DISPUTED', {
    party: 'CUSTOMER',
    userId: walk.customerUser,
    role: 'CUSTOMER_ADMIN',
  });
};

const complete: Step = async (walk) => {
  await transition(walk, 'T-23', 'COMPLETED', { party: 'SYSTEM' }, { completedAt: walk.now });
};

const toHandover: Step[] = [accept, pay, issueHandover];
const toReceived: Step[] = [...toHandover, submitReceipt(false), approveReceipt];
const toReleased: Step[] = [...toReceived, startTesting, submitReport, publishReport];

/** The steps after T-01 that lead to each state. One route per state; others exist. */
const ROUTES: Record<BookingStatus, Step[]> = {
  REQUESTED: [],
  COUNTERED: [counter],
  REJECTED: [reject],
  EXPIRED: [expireDecision],
  CANCELLED: [cancel],
  ACCEPTED: [accept],
  EXPIRED_UNPAID: [accept, expirePayment],
  PAID: [accept, pay],
  HANDOVER_SET: toHandover,
  NO_SHOW: [...toHandover, noShow],
  SAMPLE_RECORDED: [...toHandover, submitReceipt(false)],
  ON_HOLD: [...toHandover, submitReceipt(true), confirmDiscrepancy],
  RECEIVED: toReceived,
  UNDER_TEST: [...toReceived, startTesting],
  REPORT_IN_REVIEW: [...toReceived, startTesting, submitReport],
  REPORT_RELEASED: toReleased,
  DISPUTED: [...toReleased, raiseDispute],
  COMPLETED: [...toReleased, complete],
};

export const BOOKING_STATES = Object.keys(ROUTES) as BookingStatus[];

/** The earliest open slot of the site that still has room (BR-011). */
async function freeSlot(tx: Tx, labSiteId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM slot
     WHERE lab_site_id = ${labSiteId}::uuid AND status = 'OPEN' AND held_count + booked_count < capacity
     ORDER BY starts_at LIMIT 1`;
  return rows[0]?.id ?? null;
}

function randomBookingNo(now: Date): string {
  const date = istDate(now);
  const yymm = `${String(date.getUTCFullYear()).slice(2)}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  const serial = String(randomBytes(4).readUInt32BE() % 10_000_000).padStart(7, '0');
  return `LC-${yymm}-${serial}`;
}

/**
 * Creates a booking in the given state. Call it inside a transaction: the status guard
 * reads a transaction-local setting.
 */
export async function bookingInState(
  tx: Tx,
  state: BookingStatus,
  options: BookingOptions,
): Promise<BookingFixture> {
  const { customer, lab } = options;
  const site = options.site ?? lab.sites[0];
  const maker = lab.makers[0];
  const checker = lab.checkers[0];
  if (!site?.priceListId || !maker || !checker) {
    throw new Error('bookingInState needs an onboarded lab (price list, Maker and Checker).');
  }
  const now = options.now ?? new Date();
  const lines = site.scopeLines.slice(0, options.lineCount ?? 1);
  if (lines.length === 0) throw new Error('The site has no scope lines to book.');

  // ---- T-01 SubmitBooking: prices and scope versions are frozen into the lines (BR-020)
  const gstRateBp = 1800;
  const priced = lines.map((line, index) => {
    if (!line.priceItemId || line.pricePaise === undefined) {
      throw new Error('The scope line has no price.');
    }
    const gst = gstPaise(line.pricePaise, gstRateBp);
    return { line, lineNo: index + 1, gst, total: line.pricePaise + gst, price: line.pricePaise };
  });
  const subtotalPaise = priced.reduce((sum, row) => sum + row.price, 0n);
  const gstTotal = priced.reduce((sum, row) => sum + row.gst, 0n);
  const totalPaise = subtotalPaise + gstTotal;

  const id = uuidv7();
  const bookingNo = options.bookingNo ?? randomBookingNo(now);
  const keys = {
    bookingId: id,
    customerOrgId: customer.organisationId,
    labOrgId: lab.organisationId,
  };
  const slotId = options.slotId === undefined ? await freeSlot(tx, site.id) : options.slotId;
  const slot = slotId ? await tx.slot.findUniqueOrThrow({ where: { id: slotId } }) : null;
  const requester = customer.requester ?? customer.admin;
  const decisionDue = new Date(now.getTime() + 4 * 3_600_000); // BR-012, without the business calendar

  await tx.$executeRaw`SELECT set_config('app.transition_id', 'T-01', true)`;
  await tx.booking.create({
    data: {
      id,
      bookingNo,
      customerOrgId: customer.organisationId,
      customerSiteId: customer.siteId,
      requesterUserId: requester,
      labSiteId: site.id,
      labOrgId: lab.organisationId,
      status: 'REQUESTED',
      itemName: options.itemName ?? 'DEMO sample',
      batchNo: 'DEMO-BATCH-1',
      declaredPackageCount: options.packageCount ?? 1,
      slotId,
      preferredDropDate: slot ? slot.slotDate : addDays(istDate(now), 2),
      priceListId: site.priceListId,
      subtotalPaise,
      gstPaise: gstTotal,
      totalPaise,
      labSnapshot: {
        labName: lab.name,
        siteName: site.name,
        siteCode: site.siteCode,
        certificateNo: site.certificateNo,
      },
      labDecisionDueAt: decisionDue,
    },
  });
  await tx.$executeRaw`SELECT set_config('app.transition_id', '', true)`;

  const lineIds = priced.map(() => uuidv7());
  await tx.bookingLine.createMany({
    data: priced.map((row, index) => ({
      id: lineIds[index] ?? '',
      ...keys,
      lineNo: row.lineNo,
      scopeLineId: row.line.id,
      scopeLineVersionId: row.line.versionId,
      priceItemId: row.line.priceItemId ?? '',
      snapshot: {
        discipline: row.line.parameter.discipline,
        product: row.line.parameter.product,
        parameter: row.line.parameter.parameter,
      },
      unitPricePaise: row.price,
      samplePrepPaise: 0n,
      gstRateBp,
      gstPaise: row.gst,
      lineTotalPaise: row.total,
    })),
  });
  await tx.trf.create({
    data: {
      id: uuidv7(),
      ...keys,
      versionNo: 1,
      schemaVersion: 'trf.v1',
      form: { itemName: options.itemName ?? 'DEMO sample', batchNo: 'DEMO-BATCH-1' },
      conformityRequired: false,
      submittedByUserId: requester,
    },
  });
  await tx.bookingStatusHistory.create({
    data: {
      id: uuidv7(),
      ...keys,
      transitionId: 'T-01',
      fromStatus: null,
      toStatus: 'REQUESTED',
      actorParty: 'CUSTOMER',
      actorUserId: requester,
      actorRole: customer.requester ? 'CUSTOMER_REQUESTER' : 'CUSTOMER_ADMIN',
    },
  });
  if (slotId) {
    // BR-010: a soft hold for the decision window plus four hours.
    await tx.slotHold.create({
      data: {
        id: uuidv7(),
        ...keys,
        slotId,
        kind: 'SOFT',
        expiresAt: new Date(decisionDue.getTime() + 4 * 3_600_000),
      },
    });
    await tx.slot.update({ where: { id: slotId }, data: { heldCount: { increment: 1 } } });
  }

  const booking: BookingFixture = {
    id,
    bookingNo,
    status: 'REQUESTED',
    customerOrgId: customer.organisationId,
    labOrgId: lab.organisationId,
    labSiteId: site.id,
    totalPaise,
    lineIds,
    packageIds: [],
    ...(slotId ? { slotId } : {}),
  };
  const walk: Walk = {
    tx,
    options,
    booking,
    keys,
    maker,
    checker,
    customerUser: customer.admin,
    now,
  };
  for (const step of ROUTES[state]) await step(walk);
  return booking;
}
