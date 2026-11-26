/**
 * The accreditation body's own page for a certificate, from
 * `accreditation_body.verification_url_template` (FR-DIS-06). The template syntax is not
 * documented (OQ-159): `{certificate_no}` or `{certificateNo}` is replaced by the URL-encoded
 * certificate number. A body without a template, or a template that is not a URL once filled
 * in, gives `null`.
 *
 * Lives in `labs` (it owns `accreditation`), so both the lab directory and search can use it
 * (MODULE_BOUNDARIES rule 5: nothing may import search).
 */
export function accreditationVerificationUrl(
  template: string | null,
  certificateNo: string,
): string | null {
  if (template === null) return null;
  const filled = template.replaceAll(/\{certificate_?[nN]o\}/g, encodeURIComponent(certificateNo));
  try {
    return new URL(filled).toString();
  } catch {
    return null;
  }
}
