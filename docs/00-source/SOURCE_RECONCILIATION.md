# Source reconciliation

**Status:** Approved by the product owner (@Hashtrak-sh), Nov 2026.

There are two source documents: the **Feature Specification** (FS, v1.0 draft) and the **Handoff Summary** (HS). Where they disagree, the resolutions below apply. Every resolution here is mirrored in `01-product/CONFIRMED_DECISIONS.md`.

| # | Topic | FS says | HS says | Resolution |
|---|---|---|---|---|
| R-01 | Calibration labs | Listed and searchable, but booking is Phase 2 (§4) | Initial categories are "industrial testing and calibration" | Calibration labs are **imported, listed and searchable but not bookable** in the MVP. The schema supports calibration so it can be enabled later. |
| R-02 | Counter-offers | The Checker can counter with a new slot, revised price, extra quantity or method change (FR-LAB-02, §6) | Negotiated quotations aren't in the MVP | The Checker **can counter with a new slot and/or additional sample-quantity requirements only**. No price revisions and no method changes. The price always comes from the lab's published price list. |
| R-03 | Supplementary payments | Should-have (FR-PAY-08, EC-21) | Negotiated pricing excluded | **Deferred.** In the MVP, extra work means cancelling the untested lines and making a new booking. |
| R-04 | Multi-branch labs | "Multi-branch lab groups" in Phase 3 | Multiple branches under a parent organisation | The **schema models one Lab Organisation with many Lab Sites** from day one (FR-DAT-04 needs this anyway). Each site is booked separately. Group-level dashboards and reporting are deferred. |
| R-05 | Platform fee and commission | Platform fee in estimates and invoices, commission per category, commission model as an open question | Monetisation not needed | **No platform fee or commission in the MVP.** The ledger and fee configuration keep a platform-fee line that is set to zero. The FS's commercial framing ("founders", "take rate") doesn't apply. |
| R-06 | SMS and WhatsApp | SMS and WhatsApp in several notification rows | Email and in-app first; SMS and WhatsApp supportable later | **Email and in-app only** in the MVP. The channel abstraction supports SMS and WhatsApp later. Rows that relied on SMS or WhatsApp fall back to email plus in-app. |
| R-07 | Phone OTP | — | Email/phone OTP + role-based MFA | Phone OTP needs an SMS provider (DLT-registered), which is deferred. **MVP login is email OTP**, with TOTP MFA for sensitive roles. Phone numbers are captured and verified once SMS is introduced. See OQ-11. |
| R-08 | Workflow timers | Scheduler or durable workflow engine, e.g. Temporal | Not mentioned | **A database-backed timer table processed by the worker** (see ADR-008). Temporal is recorded as an alternative for later. |
| R-09 | Async messaging | Kafka or SQS/SNS | SQS | **AWS SQS**, fed by a transactional outbox. |
| R-10 | Hosting | Kubernetes or ECS | ECS/Fargate | **ECS/Fargate in `ap-south-1`.** |
| R-11 | Backend language | NestJS or Spring Boot | NestJS | **NestJS (TypeScript).** |
| R-12 | GPS on custody events | §8.3 records GPS on every scan | — | The **amendment (A.5) overrides this: no GPS** is captured on custody events. |
| R-13 | Environments | — | Local, staging, production | **Local, UAT (deployed from `main`), production (deployed from `production`).** UAT is the staging environment. |
| R-14 | Ownership | Commercial marketplace language | Government-owned and government-operated | Government-operated. **QCI branding applies for now** (see `09-design-handoff/BRAND_GUIDELINES.md`). The legal owning entity is to be confirmed (OQ-12). |
| R-15 | Payment gateway | "Gateway with marketplace split support" | ICICI Bank gateway | **ICICI Bank.** Split, hold and payout capabilities are unconfirmed (OQ-01, OQ-02). |
| R-16 | PAYMENT_PENDING | EC-15 mentions a PAYMENT_PENDING booking state | — | Modelled as a **payment-order status**, not a booking state. The booking stays `ACCEPTED`, and the payment window is extended while reconciliation runs. |
| R-17 | Customer segments | Manufacturers (B2B) | Individuals, businesses, industries, government organisations | All four are supported. An individual is modelled as a single-member customer organisation with segment `INDIVIDUAL`. |
| R-18 | Labels for customers without printers | Open question | QR labels printable by both customer and laboratory | The **Maker can print a booking's labels at the counter**. The reprint and void rules still apply. |
| R-19 | Sample retention | Open question | Record basic retention period | Each lab site sets a retention period per discipline. `retain_until` is recorded on the booking when the receipt is approved. No disposal workflow in the MVP. |
| R-20 | Subcontracting (EC-36) | The customer can allow subcontracting | Excluded | **Excluded.** On equipment breakdown, the customer can cancel the untested lines for a refund. |
