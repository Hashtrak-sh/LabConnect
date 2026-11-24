# Brand guidelines: LabConnect under QCI branding

**Status:** ⚠️ **INCOMPLETE. Values must be extracted from the QCI Brand & Communication Guidelines PDF (OQ-19, task P0-08 / D-01).** Don't invent QCI colours, fonts or logo rules. Until they're filled in, designs use the neutral placeholder tokens in `DESIGN_SYSTEM.md` and are labelled "unbranded draft".

## 1. Source
| Item | Value |
|---|---|
| Governing document | *QCI's Brand & Communication Guidelines* (PDF supplied by the product owner) |
| Version and date | _to fill_ |
| Location | `reference/QCI_Brand_and_Communication_Guidelines.pdf` (or a private location: _to fill_) |
| Language | English (CD-20) |
| Status of use | Interim: QCI branding applies "for now" (Q6). The final owning entity is to be confirmed (OQ-12). |

## 2. Brand architecture (questions to answer from the PDF and with QCI)
- [ ] How should a QCI-operated digital service be named and endorsed? ("LabConnect", "LabConnect by QCI", "A QCI initiative", or similar)
- [ ] Is co-branding with **NABL** (a QCI constituent board) permitted on the platform? Under what rules? (Note: NABL accreditation marks on reports belong to the labs and are governed by NABL policy. The platform must not alter reports.)
- [ ] Are Government of India emblem or ministry marks required or forbidden?
- [ ] Is a separate LabConnect product logo allowed, or must the QCI lockup be used?

## 3. Logo usage (fill from the PDF)
| Rule | Value |
|---|---|
| Primary logo files | _to fill_ |
| Clear space | _to fill_ |
| Minimum size (digital) | _to fill_ |
| Allowed backgrounds | _to fill_ |
| Don'ts | _to fill_ |
| Favicon / app icon | _to fill_ |

## 4. Colour (fill from the PDF, then map to semantic tokens)
| QCI colour name | HEX | RGB | Usage per guidelines | Maps to token |
|---|---|---|---|---|
| _Primary_ | _to fill_ | | | `--color-brand-primary` |
| _Secondary_ | _to fill_ | | | `--color-brand-secondary` |
| _Accent_ | _to fill_ | | | `--color-brand-accent` |
| _Neutrals_ | _to fill_ | | | `--color-neutral-*` |

**Accessibility check required:** every text/background pair must meet WCAG 2.1 AA (4.5:1 body, 3:1 large text and UI components). If a QCI colour fails for text use, keep it for accents only and document the exception here.

Status colours (success, warning, danger, info) may need values outside the brand palette. Document how they harmonise with QCI colours.

## 5. Typography (fill from the PDF)
| Role | QCI typeface | Web availability and licence | Fallback stack |
|---|---|---|---|
| Headings | _to fill_ | _to fill_ | _to fill_ |
| Body | _to fill_ | _to fill_ | `system-ui, "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif` |
| Numbers and tables | _to fill_ | | tabular figures required |

The fallback must include a font with Devanagari support (e.g. Noto Sans Devanagari) for the later Hindi UI.

## 6. Voice and tone (to align with the PDF's communication section)
Interim principles, consistent with government communication:
- **Clear and plain:** short sentences, active voice, no jargon without explanation (TRF, ULR and NABL get a tooltip the first time).
- **Neutral and trustworthy:** factual, never promotional about any lab. LabConnect doesn't rank labs as "best".
- **Respectful and helpful:** tell people what happened and what to do next.
- **Consistent terminology:** use `01-product/GLOSSARY.md` terms exactly.
- Indian English spelling (organisation, authorise), Indian number formatting, IST times with "IST" shown.

## 7. Imagery and iconography (fill from the PDF)
Photography and illustration style: _to fill_. Icons: a single open-source outline set (e.g. Lucide, already used with shadcn/ui) unless QCI specifies otherwise.

## 8. Required footer and legal elements (to confirm)
Operating entity name, grievance officer, privacy policy, terms of use, accessibility statement, "Last updated" date (GIGW, if applicable, OQ-13).
