# Module boundaries

**Status:** Approved at gate G1 (2026-11-24).

Backend modules live in `apps/api/src/modules/<module>` (with worker handlers in `apps/worker/src/modules/<module>`). Domain logic that both the API and the worker need lives in `packages/core/src/<module>/` (ADR-020): framework-free TypeScript that the apps wrap in thin Nest providers. The `platform` services are the first to live there. Each module owns its tables. Other modules **must not** read or write those tables directly. They call the owning module's exported service interface or react to its events. `dependency-cruiser` enforces this in CI.

| Module | Owns (tables) | Exposes | Primary owner |
|---|---|---|---|
| `platform` | `outbox_event`, `processed_event`, `timer`, `idempotency_record`, `config_parameter`, `holiday_calendar`, `audit_log`, `audit_log_chain` | `AuditService`, `OutboxService`, `TimerService`, `ConfigService`, `Clock`, `BusinessCalendar` | Shared |
| `identity` | `organisation`, `app_user`, `membership`, `membership_role`, `membership_site`, `otp_challenge`, `mfa_factor`, `mfa_recovery_code`, `user_session`, `invitation`, `invitation_site`, `organisation_private`, `organisation_version` | `AuthService`, `MembershipService`, guards (`@Authorised`), `CurrentActor`, `TenantScope`, resource checks | Shared |
| `files` | `file_object`, `file_link` | `FileService` (upload URLs, scan status, download URLs) | Shared |
| `masterdata` | `md_taxonomy`, `md_node_type`, `md_attribute_definition`, `md_node`, `md_node_version`, `md_change_set`, `md_change_item`, `import_mapping_template`, `import_job`, `import_row`, `accreditation_body`, `accreditation_standard`, `search_synonym`, `search_synonym_version` | `TaxonomyService`, `ChangeSetService`, `ImportService` | Shared |
| `labs` | `lab_site`, `lab_site_version`, `accreditation`, `accreditation_version`, `scope_line`, `scope_line_version`, `lab_claim_request`, `kyc_document`, `bank_account`, `receiving_hours`, `site_closure`, `retention_rule`, `price_list`, `price_item`, `slot_template`, `slot`, `lab_site_private`, `lab_penalty` | `LabDirectoryService`, `BookabilityService`, `PricingService`, `CapacityService` | Lab (@Hashtrak-sh) |
| `customers` | `customer_site`, `customer_settings`, `lead_request` | `CustomerService` | Customer (@akshit-anand) |
| `search` | (OpenSearch index only) | `SearchService` | Customer (@akshit-anand) |
| `booking` | `booking`, `booking_line`, `trf`, `booking_status_history`, `counter_offer`, `slot_hold`, `booking_transition` | `BookingEngine.transition()`, `BookingQueryService` | Shared (engine), Customer (create UX), Lab (decision) |
| `custody` | `package`, `custody_event`, `receipt_record`, `receipt_package`, `hold_case`, `label_print`, `qr_signing_key`, `custody_event_photo` | `CustodyService`, `QrService` | Lab (@Hashtrak-sh) |
| `reports` | `report`, `report_version`, `report_parameter_result`, `report_share_link`, `report_access_log`, `verification_event`, `break_glass_grant` | `ReportService`, `VerificationService` | Lab (@Hashtrak-sh) |
| `payments` | `payment_order`, `payment_transaction`, `gateway_webhook_event`, `refund`, `payout`, `payout_item`, `payout_hold`, `ledger_account`, `ledger_journal`, `ledger_entry`, `financial_document`, `document_series`, `fee_rule`, `settlement_report_line` | `PaymentService`, `RefundService`, `PayoutService`, `LedgerService` | Shared |
| `disputes` | `dispute`, `dispute_message`, `dispute_evidence`, `rating` | `DisputeService` | Shared |
| `notifications` | `notification_template`, `notification`, `notification_preference` | `NotificationService.notify(event)` | Shared |
| `admin` | — (read models only, composed from other modules) | Ops board queries | Shared |

## Dependency rules
1. `platform` depends on nothing. Everything may depend on `platform`.
2. `identity` and `files` depend only on `platform`.
3. `booking` may call `labs` (bookability, pricing snapshot, slot capacity), `customers` and `identity`. It must never call `payments`, `custody` or `reports` synchronously. Those modules call `BookingEngine.transition()` instead.
4. `payments`, `custody` and `reports` call `BookingEngine.transition()` to change booking state, never by writing `booking.status`.
5. `notifications` and `search` are **event consumers only**. Nothing calls them synchronously during business writes.
6. `admin` is read-only, except where it calls another module's public command (e.g. `DisputeService.decide`).
7. Cross-module reads for UI composition go through query services. Reporting views (SQL views prefixed `rv_`) are allowed for the admin board.
   - **The booking detail** (`getBooking`, I3-SHR-01) is such a composition. The booking module reads what it owns (`getBookingDetail`), and the API's booking module adds the read-only query functions of the modules that own the rest: `latestBookingHoldCase` (custody), `bookingRating` (disputes) and `labSitePublicContact` (labs). It calls them only after `getBookingDetail` has shown that the actor may read the booking. This is a read for display, not the synchronous command call rule 3 forbids; no state changes.
   - **Reference data in booking reads.** `listBookings` and `getBookingDetail` join the reference tables of `labs` and `masterdata` (`lab_site`, `slot`, `scope_line`, `price_item`, `accreditation`, `md_node`) in their own read-only SQL, for names, addresses and snapshot fallbacks, rather than calling one service per row. They never write those tables.
   - **Known limit of the check.** `dependency-cruiser` sees module folders, so a call through the `@labconnect/core` barrel from an app module is not matched by rule 3. Reviews check those calls.

The dependency rules apply to the module folders of `apps/*/src/modules/` and of `packages/core/src/` alike. Beyond them, `packages/core` imports only `packages/database` and `packages/shared`, never an app and never a Nest package.

## Shared packages
- `packages/core`: server-side code shared by the API and the worker, by module folder (`platform/` first). Nest-free; takes time from an injected `Clock`. Depends on `packages/database` and `packages/shared` only (ADR-020).
- `packages/shared`: enums (roles, states, event codes), the state machine transition table (pure data), money and time helpers, permission codes. **Single source** for both the API and the web app.
- `packages/validation`: Zod schemas for the TRF, import rows and query params, shared between web and API.
- `packages/api-contract`: OpenAPI 3.1 YAML plus generated TS types/clients (`openapi-typescript`).
- `packages/database`: Prisma schema, SQL migrations, seed scripts, the RLS helper.
