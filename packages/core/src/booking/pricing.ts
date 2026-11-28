import { Prisma } from '@labconnect/database';
import { bookablePriceList } from '../labs/public-directory.js';
import { accreditationVerificationUrl } from '../labs/accreditation-url.js';
import { istDateKey } from '../platform/business-calendar.js';
import type { CoreErrorIssue } from '../platform/errors.js';
import type { BookingLineSnapshotView } from './detail.js';
import { BookingError } from './errors.js';

// Pricing a booking (FR-BKG-05, BR-001, BR-003, BR-019, BR-020): the site's effective published
// price list, each chosen scope line checked to be bookable, and the frozen line snapshot that
// T-01 and T-02 write. Lab reference data (sites, scope, accreditations) and published price lists
// are readable by any caller, so this runs inside the customer's own transaction.

/** GST on one line: round half up of taxable × rate / 10000 (PAYMENTS_AND_LEDGER §1). */
export function lineGstPaise(taxablePaise: bigint, rateBp: number): bigint {
  return (taxablePaise * BigInt(rateBp) + 5000n) / 10_000n;
}

export interface PricedLine {
  lineNo: number;
  scopeLineId: string;
  scopeLineVersionId: string;
  priceItemId: string;
  snapshot: BookingLineSnapshotView;
  unitPricePaise: bigint;
  samplePrepPaise: bigint;
  gstRateBp: number;
  gstPaise: bigint;
  lineTotalPaise: bigint;
  accreditationId: string;
}

export interface PricedBooking {
  labSiteId: string;
  labOrgId: string;
  priceList: { id: string; versionNo: number; effectiveFrom: Date };
  lines: PricedLine[];
  subtotalPaise: bigint;
  gstPaise: bigint;
  totalPaise: bigint;
}

interface LineRow {
  id: string;
  lab_site_id: string;
  usable: boolean;
  accreditation_id: string;
  version_id: string | null;
  price_item_id: string | null;
  price_paise: bigint | null;
  sample_prep_paise: bigint | null;
  gst_rate_bp: number | null;
  sample_qty: string | null;
  packaging_instructions: string | null;
  tat_days: number | null;
  is_available: boolean | null;
  discipline_code: string;
  discipline_name: string;
  group_code: string | null;
  group_name: string | null;
  product_code: string | null;
  product_name: string | null;
  parameter_code: string;
  parameter_name: string;
  method_code: string | null;
  method_name: string | null;
  method_text: string | null;
  range_text: string | null;
  site_type: BookingLineSnapshotView['siteType'];
  unit_code: string | null;
  unit_name: string | null;
}

const node = (code: string | null, name: string | null) =>
  code === null ? null : { code, name: name ?? code };

/**
 * Prices `scopeLineIds` (in that order) at `labSiteId` with the price list in effect `now`.
 * Refuses an unknown site (422 VALIDATION_FAILED), a site that cannot take bookings (422
 * SITE_NOT_BOOKABLE, with no `meta.reasons`: they are the lab's private data), and any line that
 * is not active on this site, under an accreditation in force, and priced and available in the
 * list (422 SCOPE_LINE_NOT_BOOKABLE, one issue per line at `lines[i].scopeLineId`).
 */
export async function priceBooking(
  tx: Prisma.TransactionClient,
  labSiteId: string,
  scopeLineIds: readonly string[],
  now: Date,
): Promise<PricedBooking> {
  const today = istDateKey(now);
  const sites = await tx.$queryRaw<{ organisation_id: string }[]>(
    Prisma.sql`SELECT organisation_id::text AS organisation_id FROM lab_site
                WHERE id = ${labSiteId}::uuid AND status = 'ACTIVE'`,
  );
  const site = sites[0];
  if (site === undefined) {
    throw new BookingError('VALIDATION_FAILED', {
      detail: 'Some fields are missing or not valid.',
      errors: [{ path: 'labSiteId', code: 'INVALID_VALUE', message: 'A listed lab site.' }],
    });
  }
  const list = await bookablePriceList(tx, labSiteId, now, today);
  if (list === null) {
    throw new BookingError('SITE_NOT_BOOKABLE', {
      detail: 'This lab site cannot take bookings at the moment.',
    });
  }
  const rows = await tx.$queryRaw<LineRow[]>(Prisma.sql`
    SELECT sl.id::text AS id, sl.lab_site_id::text AS lab_site_id,
           (sl.status = 'ACTIVE' AND NOT sl.temporarily_unavailable
            AND (sl.effective_from IS NULL OR sl.effective_from <= ${today}::date)
            AND (sl.effective_to IS NULL OR sl.effective_to >= ${today}::date)
            AND a.status = 'VALID' AND a.lab_category = 'TESTING'
            AND a.valid_from <= ${today}::date AND a.valid_to >= ${today}::date) AS usable,
           a.id::text AS accreditation_id, v.id::text AS version_id,
           pi.id::text AS price_item_id, pi.price_paise, pi.sample_prep_paise, pi.gst_rate_bp,
           pi.sample_qty::text AS sample_qty, pi.packaging_instructions, pi.tat_days,
           pi.is_available,
           d.code AS discipline_code, d.name AS discipline_name,
           g.code AS group_code, g.name AS group_name, p.code AS product_code,
           p.name AS product_name, prm.code AS parameter_code, prm.name AS parameter_name,
           m.code AS method_code, m.name AS method_name, sl.method_text, sl.range_text,
           sl.site_type, un.code AS unit_code, un.name AS unit_name
      FROM scope_line sl
      JOIN accreditation a ON a.id = sl.accreditation_id
      JOIN md_node d ON d.id = sl.discipline_node_id
      JOIN md_node prm ON prm.id = sl.parameter_node_id
      LEFT JOIN md_node g ON g.id = sl.group_node_id
      LEFT JOIN md_node p ON p.id = sl.product_node_id
      LEFT JOIN md_node m ON m.id = sl.method_node_id
      LEFT JOIN scope_line_version v
             ON v.scope_line_id = sl.id AND v.version_no = sl.current_version_no
      LEFT JOIN price_item pi ON pi.scope_line_id = sl.id AND pi.price_list_id = ${list.id}::uuid
      LEFT JOIN md_node un ON un.id = pi.sample_unit_node_id
     WHERE sl.id = ANY(${[...scopeLineIds]}::uuid[])`);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const issues: CoreErrorIssue[] = [];
  const lines: PricedLine[] = [];
  scopeLineIds.forEach((scopeLineId, index) => {
    const row = byId.get(scopeLineId.toLowerCase());
    const bookable =
      row !== undefined &&
      row.lab_site_id === labSiteId.toLowerCase() &&
      row.usable &&
      row.version_id !== null &&
      row.price_item_id !== null &&
      row.is_available === true &&
      row.unit_code !== null;
    if (!bookable) {
      issues.push({
        path: `lines[${String(index)}].scopeLineId`,
        code: 'NOT_BOOKABLE',
        message: 'This test cannot be booked at this site now.',
      });
      return;
    }
    const unitPricePaise = row.price_paise ?? 0n;
    const samplePrepPaise = row.sample_prep_paise ?? 0n;
    const gstRateBp = row.gst_rate_bp ?? 0;
    const gstPaise = lineGstPaise(unitPricePaise + samplePrepPaise, gstRateBp);
    lines.push({
      lineNo: index + 1,
      scopeLineId: row.id,
      scopeLineVersionId: row.version_id ?? '',
      priceItemId: row.price_item_id ?? '',
      accreditationId: row.accreditation_id,
      snapshot: {
        discipline: { code: row.discipline_code, name: row.discipline_name },
        group: node(row.group_code, row.group_name),
        product: node(row.product_code, row.product_name),
        parameter: { code: row.parameter_code, name: row.parameter_name },
        method: node(row.method_code, row.method_name),
        methodText: row.method_text,
        rangeText: row.range_text,
        siteType: row.site_type,
        sampleQty: Number(row.sample_qty ?? '0'),
        sampleUnit: { code: row.unit_code ?? '', name: row.unit_name ?? row.unit_code ?? '' },
        packagingInstructions: row.packaging_instructions,
        tatDays: row.tat_days ?? 1,
      },
      unitPricePaise,
      samplePrepPaise,
      gstRateBp,
      gstPaise,
      lineTotalPaise: unitPricePaise + samplePrepPaise + gstPaise,
    });
  });
  if (issues.length > 0) {
    throw new BookingError('SCOPE_LINE_NOT_BOOKABLE', {
      detail: 'Some tests cannot be booked at this site now.',
      errors: issues,
    });
  }
  const subtotalPaise = lines.reduce(
    (sum, line) => sum + line.unitPricePaise + line.samplePrepPaise,
    0n,
  );
  const gstPaise = lines.reduce((sum, line) => sum + line.gstPaise, 0n);
  return {
    labSiteId: labSiteId.toLowerCase(),
    labOrgId: site.organisation_id,
    priceList: { id: list.id, versionNo: list.version_no, effectiveFrom: list.effective_from },
    lines,
    subtotalPaise,
    gstPaise,
    totalPaise: subtotalPaise + gstPaise,
  };
}

/**
 * `booking.lab_snapshot` (CD-39): the site's name and address and the accreditation the booked
 * scope is under, as they are now, in the shape `BookingLabSnapshot` reads back.
 */
export async function labSnapshotOf(
  tx: Prisma.TransactionClient,
  labSiteId: string,
  accreditationId: string,
): Promise<Prisma.InputJsonObject> {
  const rows = await tx.$queryRaw<
    {
      site_name: string;
      address: Prisma.JsonValue;
      state_code: string;
      pincode: string;
      certificate_no: string;
      body_code: string;
      body_name: string;
      verification_url_template: string | null;
      standard_code: string;
      standard_name: string;
      lab_category: string;
      valid_from: string;
      valid_to: string;
      status: string;
      status_as_of: string;
    }[]
  >(Prisma.sql`
    SELECT s.name AS site_name, s.address, s.state_code, s.pincode,
           a.certificate_no, ab.code AS body_code, ab.name AS body_name,
           ab.verification_url_template, st.code AS standard_code, st.name AS standard_name,
           a.lab_category::text AS lab_category, a.valid_from::text AS valid_from,
           a.valid_to::text AS valid_to, a.status::text AS status,
           a.status_as_of::text AS status_as_of
      FROM lab_site s
      JOIN accreditation a ON a.id = ${accreditationId}::uuid AND a.lab_site_id = s.id
      JOIN accreditation_body ab ON ab.id = a.accreditation_body_id
      JOIN accreditation_standard st ON st.id = a.standard_id
     WHERE s.id = ${labSiteId}::uuid`);
  const row = rows[0];
  if (row === undefined) throw new Error('The booked site or accreditation is gone.');
  const stored =
    typeof row.address === 'object' && row.address !== null && !Array.isArray(row.address)
      ? (row.address as Record<string, unknown>)
      : {};
  const textOr = (value: unknown, fallback: string | null) =>
    typeof value === 'string' && value.trim() !== '' ? value : fallback;
  const verificationUrl = accreditationVerificationUrl(
    row.verification_url_template,
    row.certificate_no,
  );
  return {
    siteName: row.site_name,
    address: {
      line1: textOr(stored.line1, row.site_name),
      line2: textOr(stored.line2, null),
      city: textOr(stored.city, row.site_name),
      district: textOr(stored.district, null),
      stateCode: row.state_code,
      pincode: row.pincode,
    },
    accreditation: {
      certificateNo: row.certificate_no,
      accreditationBody: { code: row.body_code, name: row.body_name },
      standard: { code: row.standard_code, name: row.standard_name },
      labCategory: row.lab_category,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      status: row.status,
      statusAsOf: row.status_as_of,
      verificationUrl,
    },
  };
}
