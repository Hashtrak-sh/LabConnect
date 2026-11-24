# Admin (platform) user flows

## A1. Ops board (PLATFORM_OPS): D
Tiles: bookings by state, SLA breaches (lab decision, approvals), overdue drops, holds awaiting the customer, escalations, stuck bookings → drill-down lists → booking detail (metadata-only report section) → exceptional actions (cancel with a reason, override a decision with a reason).

## A2. Master data (DATA_STEWARD / approver): D
Taxonomy browser (tree, node types, attribute definitions) → edit inside a **change set** → change-set inbox (Mine / To review) → review screen (diff viewer, impact panel with affected bookings) → approve (must be a different person) → publish → version history per record.

## A3. Import wizard: D
Upload (CSV/XLSX) → pick a mapping template (or create one: column mapper with preview) → parsing progress → **preview** (counts: create/update/no change/conflict/error, row drill-down, resolve unknown values inline, download the error CSV) → commit → change set → A2 review.

## A4. Labs and onboarding (OPS): D
Claim requests (OTP-verified / manual with letterhead) → approve or reject · KYC review · Geocode pin queue (map with drag, approve) · Lab proposals · Lab users (view, deactivate in an emergency).

## A5. Disputes (OPS): D
Queue (by SLA) → dispute detail (thread, evidence, booking timeline) → request info from a party → decide (outcome, refund amount, rationale) → auto refund, credit note and payout hold release.

## A6. Finance (PLATFORM_FINANCE): D
Refund approvals (above the threshold) · Payout batches (eligible → release with step-up MFA → record UTR) · Holds · Reconciliation (import the settlement file, exceptions) · Exports (CSV) · Financial documents search.

## A7. Configuration and administration (PLATFORM_ADMIN): D
Config parameters (SLA, windows, fees, with an effective date and reason) · Notification templates (preview) · Platform users and roles (MFA status) · Break-glass approvals · Audit log search (entity, actor, date) · Leads.
