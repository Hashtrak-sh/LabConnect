# Design system

**Status:** DRAFT. Built on Tailwind CSS + shadcn/ui (Radix primitives). **Semantic tokens only** in components, so the QCI brand values (BRAND_GUIDELINES §4–5) can be applied by changing token values, not components.

## 1. Token layers
1. **Brand primitives** (filled from QCI): `--qci-<name>-<shade>`. Placeholders until OQ-19 is resolved.
2. **Semantic tokens**, which components use:

| Token | Purpose | Placeholder (unbranded draft) |
|---|---|---|
| `--color-bg` / `--color-surface` / `--color-surface-raised` | Page, cards, popovers | white / gray-50 / white |
| `--color-text` / `--color-text-muted` / `--color-text-inverse` | Text | gray-900 / gray-600 / white |
| `--color-border` / `--color-border-strong` | Borders | gray-200 / gray-500 (gray-400 is only 2.5:1 on white and fails WCAG 1.4.11 for input borders; changed in D-02) |
| `--color-brand-primary` / `-hover` / `-contrast` | Primary actions, links, focus | neutral slate-800 (placeholder) |
| `--color-brand-secondary` | Secondary emphasis | slate-600 |
| `--color-success` / `--color-warning` / `--color-danger` / `--color-info` (+ `-bg` variants) | Status | green-700 / amber-700 / red-700 / blue-700 |
| `--color-focus-ring` | Focus outline (≥ 3:1) | brand-primary |

3. **Status mapping for bookings** (one source of truth in `packages/ui/status.ts`):

| Group | States | Tone |
|---|---|---|
| Waiting on customer | COUNTERED, ACCEPTED (pay), HANDOVER_SET, ON_HOLD | warning |
| Waiting on lab | REQUESTED, SAMPLE_RECORDED, RECEIVED, UNDER_TEST, REPORT_IN_REVIEW | info |
| Done or positive | PAID, REPORT_RELEASED, COMPLETED | success |
| Problem | DISPUTED | danger |
| Closed or negative | REJECTED, EXPIRED, EXPIRED_UNPAID, NO_SHOW, CANCELLED | neutral |

Status is **never conveyed by colour alone**. Always show a label and an icon.

## 2. Typography scale
`text-xs 12 / sm 14 / base 16 / lg 18 / xl 20 / 2xl 24 / 3xl 30`. Body is 16 px minimum. Line height is 1.5 for body. Tabular numerals for money, counts and IDs. Font families come from BRAND_GUIDELINES §5.

## 3. Spacing, radius, elevation
4-px base grid (Tailwind scale). Radius: `sm 4`, `md 8` (default), `lg 12`. Two elevation levels (card, overlay). Professional and restrained, without heavy shadows.

## 4. Density modes
- **Comfortable** (public and customer): more whitespace.
- **Compact** (lab and admin tables): 40-px rows, used on desktop only.

## 5. Motion
Subtle (150–200 ms), with `prefers-reduced-motion` respected. No decorative animation on operational screens.

## 6. Dark mode
Not in the MVP. Tokens are structured to allow it later.
