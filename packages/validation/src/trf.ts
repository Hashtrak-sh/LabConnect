import { z } from 'zod';

// The test request form (FR-BKG-02), version `trf.v1`. The contract (`BookingTrfInput`) leaves
// `form` open and names this package as its schema. Minimal for the MVP (decided 2026-11-29): the
// item is required; the rest is optional free text with length limits; unknown fields are refused,
// so a later version adds fields on purpose (`trf.v2`), never by accident.

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).optional();

/** `YYYY-MM-DD`, a real calendar date. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().startsWith(value),
    {
      message: 'A calendar date (YYYY-MM-DD).',
    },
  );

/** GSTIN: 2-digit state code, PAN, entity number, Z, check character (15 characters). */
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, { message: 'A 15-character GSTIN.' });

export const trfV1Schema = z
  .object({
    itemName: text(200),
    batchNo: optionalText(100),
    grade: optionalText(100),
    manufacturingDate: isoDate.optional(),
    sampleCondition: optionalText(500),
    specialInstructions: optionalText(2000),
    reportName: optionalText(200),
    reportAddress: optionalText(500),
    gstin: gstin.optional(),
  })
  .strict();

export type TrfV1 = z.infer<typeof trfV1Schema>;

/** The schema versions this build accepts. */
export const TRF_SCHEMAS = { 'trf.v1': trfV1Schema } as const;
export type TrfSchemaVersion = keyof typeof TRF_SCHEMAS;

export type TrfIssue = { path: string; message: string };

/**
 * Validates a form against its schema version. `path` is relative to the form (`itemName`), so
 * the caller prefixes it (`trf.form.itemName`). An unknown version is one issue on `schemaVersion`.
 */
export function validateTrfForm(
  schemaVersion: string,
  form: unknown,
): { ok: true; form: TrfV1 } | { ok: false; issues: TrfIssue[]; versionUnknown?: true } {
  if (!(schemaVersion in TRF_SCHEMAS)) {
    return {
      ok: false,
      versionUnknown: true,
      issues: [{ path: '', message: 'Unknown form version.' }],
    };
  }
  const result = TRF_SCHEMAS[schemaVersion as TrfSchemaVersion].safeParse(form);
  if (result.success) return { ok: true, form: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.code === 'unrecognized_keys' ? 'This field is not allowed.' : issue.message,
    })),
  };
}
