# Brand guidelines: LabConnect under QCI branding

**Status:** ⚠️ **PARTIAL.** Filled from the QCI Brand & Communication Guidelines PDF (task P0-08). The PDF is itself an early draft: it names the brand colours without giving any colour codes, leaves the clear-space and responsive-size measurements as placeholders, and doesn't cover web products. Every value the PDF doesn't state is marked **Not in PDF** below and stays open under OQ-19. Don't invent QCI colours, fonts or logo rules. Until the open items are answered by QCI, designs use the neutral placeholder tokens in `DESIGN_SYSTEM.md` and are labelled "unbranded draft".

Page references (p. N) are the page numbers printed in the PDF footer. The PDF's printed numbering is not continuous (it jumps from 2 to 10, 18 to 23 and 27 to 32); the file has 24 pages in total and all 24 were read.

## 1. Source
| Item | Value |
|---|---|
| Governing document | *Brand and Communication Guidelines*, Quality Council of India (PDF supplied by the product owner) |
| Version and date | **Version 1.0, May 2024** (cover page) |
| Maturity | Draft. Pages 34–36 say "The final versions of the placed designs will be shared in the second draft and are there for representational purposes only." Clear-space and responsive sizes on pp. 13–14 are unfilled ("00 px"). |
| Location | `reference/QCI_Brand_and_Communication_Guidelines.pdf`, kept **locally only** (excluded by `.gitignore`). Logo files are in `reference/` (see §3). |
| Language | English (CD-20) |
| Status of use | Interim: QCI branding applies "for now" (Q6). The final owning entity is to be confirmed (OQ-12). |

## 2. Brand architecture
What the PDF says:
- When QCI partners with internal or external entities, logos are placed left to right as **QCI logo | board or division logo | knowledge-partner logo**, separated by thin vertical rules (p. 15).
- When posting about a board, division or cell, the QCI logo "should be prominently displayed", and a uniform logo sequence is followed when several logos appear (p. 25).
- The standard footer sequence of QCI's boards and divisions is: NABCB, NABH, NABL, NABET, NBQP, then PADD, TCB, PPID, ZED, then ONDC ("co-founded and supported by QCI") (p. 15). The closing page also shows a Policy Unit mark.
- QCI describes itself as "An autonomous body, setup by Ministry of Commerce & Industry, Government of India" on letterheads and business cards (pp. 34–36).

Still open (the PDF doesn't answer these; they need a decision from QCI):
- [ ] How should a QCI-operated digital service be named and endorsed? ("LabConnect", "LabConnect by QCI", "A QCI initiative", or similar.) **Not in PDF.**
- [ ] Is co-branding with **NABL** permitted on the platform, and does the p. 15 placement rule (QCI | board | partner) apply to a product header? (Note: NABL accreditation marks on reports belong to the labs and are governed by NABL policy. The platform must not alter reports.) **Not in PDF** beyond the general placement rule.
- [ ] Are Government of India emblem or ministry marks required or forbidden? **Not in PDF.**
- [ ] Is a separate LabConnect product logo allowed, or must the QCI lockup be used? **Not in PDF.**
- [ ] Is the full boards-and-divisions footer strip expected on a web product? **Not in PDF** (shown only for letterheads, cards and the social footer).

## 3. Logo usage
| Rule | Value |
|---|---|
| Logo variants | **Standard logo**: Q symbol with "QCI", the Hindi and English name (भारतीय गुणवत्ता परिषद् / QUALITY COUNCIL OF INDIA, with ®) and the tagline "Creating an Ecosystem for Quality". **Logo bug**: the Q symbol with "QCI" only, the "condensed visual representation" of the brand (p. 11). |
| Preferred use | "Whenever possible, use the standard logo on a white or light background. This is the primary and preferred logo use." (p. 11) |
| Allowed backgrounds | Full colour on white or light backgrounds. If full colour can't be used: **100% black**, or **reversed (white)**. The white reversed logo is used on backgrounds where the full-colour logo doesn't give enough contrast (p. 11). |
| Primary logo files | `reference/Logos_QCI.png` (2747 × 995 px, transparent background) and `reference/Logos_QCI.jpg` (same lockup, white background, 300 dpi). Both are the full-colour standard logo. **Not supplied:** vector files (SVG/EPS), the logo bug on its own, the black version and the reversed version. Request these from QCI; don't redraw or trace them. |
| Clear space | Principle only: keep clear space around the Q symbol on every edge. The measurements in the PDF are unfilled placeholders ("00 px"), and the stated rule ("adding an additional pixel to each edge of the 'Q'") is not a usable value (p. 13). **Value not in PDF.** |
| Minimum size (digital) | **70 px** is shown for the logo bug (p. 13). No unit basis (width or height) is stated; the illustration is a square box. Minimum size for the standard logo: **Not in PDF.** |
| Responsive sizes | Four responsive sizes are illustrated, from the full standard logo down to the logo bug, but the pixel breakpoints are placeholders ("0000 px", "000 px", "00 px") (p. 14). **Values not in PDF.** |
| Avatar use | Logo bug on white for square and circular avatars (p. 13). Profile images use the logo on a white background, centred, **without the tagline** (p. 23). |
| Favicon / app icon | **Not in PDF.** By analogy with the avatar rule the logo bug would be the candidate, but this needs QCI confirmation. |

**Don'ts** (p. 12). "The QCI logo is our primary visual brand identifier. Do not alter it in any way."
- Don't change the logo's orientation or rotation.
- Don't scale it disproportionately.
- Don't change its colours, or use colour combinations that aren't specified.
- Don't display it in a configuration that isn't specified.
- Don't attempt to recreate the logo.
- Don't alter the logo's text.
- Don't add special effects.
- Don't add an outline, or display the logo as an outline.
- Don't place other elements inside the clear space.
- Don't crop the logo.
- Don't place it on unapproved background colours (the examples shown are red, purple, orange and violet panels).

## 4. Colour
What the PDF says:
- Primary colour: **"Q Blue"**. Secondary colour: **black** (p. 11).
- Blue stands for "trustworthiness, reliability & professionalism"; black for "sophistication & elegance" (p. 10).
- "Avoid any temptation to use colors not mentioned in our guidelines. Each color in our palette serves a purpose." (p. 12)
- For social posts: "Utilize QCI's brand colours whenever possible, or opt for light colors" (p. 25).

**The PDF contains no colour palette page and no HEX, RGB, CMYK or Pantone values.** The "palette" it refers to isn't in this version. The table therefore stays empty: values must come from QCI, not from sampling the logo image.

| QCI colour name | HEX | RGB | Usage per guidelines | Maps to token |
|---|---|---|---|---|
| Q Blue (primary) | **Not in PDF** | **Not in PDF** | Logo circle; primary brand colour | `--color-brand-primary` |
| Black (secondary) | **Not in PDF** | **Not in PDF** | Logo triangle and wordmark; secondary brand colour | `--color-brand-secondary` |
| Accent | **Not in PDF** (no accent colour is defined) | | | `--color-brand-accent` |
| Neutrals | **Not in PDF** | | | `--color-neutral-*` |

**Accessibility check required:** every text/background pair must meet WCAG 2.1 AA (4.5:1 body, 3:1 large text and UI components). This can't be run until official values exist. If a QCI colour fails for text use, keep it for accents only and document the exception here.

Status colours (success, warning, danger, info) may need values outside the brand palette. The PDF's "no unapproved colours" rule is written about the logo and its backgrounds; whether it restricts functional UI status colours needs QCI confirmation.

## 5. Typography
The PDF lists typefaces by use (pp. 16–17, 32). **None of them is designated for websites or web applications**, so the choice for LabConnect's UI is still open.

| Use per PDF | QCI typeface | Styles listed | Web availability and licence |
|---|---|---|---|
| Formal documentation (letters, reports, presentations): body copy | **Trebuchet MS** | Regular, Italic, Bold, Bold Italic | System font on Windows and macOS. Not on most Android or Linux devices, so a fallback is needed. |
| Formal documentation: body copy | **Calibri** | Light, Regular, Italic, Bold, Bold Italic | Microsoft proprietary. Not freely licensable as a web font. |
| Design collateral (social posts, banners): primary | **Bebas Neue** | Thin, Book, Regular, Bold | Open licence (SIL OFL). Capitals only, so unsuitable for body text. |
| Design collateral: secondary | **Montserrat** | Light to Black, with italics | Open licence (SIL OFL). Available as a web font. |
| Design collateral: additional | **Poppins** | Light to Black, with italics | Open licence (SIL OFL). Available as a web font. Includes Devanagari. |
| Design collateral: additional | **Helvetica Neue** | Thin to Bold, Condensed Bold/Black | Commercial licence required for web use. |
| Presentations | **Arial** "for all presentation communication" (p. 32) | | System font. |

Note: the introductory paragraph on p. 16 names "Operetta 12 and Poppins" as the selected serif and sans-serif pair, but Operetta 12 doesn't appear in the font lists that follow. The serif headline face used in the PDF's own section titles isn't named. Treat this as an inconsistency in the draft to raise with QCI.

| Role in LabConnect | Typeface | Fallback stack |
|---|---|---|
| Headings | **Open.** Not specified for web. Montserrat or Poppins are the open-licence candidates from QCI's own list; needs QCI confirmation. | _to fill after confirmation_ |
| Body | **Open.** Not specified for web. | `system-ui, "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif` |
| Numbers and tables | **Open.** Tabular figures are required whichever face is chosen. | |

The fallback must include a font with Devanagari support (e.g. Noto Sans Devanagari) for the later Hindi UI.

## 6. Voice and tone
What the PDF says (written for social media, p. 25, but the only tone guidance it contains):
- "Avoid verbosity. Keep the text crisp, to the point, and self-explanatory."
- "Informational content should have a basic theme and primarily focus on text."

The PDF has no dedicated voice-and-tone section. The interim principles below stay in force and are consistent with the two points above:
- **Clear and plain:** short sentences, active voice, no jargon without explanation (TRF, ULR and NABL get a tooltip the first time).
- **Neutral and trustworthy:** factual, never promotional about any lab. LabConnect doesn't rank labs as "best".
- **Respectful and helpful:** tell people what happened and what to do next.
- **Consistent terminology:** use `01-product/GLOSSARY.md` terms exactly.
- Indian English spelling (organisation, authorise), Indian number formatting, IST times with "IST" shown.

## 7. Imagery and iconography
- **Icons (p. 18):** QCI has a custom icon set, described as "geometric and concise", drawn as thin outlines and featuring "the signature 45 degree angle present in our logo". It is grouped as Enterprise, World, People and Industry, and can be shown in black outline or in white on a Q Blue circle. New icons and usage questions go to QCI's design team (contact given on p. 18 of the PDF).
- The icon files themselves were **not supplied**, and the set shown doesn't cover the UI actions LabConnect needs. Interim: a single open-source outline set (e.g. Lucide, already used with shadcn/ui), which is visually close to QCI's outline style. Whether QCI's own set must be used is open.
- **Photography and illustration:** no rules are stated. The only related guidance is that images of QCI leaders or speakers must be high resolution (p. 27). **Style not in PDF.**

## 8. Required footer and legal elements (to confirm)
From the PDF's print templates (pp. 34–36), which may or may not carry over to a web product:
- The descriptor "An autonomous body, setup by Ministry of Commerce & Industry, Government of India" appears next to the QCI logo.
- The footer carries the "QCI's Boards and Divisions" logo strip (§2), then the office address, phone, email and website.

Still to confirm for LabConnect: operating entity name, grievance officer, privacy policy, terms of use, accessibility statement, "Last updated" date (GIGW, if applicable, OQ-13).

## 9. What to ask QCI (OQ-19)
1. The colour palette with official HEX/RGB values for Q Blue, black, and any accent and neutral colours.
2. Logo files in vector format: standard logo and logo bug, each in full colour, 100% black and reversed.
3. Clear-space measurement and minimum size for the standard logo; responsive breakpoints.
4. The typeface to use for a web application (headings and body), and clarification of "Operetta 12".
5. Naming and endorsement of LabConnect, NABL co-branding, and whether the Government of India emblem and the boards-and-divisions footer are required.
6. Whether the QCI icon set must be used, and the files if so.
7. Written permission to keep QCI logo files in this (public) repository (see `reference/README.md`).
8. The second draft of the guidelines, if one exists.
