import type { Prisma } from '@labconnect/database';

/** The contact a lab site gives its customers (`ContactPerson`). */
export interface LabSiteContactView {
  name: string | null;
  phone: string | null;
  email: string | null;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

/**
 * The contact a lab site set for its customers (`lab_site_private.public_contact`), or `null`
 * when it set none. `lab_site_private` is visible to the lab only (RLS), so the caller runs this
 * under a system scope, and only after deciding that the reader may see it (the customer of a
 * paid booking).
 */
export async function labSitePublicContact(
  tx: Prisma.TransactionClient,
  labSiteId: string,
): Promise<LabSiteContactView | null> {
  const found = await tx.labSitePrivate.findFirst({
    where: { labSiteId },
    select: { publicContact: true },
  });
  const stored = found?.publicContact;
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return null;
  const record = stored as Record<string, unknown>;
  const contact = { name: text(record.name), phone: text(record.phone), email: text(record.email) };
  return contact.name === null && contact.phone === null && contact.email === null ? null : contact;
}
