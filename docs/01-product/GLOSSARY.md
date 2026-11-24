# Glossary

| Term | Meaning |
|---|---|
| **Accreditation** | Formal recognition by NABL that a lab site is competent for specific tests. Stored per lab site with a certificate number, standard, validity and status. |
| **Accreditation status** | `VALID`, `SUSPENDED`, `WITHDRAWN`, `EXPIRED`. Only `VALID` sites can be booked. |
| **ADR** | Architecture Decision Record, kept in `08-project/DECISION_LOG.md`. |
| **Booking** | One customer request for testing at one lab site for one item. It's the central aggregate and has a single state machine. |
| **Booking line** | One parameter (scope line) on a booking, with a frozen price. |
| **Booking number** | Human-readable reference, e.g. `LC-2611-0004821`. |
| **Booking QR** | QR that identifies a booking at lab check-in. |
| **Break-glass** | Logged, time-limited emergency access by platform staff to restricted data (e.g. a report file in a dispute). |
| **Change set** | A group of master-data changes that's reviewed, approved and published together. |
| **Checker (Lab Checker)** | Lab user who approves bookings, receipts and reports and manages lab configuration. Can't also be a Maker. |
| **Counter-offer** | A Checker's proposal of a different slot and/or extra sample quantity. Never a different price in the MVP. |
| **Custody event** | Append-only record of something that happened to a package (generated, scanned, received, voided, etc.). |
| **Customer organisation** | The tenant for customers. An individual has a single-member organisation with segment `INDIVIDUAL`. |
| **Discipline** | Top level of the NABL scope hierarchy (e.g. Mechanical, Chemical, Electrical). |
| **Drop deadline** | The latest time the customer should bring the sample to the lab. |
| **DLT** | TRAI's Distributed Ledger Technology registration, needed for commercial SMS in India. |
| **DPDP Act** | Digital Personal Data Protection Act, 2023. |
| **GIGW** | Guidelines for Indian Government Websites. |
| **GSTIN** | GST Identification Number. |
| **Handover** | The customer's self-drop of the sample at the lab, in the `HANDOVER_SET` state. |
| **ICICI** | ICICI Bank, the intended payment gateway provider. |
| **Lab organisation** | The legal laboratory entity (tenant). It owns one or more lab sites. |
| **Lab sample ID** | The lab's internal identifier for a received sample, linked to each package QR. |
| **Lab site** | One accredited physical location of a lab organisation, with its own certificate, scope, prices, slots and users. This is the thing that gets booked. |
| **Ledger** | The double-entry record of all money movements and obligations. |
| **Listed / Bookable** | A Listed site is visible but can't be booked (unclaimed, not onboarded, calibration, or invalid). A Bookable site meets BR-001. |
| **Maker (Lab Maker)** | Lab user who records receipts, runs testing and uploads reports. Can't approve. |
| **Maker/Checker** | Segregation of duties: one person does the work and a different person approves it. |
| **Master data** | Reference data such as taxonomies, standards, accreditation and scope, managed through change sets. |
| **MFA / Step-up MFA** | A TOTP second factor. Step-up means asking for a fresh MFA before a sensitive action. |
| **NABL** | National Accreditation Board for Testing and Calibration Laboratories, a constituent board of QCI. |
| **NO_SHOW** | Booking state when the customer didn't drop the sample by the deadline plus grace. |
| **ON_HOLD** | Booking state after a Checker confirms a receipt discrepancy. The customer decides what happens next. |
| **Outbox** | A table where domain events are written in the same transaction as the state change, then relayed to SQS. |
| **Package** | One physical parcel of a sample, carrying a unique signed package QR. |
| **Payout** | Transfer of the lab's due amount after the dispute window. |
| **Price list** | A versioned, published set of a lab site's prices per scope line. Immutable once published. |
| **QCI** | Quality Council of India. |
| **Receipt record** | The Maker's record of what physically arrived, decided on by a Checker. |
| **Report version** | One uploaded report file and its review lifecycle. Amendments create new versions. |
| **RLS** | PostgreSQL Row-Level Security. |
| **Scope line** | One accredited test capability: discipline → group → product → parameter → method → range at a site. |
| **Short code** | 6-character code printed on labels for manual lookup. |
| **Slot** | A time window at a lab site with a capacity for sample drops. |
| **Snapshot** | Copy of master-data and price values frozen onto a booking at submission. |
| **Stamped report** | A copy of the report PDF with the verification QR added. The original is kept unchanged. |
| **TAT** | Turnaround time. |
| **Tenant** | An organisation whose data is isolated from other organisations. |
| **TOTP** | Time-based one-time password (authenticator app). |
| **TRF** | Test Request Form, the structured details of what's to be tested. Versioned. |
| **UAT** | User acceptance testing environment, deployed from `main`. |
| **ULR** | Unique Lab Report number required by NABL on accredited reports. |
| **Verification code** | Public, non-guessable code in the report QR URL. |
