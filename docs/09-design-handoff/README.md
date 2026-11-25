# Design handoff (LATER PHASE)

> ✅ **Gate G2 passed on 2026-11-25** (`08-project/ROADMAP.md`), so this phase may start. The screens depend on the approved data model and API contracts.

Workflow (CD-58): **Claude Design** creates the initial visual design → **Claude Code** implements and refines it in `packages/ui` and `apps/web`.

| File | Purpose |
|---|---|
| [DESIGN_MASTER_PROMPT.md](DESIGN_MASTER_PROMPT.md) | The prompt to give Claude Design |
| [DESIGN_BRIEF.md](DESIGN_BRIEF.md) | Goals, audiences, deliverables, constraints |
| [BRAND_GUIDELINES.md](BRAND_GUIDELINES.md) | QCI brand application. **Partly filled from the QCI PDF. Colour codes and web typeface are not in the PDF and are still open (OQ-19).** |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Tokens (semantic), typography scale, spacing, states |
| [UX_PRINCIPLES.md](UX_PRINCIPLES.md) | How the product should feel and behave |
| [COMPONENT_SPECIFICATION.md](COMPONENT_SPECIFICATION.md) | Components needed and their states |
| [CUSTOMER_USER_FLOWS.md](CUSTOMER_USER_FLOWS.md) | Customer journeys and screens |
| [LAB_USER_FLOWS.md](LAB_USER_FLOWS.md) | Lab Maker and Checker journeys and screens |
| [ADMIN_USER_FLOWS.md](ADMIN_USER_FLOWS.md) | Platform staff journeys and screens |
| [RESPONSIVE_DESIGN_GUIDELINES.md](RESPONSIVE_DESIGN_GUIDELINES.md) | Breakpoints, mobile scanner, tables on small screens |
| [designs/](designs/) | **D-02 output (draft, awaiting D-03 review).** Token sheet in code (`lc.css`), one HTML file per board, and the canvas index with API-field annotations. Provisional brand values. |
| [reference/](reference/) | Put the QCI Brand & Communication Guidelines PDF here (don't commit it if it's confidential) |
