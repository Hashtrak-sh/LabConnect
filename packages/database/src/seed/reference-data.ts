// Reference data for `seed:reference` (docs/03-database/MIGRATION_AND_SEED_STRATEGY.md section 3).
// Plain data, no database access. Everything here is a starting value that an
// administrator can change afterwards; the seed never overwrites a row that exists.

// ---------------------------------------------------------------- taxonomies

export interface TaxonomySeed {
  code: string;
  name: string;
  hierarchical: boolean;
  /** Levels, top first. A flat taxonomy has the single level VALUE. */
  levels: { code: string; name: string }[];
  /** Starter values for flat taxonomies. SCOPE and METHOD values come from imports. */
  nodes: { code: string; name: string }[];
}

const flat = (code: string, name: string, nodes: [string, string][] = []): TaxonomySeed => ({
  code,
  name,
  hierarchical: false,
  levels: [{ code: 'VALUE', name: 'Value' }],
  nodes: nodes.map(([nodeCode, nodeName]) => ({ code: nodeCode, name: nodeName })),
});

/** MASTER_DATA_MANAGEMENT.md section 2. The starter values of the reason lists are a proposal (OQ-31). */
export const TAXONOMIES: TaxonomySeed[] = [
  {
    code: 'SCOPE',
    name: 'Scope of accreditation',
    hierarchical: true,
    levels: [
      { code: 'DISCIPLINE', name: 'Discipline' },
      { code: 'GROUP', name: 'Group' },
      { code: 'PRODUCT', name: 'Product' },
      { code: 'PARAMETER', name: 'Parameter' },
    ],
    nodes: [],
  },
  flat('METHOD', 'Test method'),
  flat('UNIT', 'Unit', [
    ['KG', 'Kilogram'],
    ['G', 'Gram'],
    ['MG', 'Milligram'],
    ['L', 'Litre'],
    ['ML', 'Millilitre'],
    ['M', 'Metre'],
    ['MM', 'Millimetre'],
    ['PIECE', 'Piece'],
  ]),
  flat('SAMPLE_CONDITION', 'Sample condition on receipt', [
    ['INTACT', 'Intact'],
    ['DAMAGED_PACKAGING', 'Packaging damaged'],
    ['SEAL_BROKEN', 'Seal broken'],
    ['LEAKING', 'Leaking'],
    ['CONTAMINATED', 'Contaminated'],
  ]),
  flat('REJECTION_REASON', 'Reason a lab rejects a booking request', [
    ['NO_CAPACITY', 'No capacity'],
    ['OUT_OF_SCOPE', 'Outside the scope of accreditation'],
    ['EQUIPMENT_UNAVAILABLE', 'Equipment unavailable'],
    ['INSUFFICIENT_INFORMATION', 'Insufficient information in the request'],
    ['OTHER', 'Other'],
  ]),
  flat('CANCELLATION_REASON', 'Reason a booking is cancelled', [
    ['CUSTOMER_REQUEST', 'Cancelled by the customer'],
    ['LAB_UNABLE_TO_TEST', 'Lab unable to test'],
    ['ACCREDITATION_LAPSED', 'Accreditation lapsed'],
    ['SAMPLE_UNFIT', 'Sample unfit for testing'],
    ['HOLD_NOT_RESOLVED', 'Receipt hold not resolved'],
    ['OTHER', 'Other'],
  ]),
  flat('HOLD_REASON', 'Reason a receipt is put on hold', [
    ['INSUFFICIENT_QUANTITY', 'Insufficient quantity'],
    ['PACKAGE_MISSING', 'Package missing'],
    ['ITEM_MISMATCH', 'Item does not match the booking'],
    ['BATCH_MISMATCH', 'Batch does not match the booking'],
    ['DAMAGED', 'Sample damaged'],
    ['SEAL_BROKEN', 'Seal broken'],
  ]),
  flat('DISPUTE_TYPE', 'Type of dispute', [
    ['RESULT_QUERY', 'Query about a result'],
    ['REPORT_ERROR', 'Error in the report'],
    ['DELAY', 'Delay'],
    ['SAMPLE_HANDLING', 'Sample handling'],
    ['BILLING', 'Billing'],
  ]),
  flat('REFUND_REASON', 'Reason for a refund', [
    ['CANCELLATION', 'Cancellation by the customer'],
    ['LAB_CANCELLATION', 'Cancellation by the lab'],
    ['NO_SHOW', 'Sample not dropped'],
    ['SAMPLE_UNFIT', 'Sample unfit for testing'],
    ['DUPLICATE_PAYMENT', 'Duplicate payment'],
    ['LATE_PAYMENT', 'Payment received after the payment window'],
    ['DISPUTE_DECISION', 'Dispute decision'],
  ]),
  flat('KYC_DOCUMENT_TYPE', 'KYC document type', [
    ['GST_CERTIFICATE', 'GST registration certificate'],
    ['PAN_CARD', 'PAN card'],
    ['CANCELLED_CHEQUE', 'Cancelled cheque'],
    ['AUTHORISATION_LETTER', 'Authorisation letter'],
    ['ACCREDITATION_CERTIFICATE', 'Accreditation certificate'],
  ]),
];

// ---------------------------------------------------------------- accreditation

export const ACCREDITATION_BODIES = [
  { code: 'NABL', name: 'National Accreditation Board for Testing and Calibration Laboratories' },
];

/** CD-03: medical labs are not supported. Only testing is bookable in the MVP. */
export const ACCREDITATION_STANDARDS = [
  {
    code: 'ISO_IEC_17025_TESTING',
    name: 'ISO/IEC 17025 (testing)',
    labCategory: 'TESTING',
    isSupported: true,
    isBookable: true,
  },
  {
    code: 'ISO_IEC_17025_CALIBRATION',
    name: 'ISO/IEC 17025 (calibration)',
    labCategory: 'CALIBRATION',
    isSupported: true,
    isBookable: false,
  },
  {
    code: 'ISO_15189',
    name: 'ISO 15189 (medical)',
    labCategory: 'MEDICAL',
    isSupported: false,
    isBookable: false,
  },
] as const;

// ---------------------------------------------------------------- ledger and fees

/**
 * SCHEMA_SPECIFICATION.md section 10.8. These are the platform-wide accounts; accounts
 * per party (LAB_PAYABLE of one lab) are created when first used. The normal balances
 * are a proposal for Finance (OQ-08).
 */
export const LEDGER_ACCOUNTS = [
  { code: 'GATEWAY_CLEARING', normalBalance: 'DEBIT' },
  { code: 'CUSTOMER_PREPAYMENT', normalBalance: 'CREDIT' },
  { code: 'LAB_PAYABLE', normalBalance: 'CREDIT' },
  { code: 'REFUND_PAYABLE', normalBalance: 'CREDIT' },
  { code: 'GST_PAYABLE_ON_BEHALF', normalBalance: 'CREDIT' },
  { code: 'PLATFORM_FEE_REVENUE', normalBalance: 'CREDIT' },
  { code: 'CANCELLATION_FEE_PAYABLE_LAB', normalBalance: 'CREDIT' },
  { code: 'PAYOUT_CLEARING', normalBalance: 'CREDIT' },
  { code: 'SUSPENSE', normalBalance: 'CREDIT' },
] as const;

/** Rows are identified by fee type; all are GLOBAL and start at this instant. */
export const REFERENCE_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00.000Z');

/**
 * Platform fee 0 (CD-05), cancellation 10% (BR-071), no-show 10% (BR-072).
 * The whole fee goes to the lab, because the platform takes no revenue in the MVP.
 * The split is a policy item (OQ-07). The handling fee (BR-076) has no default yet.
 */
export const FEE_RULES = [
  { feeType: 'PLATFORM_FEE', calc: 'PERCENT_BP', value: 0n, labShareBp: 0 },
  { feeType: 'CANCELLATION_FEE', calc: 'PERCENT_BP', value: 1000n, labShareBp: 10_000 },
  { feeType: 'NO_SHOW_FEE', calc: 'PERCENT_BP', value: 1000n, labShareBp: 10_000 },
] as const;

// ---------------------------------------------------------------- configuration

export interface ConfigDefault {
  key: string;
  value: number | boolean;
  /** The business rule or document the default comes from. */
  source: string;
}

/**
 * Defaults from docs/01-product/BUSINESS_RULES.md. The key names are new: the documents
 * name only `booking.lab_decision_sla_business_minutes`, `refund.approval_threshold_paise`
 * and `feature.platform_fee_enabled`. Durations follow the first one and are in minutes
 * unless the name says otherwise.
 *
 * Not seeded: `refund.approval_threshold_paise` (no default is documented) and the
 * per-lab values (drop allowance BR-040, retention BR-049).
 */
export const CONFIG_DEFAULTS: ConfigDefault[] = [
  { key: 'booking.lab_decision_sla_business_minutes', value: 240, source: 'BR-012' },
  { key: 'booking.lab_decision_grace_minutes', value: 240, source: 'BR-014' },
  { key: 'booking.slot_hold_extra_minutes', value: 240, source: 'BR-010' },
  { key: 'booking.max_open_requests_per_customer', value: 10, source: 'BR-015' },
  { key: 'booking.duplicate_warning_days', value: 7, source: 'BR-016' },
  { key: 'booking.counter_response_minutes', value: 1440, source: 'BR-018' },
  { key: 'booking.attachments_max_total_bytes', value: 25 * 1024 * 1024, source: 'BR-021' },
  { key: 'payment.window_minutes', value: 1440, source: 'BR-030' },
  { key: 'payment.reminder_before_minutes', value: 120, source: 'BR-031' },
  { key: 'payment.reconcile_interval_minutes', value: 5, source: 'BR-032' },
  { key: 'payment.reconcile_max_minutes', value: 120, source: 'BR-032' },
  { key: 'handover.no_show_grace_minutes', value: 2880, source: 'BR-041' },
  { key: 'handover.missing_package_wait_minutes', value: 2880, source: 'BR-045' },
  { key: 'handover.hold_decision_minutes', value: 1440, source: 'BR-046' },
  { key: 'lab.approval_sla_business_days', value: 1, source: 'BR-048' },
  { key: 'report.max_file_bytes', value: 20 * 1024 * 1024, source: 'BR-060' },
  { key: 'report.publish_mfa_max_age_seconds', value: 300, source: 'BR-064' },
  { key: 'report.share_link_default_days', value: 7, source: 'BR-066' },
  { key: 'report.share_link_max_days', value: 30, source: 'BR-066' },
  { key: 'report.download_url_ttl_seconds', value: 900, source: 'BR-066' },
  { key: 'dispute.window_minutes', value: 4320, source: 'BR-077, BR-080' },
  { key: 'dispute.lab_response_sla_business_days', value: 2, source: 'BR-081' },
  { key: 'feature.platform_fee_enabled', value: false, source: 'CD-05' },
];

// ---------------------------------------------------------------- holidays

/**
 * The national holidays that fall on the same date every year. The other gazetted
 * holidays (Holi, Eid, Diwali, Good Friday and so on) move each year with lunar or
 * religious calendars and are notified officially. They are not entered from memory and
 * must come from the official list (OQ-32).
 */
export const FIXED_NATIONAL_HOLIDAYS = [
  { month: 1, day: 26, name: 'Republic Day' },
  { month: 8, day: 15, name: 'Independence Day' },
  { month: 10, day: 2, name: 'Mahatma Gandhi Jayanti' },
  { month: 12, day: 25, name: 'Christmas Day' },
];

// ---------------------------------------------------------------- QR signing keys

export const QR_KEYS = [
  { purpose: 'BOOKING', keyId: 'b1', env: 'QR_KMS_KEY_ARN_BOOKING' },
  { purpose: 'PACKAGE', keyId: 'p1', env: 'QR_KMS_KEY_ARN_PACKAGE' },
  { purpose: 'REPORT', keyId: 'r1', env: 'QR_KMS_KEY_ARN_REPORT' },
] as const;

/** Used only when APP_ENV is local or test. It is not a real key. */
export const LOCAL_KMS_KEY_ARN = 'arn:aws:kms:ap-south-1:000000000000:key/local-not-a-real-key';

// ---------------------------------------------------------------- notification templates

export interface TemplateSeed {
  eventCode: string;
  /** MVP channels from docs/01-product/NOTIFICATIONS_MATRIX.md. */
  channels: ('EMAIL' | 'IN_APP')[];
  subject: string;
  body: string;
}

const EI: TemplateSeed['channels'] = ['EMAIL', 'IN_APP'];
const t = (
  eventCode: string,
  channels: TemplateSeed['channels'],
  subject: string,
  body: string,
): TemplateSeed => ({ eventCode, channels, subject, body });

/**
 * Version 1 of every template, en-IN. One template serves every recipient of an event,
 * so the wording does not assume a role. Variables: bookingNo, labName, deadline,
 * actionUrl, reason, otp, organisationName. The wording and the email footer need
 * review against the QCI communication guidelines (OQ-19).
 */
export const NOTIFICATION_TEMPLATES: TemplateSeed[] = [
  t(
    'booking.requested',
    EI,
    'Booking {{bookingNo}} requested',
    'Booking {{bookingNo}} was requested at {{labName}}. The lab decides by {{deadline}}. {{actionUrl}}',
  ),
  t(
    'booking.sla_reminder',
    EI,
    'Booking {{bookingNo}} is waiting for a decision',
    'Booking {{bookingNo}} needs a decision by {{deadline}}. {{actionUrl}}',
  ),
  t(
    'booking.accepted',
    EI,
    'Booking {{bookingNo}} accepted',
    '{{labName}} accepted booking {{bookingNo}}. Payment is due by {{deadline}}. {{actionUrl}}',
  ),
  t(
    'booking.rejected',
    EI,
    'Booking {{bookingNo}} was not accepted',
    '{{labName}} did not accept booking {{bookingNo}}. Reason: {{reason}}. {{actionUrl}}',
  ),
  t(
    'booking.expired',
    EI,
    'Booking {{bookingNo}} expired',
    'Booking {{bookingNo}} expired because no decision was made in time. {{actionUrl}}',
  ),
  t(
    'booking.countered',
    EI,
    'Booking {{bookingNo}}: the lab proposed a change',
    '{{labName}} proposed a change to booking {{bookingNo}}. Please respond by {{deadline}}. {{actionUrl}}',
  ),
  t(
    'booking.counter_response',
    EI,
    'Booking {{bookingNo}}: response to the proposed change',
    'The customer responded to the change proposed for booking {{bookingNo}}. {{actionUrl}}',
  ),
  t(
    'payment.window_ending',
    EI,
    'Booking {{bookingNo}}: payment is due soon',
    'Payment for booking {{bookingNo}} is due by {{deadline}}. {{actionUrl}}',
  ),
  t(
    'payment.succeeded',
    EI,
    'Booking {{bookingNo}}: payment received',
    'Payment for booking {{bookingNo}} was received. The sample is due at {{labName}} by {{deadline}}. {{actionUrl}}',
  ),
  t(
    'payment.expired',
    EI,
    'Booking {{bookingNo}}: payment window ended',
    'Booking {{bookingNo}} was closed because payment was not received in time. {{actionUrl}}',
  ),
  t(
    'handover.deadline_approaching',
    EI,
    'Booking {{bookingNo}}: drop the sample by {{deadline}}',
    'The sample for booking {{bookingNo}} is due at {{labName}} by {{deadline}}. {{actionUrl}}',
  ),
  t(
    'handover.overdue',
    EI,
    'Booking {{bookingNo}}: the sample is overdue',
    'The sample for booking {{bookingNo}} has not reached {{labName}}. {{actionUrl}}',
  ),
  t(
    'booking.no_show',
    EI,
    'Booking {{bookingNo}} closed: sample not received',
    'Booking {{bookingNo}} was closed because the sample was not dropped in time. {{actionUrl}}',
  ),
  t(
    'receipt.recorded',
    EI,
    'Booking {{bookingNo}}: sample receipt recorded',
    'The receipt of the sample for booking {{bookingNo}} was recorded and is waiting for approval. {{actionUrl}}',
  ),
  t(
    'receipt.approved',
    EI,
    'Booking {{bookingNo}}: sample received',
    '{{labName}} received the sample for booking {{bookingNo}}. {{actionUrl}}',
  ),
  t(
    'receipt.on_hold',
    EI,
    'Booking {{bookingNo}} is on hold',
    'The sample for booking {{bookingNo}} is on hold. Reason: {{reason}}. A decision is needed by {{deadline}}. {{actionUrl}}',
  ),
  t(
    'hold.reminder',
    EI,
    'Booking {{bookingNo}}: a decision is still needed',
    'Booking {{bookingNo}} is on hold and needs a decision by {{deadline}}. {{actionUrl}}',
  ),
  t(
    'hold.escalated',
    EI,
    'Booking {{bookingNo}}: hold escalated',
    'No decision was made on the hold for booking {{bookingNo}}. It has been passed to the support team. {{actionUrl}}',
  ),
  t(
    'approval.sla_reminder',
    EI,
    'Booking {{bookingNo}} is waiting for approval',
    'An approval for booking {{bookingNo}} is due by {{deadline}}. {{actionUrl}}',
  ),
  t(
    'testing.started',
    ['IN_APP'],
    'Booking {{bookingNo}}: testing started',
    'Testing started for booking {{bookingNo}}. {{actionUrl}}',
  ),
  t(
    'report.eta_revised',
    EI,
    'Booking {{bookingNo}}: new report date',
    'The report for booking {{bookingNo}} is now expected by {{deadline}}. Reason: {{reason}}. {{actionUrl}}',
  ),
  t(
    'report.submitted',
    EI,
    'Booking {{bookingNo}}: report waiting for approval',
    'A report for booking {{bookingNo}} is waiting for approval. {{actionUrl}}',
  ),
  t(
    'report.returned',
    EI,
    'Booking {{bookingNo}}: report returned for correction',
    'The report for booking {{bookingNo}} was returned for correction. {{actionUrl}}',
  ),
  t(
    'report.released',
    EI,
    'Booking {{bookingNo}}: report released',
    'The report for booking {{bookingNo}} is released. {{actionUrl}}',
  ),
  t(
    'report.amended',
    EI,
    'Booking {{bookingNo}}: amended report released',
    'An amended report for booking {{bookingNo}} is released. It replaces the earlier version. {{actionUrl}}',
  ),
  t(
    'label.reprint_requested',
    ['IN_APP'],
    'Booking {{bookingNo}}: label reprint requested',
    'A label reprint was requested for booking {{bookingNo}}. {{actionUrl}}',
  ),
  t(
    'booking.cancelled',
    EI,
    'Booking {{bookingNo}} cancelled',
    'Booking {{bookingNo}} was cancelled. Reason: {{reason}}. {{actionUrl}}',
  ),
  t(
    'refund.processed',
    EI,
    'Booking {{bookingNo}}: refund processed',
    'A refund for booking {{bookingNo}} was processed. {{actionUrl}}',
  ),
  t(
    'payout.released',
    ['EMAIL'],
    'Settlement advice',
    'A payout was released to {{organisationName}}. {{actionUrl}}',
  ),
  t(
    'dispute.opened',
    EI,
    'Booking {{bookingNo}}: dispute opened',
    'A dispute was opened on booking {{bookingNo}}. {{actionUrl}}',
  ),
  t(
    'dispute.updated',
    EI,
    'Booking {{bookingNo}}: dispute updated',
    'The dispute on booking {{bookingNo}} was updated. {{actionUrl}}',
  ),
  t(
    'dispute.decided',
    EI,
    'Booking {{bookingNo}}: dispute decided',
    'The dispute on booking {{bookingNo}} was decided. {{actionUrl}}',
  ),
  t(
    'accreditation.changed',
    EI,
    'Accreditation change at {{labName}}',
    'The accreditation of {{labName}} changed. Bookings that are affected are listed here: {{actionUrl}}',
  ),
  t(
    'lab.became_bookable',
    ['EMAIL'],
    '{{labName}} can now be booked',
    '{{labName}}, which you asked about, can now be booked. {{actionUrl}}',
  ),
  t(
    'auth.otp',
    ['EMAIL'],
    'Your sign-in code',
    'Your sign-in code is {{otp}}. It is valid for 10 minutes. If you did not ask for it, ignore this message.',
  ),
  t(
    'user.invited',
    ['EMAIL'],
    'You are invited to {{organisationName}}',
    'You are invited to join {{organisationName}}. {{actionUrl}}',
  ),
];
