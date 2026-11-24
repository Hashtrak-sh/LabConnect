# Security and privacy requirements

**Status:** DRAFT. These are designed controls. **They don't constitute a claim of regulatory compliance.** The legal and regulatory items in §5 need formal review (OQ-04).

## 1. Security controls
| Area | Control |
|---|---|
| Transport | TLS 1.2+ end to end (CloudFront → ALB → tasks over TLS where supported). HSTS. |
| Encryption at rest | RDS, S3, OpenSearch, ElastiCache, SQS encrypted with KMS CMKs. Application-level envelope encryption for bank account numbers, PAN, TOTP secrets and raw webhook payloads. |
| Identity | Email OTP. TOTP MFA for sensitive roles. Step-up MFA for critical actions. Session revocation. |
| Authorisation | Server-side RBAC, tenant scoping, RLS defence in depth, Maker/Checker enforced in the API and the DB |
| Files | Pre-signed direct upload, malware scan, type validation, quarantine, signed 15-minute downloads, revocable share links |
| QR integrity | KMS HMAC signatures, server-side verification, key rotation with overlap |
| Webhooks | Signature verification, replay protection (event ID), idempotency, raw payload retention (encrypted), reconciliation backstop |
| Input handling | Schema validation at every boundary, output encoding, parameterised queries only, strict CSP on web, CSRF protection on cookie endpoints |
| Rate limiting | WAF + application limits (API_CONVENTIONS §7) |
| Secrets | Secrets Manager. No secrets in code, CI logs or images. gitleaks in CI. |
| Supply chain | Lockfile, Dependabot, `pnpm audit`, pinned Actions by SHA, image scanning, SBOM generation |
| Logging | No sensitive data in logs. Audit log hash-chained and append-only. |
| Testing | OWASP ASVS L2 checklist, ZAP baseline nightly, third-party pen test before launch and annually |
| Admin access | No direct production DB access for developers. Break-glass via SSM Session Manager with approval and logging. |

## 2. Data classification
| Class | Examples | Handling |
|---|---|---|
| Public | Lab directory, scope, published prices, verification metadata | May be indexed and cached |
| Internal | Config, aggregated metrics | Staff only |
| Confidential | TRF content, booking details, customer org data, ratings | Tenant-scoped, encrypted at rest |
| Restricted | Report files, bank details, PAN, KYC documents, OTP and TOTP secrets, raw payment payloads | Encrypted (+ envelope where noted), access logged, break-glass for platform |

## 3. Privacy (DPDP Act 2023): design measures for legal review
- Notice and consent at sign-up (purpose: booking and accreditation verification, communication). Versioned consent record (`app_user` consent fields to be added after legal review, OQ-04).
- Data minimisation: no customer data in QR payloads, the search index or verification pages. Device location is never stored.
- Data principal rights: access and export of own data, correction, erasure **where lawful**. Reports and financial records may be under retention obligations.
- A breach response procedure (RUNBOOK §9) and a grievance officer contact (IT Act) are shown in the footer.
- Retention: configurable per class (CD-18). Proposed 10 years for reports, custody and financial records, pending legal review. Shorter for logs (1 year hot, longer in cold storage per policy).

## 4. Payment security
Hosted checkout. No card data stored or transmitted through LabConnect servers (aiming for PCI DSS SAQ-A scope, to be confirmed with ICICI's integration model).

## 5. Items requiring legal or regulatory review (not legal advice)
DPDP Act obligations · RBI payment aggregator rules and the settlement model (ADR-009) · GST (invoice issuer, e-invoicing thresholds, TCS s.52 applicability for a government operator) · TDS (s.194-O applicability) · NABL data and mark usage permissions (OQ-03) · Retention periods · IT Act intermediary obligations and terms of use · GIGW applicability (OQ-13) · Accessibility statement.
