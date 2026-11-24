# Non-functional requirements

**Status:** DRAFT. The targets come from the feature specification and must be formally adopted at architecture sign-off (OQ-06).

| ID | Area | Requirement | Verification |
|---|---|---|---|
| NFR-01 | Availability | 99.5% monthly for the customer, lab and admin apps | Synthetic checks, monthly SLO report |
| NFR-02 | Availability | 99.9% monthly for the payment webhook endpoint and public verification | Synthetic checks, separate target group, alarms |
| NFR-03 | Performance | Search p95 < 800 ms for a 10 km radius query with filters | k6 load test against UAT-sized data |
| NFR-04 | Performance | Booking create p95 < 1.5 s | k6 load test |
| NFR-05 | Performance | Other authenticated API reads p95 < 500 ms; writes p95 < 1 s | APM dashboards |
| NFR-06 | Scale (year 1 sizing) | 15,000 lab sites, 2 million scope lines, 5,000 customer orgs, 2,000 bookings/day peak | Seeded load dataset |
| NFR-07 | Mobile | The lab app and QR scanner work in mobile browsers on Android 9+ and low-end devices, with an offline scan queue | Device lab or BrowserStack, Playwright mobile profile |
| NFR-08 | Accessibility | WCAG 2.1 AA | axe-core in Playwright plus a manual audit before launch |
| NFR-09 | Government web standards | GIGW 3.0 applicability to be confirmed (OQ-13) | Compliance checklist |
| NFR-10 | Localisation | English at launch. All strings externalised for Hindi. Indian number format (₹1,00,000). IST display, UTC storage. | Lint rule for hard-coded strings, unit tests |
| NFR-11 | Observability | Structured JSON logs, traces carrying the booking ID, SLA dashboards, alerts on stuck states and overdue approvals | Dashboards reviewed at G3 |
| NFR-12 | Backup and DR | Daily snapshots + 7-day PITR. RPO 15 min, RTO 4 h. Report storage versioned and replicated across regions. | DR drill before go-live |
| NFR-13 | Security | OWASP ASVS Level 2 baseline | Security test suite, pen test before launch |
| NFR-14 | Integrity | Report files, ledger entries, custody events and audit logs are tamper-evident and append-only | DB permission tests, hash checks |
| NFR-15 | Data residency | All primary data and backups are held in Indian AWS regions | IaC review |
| NFR-16 | Browser support | Latest 2 versions of Chrome, Edge, Firefox, Safari. Chrome on Android 9+. | Playwright matrix |
| NFR-17 | Retention | Retention periods are configurable per data class (CD-18) | Config tests |
| NFR-18 | Maintainability | Module boundaries enforced by lint (dependency-cruiser). Coverage gates per `TESTING_STRATEGY.md`. | CI |

## Cross-region DR note
`ap-south-1` (Mumbai) is primary. The proposed DR region is `ap-south-2` (Hyderabad), which keeps data in India. Confirm that the required services are available there (OQ-06).
