# Design master prompt (Claude Design)

> ⛔ Use only after gate **G2** is marked passed in `docs/08-project/ROADMAP.md`.

```text
You are designing LabConnect, a government-operated marketplace (QCI branding) for finding
and booking NABL-accredited industrial testing laboratories in India.

Read, in this order:
1. docs/09-design-handoff/DESIGN_BRIEF.md
2. docs/09-design-handoff/BRAND_GUIDELINES.md   (use only the brand values recorded there;
   if a value is marked "to fill", use the neutral placeholder tokens from DESIGN_SYSTEM.md
   and label the output "Unbranded draft" — never invent QCI colours, fonts or logo usage)
3. docs/09-design-handoff/UX_PRINCIPLES.md and DESIGN_SYSTEM.md
4. docs/09-design-handoff/COMPONENT_SPECIFICATION.md
5. docs/09-design-handoff/CUSTOMER_USER_FLOWS.md, LAB_USER_FLOWS.md, ADMIN_USER_FLOWS.md
6. docs/09-design-handoff/RESPONSIVE_DESIGN_GUIDELINES.md
7. docs/01-product/GLOSSARY.md and docs/02-architecture/BOOKING_STATE_MACHINE.md (for states)

Produce, in this order, pausing for review after each:
A. Token sheet + core components with all states.
B. Public search, lab page, verification page (360 / 768 / 1280).
C. Customer booking flow C3–C6 and booking detail C7 (360 / 1280).
D. Lab Maker counter scanner L3 (360) and Checker approvals L4/L7 (1280).
E. Dashboards: customer, Maker, Checker, Ops board.
F. Remaining flows.

Constraints: professional hybrid style (government credibility + modern SaaS clarity);
WCAG 2.1 AA; English copy with room for Hindi expansion; Indian number/date formats;
status never by colour alone; no pickup/tracking/rider/subcontracting/price-negotiation/
platform-fee UI. Annotate each screen with the API fields it uses.
```
