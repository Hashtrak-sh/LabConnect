# Roles and permissions

**Status:** Approved at gate G1 (2026-11-24). Permission codes here are implemented in `packages/shared/src/permissions.ts` and enforced by API guards.

## 1. Roles

| Code | Org type | Description | MFA |
|---|---|---|---|
| `CUSTOMER_ADMIN` | Customer | Manages the org profile, users, sites and settings. Can book and pay. | Optional (recommended) |
| `CUSTOMER_REQUESTER` | Customer | Searches, creates and tracks bookings, views own bookings' reports | Optional |
| `CUSTOMER_FINANCE` | Customer | Pays, sees invoices, receipts, refunds and all org reports | **Required** |
| `LAB_MAKER` | Lab | Records receipts, starts testing, uploads and binds reports, drafts amendments, prints labels | Optional |
| `LAB_CHECKER` | Lab | Decides on bookings, approves receipts and reports, manages lab configuration and users | **Required** |
| `PLATFORM_OPS` | Platform | Operations board, disputes, claims, KYC review, overrides as defined below | **Required** |
| `PLATFORM_DATA_STEWARD` | Platform | Prepares master-data imports and change sets | **Required** |
| `PLATFORM_FINANCE` | Platform | Reconciliation, refunds approval, payout release, financial documents | **Required** |
| `PLATFORM_ADMIN` | Platform | Platform users, roles, global configuration, break-glass approval | **Required** |

The handoff summary only names "Platform Operations". The split into four platform roles above is a proposal (ADR-012) for review at G1.

### Role rules
- **RR-1.** A user can hold several customer roles within one customer organisation.
- **RR-2.** Within a lab organisation, a user holds exactly one of `LAB_MAKER` or `LAB_CHECKER`. Only a Checker can change it, the change is logged, and it doesn't apply retroactively to pending items.
- **RR-3.** Lab users are assigned to one or more lab sites of their organisation. They act only on bookings at those sites.
- **RR-4.** A user can be a member of several organisations (e.g. a consultant). One membership is active per session.
- **RR-5.** Platform roles can't be combined with customer or lab memberships on the same user account.
- **RR-6.** Master-data approval needs a different platform user from the preparer (four-eyes).
- **RR-7.** `PLATFORM_OPS` can never approve a lab's receipt or report on the lab's behalf (EC-54).

## 2. Permission matrix

Legend: ✔ allowed · ○ own records only · ◐ condition applies (see note) · — not allowed.

| Capability | C-Admin | C-Req | C-Fin | L-Maker | L-Checker | P-Ops | P-Data | P-Fin | P-Admin |
|---|---|---|---|---|---|---|---|---|---|
| Search labs (also anonymous) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Create / edit booking (REQUESTED) | ✔ | ○ | — | — | — | ◐¹ | — | — | — |
| Cancel booking | ✔ | ○ | — | — | ◐² | ◐² | — | — | — |
| Respond to counter-offer | ✔ | ○ | — | — | — | — | — | — | — |
| Pay | ✔ | ◐³ | ✔ | — | — | — | — | — | — |
| View QR labels and drop instructions | ✔ | ○ | — | ✔ | ✔ | ✔ | — | — | — |
| Print labels | ✔ | ○ | — | ✔ | ✔ | — | — | — | — |
| View lab inbox | — | — | — | ✔ | ✔ | ✔ | — | — | — |
| Accept / reject / counter | — | — | — | — | ✔ | ◐⁴ | — | — | — |
| Manage profile, prices, slots, hours | — | — | — | — | ✔ | ◐⁵ | — | — | — |
| Manage lab users | — | — | — | — | ✔ | ✔ | — | — | — |
| Scan QR, record receipt | — | — | — | ✔ | — | — | — | — | — |
| Approve receipt / confirm hold | — | — | — | — | ◐⁶ | — | — | — | — |
| Decide on hold (proceed/replace/cancel) | ✔ | ○ | — | — | — | — | — | — | — |
| Start testing, update ETA | — | — | — | ✔ | — | — | — | — | — |
| Upload / bind / submit report | — | — | — | ✔ | — | — | — | — | — |
| Approve & publish / return report (MFA) | — | — | — | — | ◐⁶ | — | — | — | — |
| Approve label reprint | — | — | — | — | ◐⁶ | — | — | — | — |
| Download report | ✔ | ○ | ✔ | ✔ | ✔ | ◐⁷ | — | — | — |
| Create / revoke share link | ✔ | ○ | ✔ | — | — | — | — | — | — |
| Raise dispute | ✔ | ○ | ✔ | — | ✔ | — | — | — | — |
| Decide dispute | — | — | — | — | — | ✔ | — | — | — |
| Payout hold / release | — | — | — | — | — | ◐⁸ | — | ✔ | — |
| Approve refund | — | — | — | — | — | ◐⁸ | — | ✔ | — |
| View invoices / receipts | ✔ | — | ✔ | — | ✔ | ✔ | — | ✔ | — |
| Manage org users and sites | ✔ | — | — | — | ✔ | ✔ | — | — | ✔ |
| Prepare master-data change set | — | — | — | — | — | — | ✔ | — | — |
| Approve and publish change set | — | — | — | — | — | — | ◐⁹ | — | ✔ |
| Verify KYC and bank, approve claims | — | — | — | — | — | ✔ | — | ◐¹⁰ | — |
| Configure SLAs, policies, fees | — | — | — | — | — | — | — | — | ✔ |
| View audit log | — | — | — | — | — | ✔ | ✔ | ✔ | ✔ |

Notes:
1. On behalf of a customer, recorded with `on_behalf_of`. The customer must still pay.
2. A Checker cancels after payment (EC-20, lab penalty). Ops can cancel at any non-terminal state, with a reason. *The transition table covers Ops cancellation up to UNDER_TEST only; later states are open (OQ-24).*
3. Only if the org setting `requester_can_pay` is true.
4. Override in exceptional cases only, with a reason, and visible to the lab. *Not in the transition table yet (OQ-24); not built until decided.*
5. Review and approve map-pin changes. No direct price edits.
6. Never on items where the same user was the Maker. Needs step-up MFA for report publication.
7. Metadata only by default. The file needs break-glass access: a `break_glass_grant` approved by a `PLATFORM_ADMIN` other than the requester, time-boxed, with each access logged.
8. Ops can place a hold. `PLATFORM_FINANCE` releases payouts and approves refunds above a configurable threshold.
9. A different steward or `PLATFORM_ADMIN` must approve (RR-6).
10. Bank verification needs `PLATFORM_FINANCE`.

## 3. Enforcement layers
1. **API guards:** `@RequirePermission('booking.decide')`. Membership and role are resolved from the session, never from the request body.
2. **Domain service checks:** state, ownership and Maker≠Checker are checked inside the transaction.
3. **Database:** `CHECK (checker_user_id <> maker_user_id)`, a trigger that blocks two lab roles on one membership, and RLS as defence in depth (see `02-architecture/TENANT_ISOLATION.md`).
4. **Tests:** a generated permission-matrix test suite asserts every cell of this table for every endpoint.
