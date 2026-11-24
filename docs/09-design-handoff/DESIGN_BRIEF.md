# Design brief

**Status:** Ready for the design phase (after G2).

## 1. Product
LabConnect is a government-operated marketplace for finding and booking NABL-accredited industrial testing laboratories, with a QR-tracked self-drop handover, Maker/Checker approval at the lab, and publicly verifiable reports. QCI branding applies for now.

## 2. Visual direction
A **professional hybrid**: as credible and calm as a government service, with the clarity and speed of a modern SaaS product. Trust over flash. Plenty of whitespace on public pages, and efficient density on operational screens.

## 3. Audiences and devices
| Audience | Context | Primary device |
|---|---|---|
| Public visitors and customers (individual, business, industry, government) | Searching, comparing, booking, paying, downloading | Desktop + mobile |
| Lab Maker | At the receiving counter, scanning samples, uploading reports | **Mobile or tablet** at the counter, desktop for reports |
| Lab Checker | Approving, managing configuration | Desktop + mobile for approvals |
| Platform staff | Data management, operations, finance, disputes | Desktop |
| Anyone verifying a report | Scanning the QR on a printed report | Mobile |

## 4. Deliverables
1. Design tokens mapped to QCI brand values (or the unbranded draft).
2. Core component library (COMPONENT_SPECIFICATION).
3. High-fidelity screens for every flow in the three USER_FLOWS files, at mobile (360), tablet (768) and desktop (1280+) where marked.
4. Empty, loading, error and permission-denied states for each screen.
5. Clickable prototype for journeys J1 (happy path), J6 (hold) and J7 (report returned).
6. Annotations: data fields mapped to API fields (from `openapi.yaml`), validation messages, i18n keys.

## 5. Constraints
- WCAG 2.1 AA. Keyboard-complete. Screen-reader labels.
- English copy now. Layouts must survive 30–40% longer strings (Hindi later).
- Indian formats: ₹1,00,000, DD MMM YYYY, IST.
- Never show data a role can't access. Design the "metadata only" view for platform staff on reports.
- **Out of scope in the UI:** pickup, tracking, riders, subcontracting, negotiated price, purchase orders, platform fees.

## 6. Success criteria
A first-time customer can search and submit a booking in under 5 minutes. A Maker can scan and record a 3-package receipt in under 2 minutes on a phone. A Checker sees everything waiting for them on one screen. A verifier understands the result in 5 seconds.
