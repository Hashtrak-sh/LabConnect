# Authentication and authorisation

**Status:** DRAFT for gate G2. Decision: ADR-006 (in-house passwordless auth on NestJS, with Amazon Cognito recorded as an alternative).

## 1. Sign-in (MVP)
1. `POST /auth/otp/request {email}` → 6-digit OTP, 10-minute expiry, emailed via SES. The response is always 202.
2. `POST /auth/otp/verify {email, code}` → if the user doesn't exist, it's created (`ACTIVE`, email verified) for customer self-signup. Invited users accept through the invitation token.
3. If any active membership has an MFA-required role: the user must enrol (`MFA_ENROLMENT_REQUIRED`) or verify TOTP before a full session is issued.
4. Session: **access JWT** (10 min, `EdDSA`, claims: `sub`, `sid`, `amr`, `mfa_at`) and a **refresh token** (opaque, rotating, 12 h idle / 7 days absolute, httpOnly + Secure + SameSite=Lax cookie scoped to the API domain). Reuse of a rotated refresh token revokes the whole token family.

**Phone OTP** (FR-IAM-02) is added when an SMS provider with DLT registration is contracted (OQ-11). The schema already supports it.

## 2. MFA
- TOTP (RFC 6238, 30 s, ±1 step), with the secret encrypted with a KMS data key and 10 single-use recovery codes.
- **Required** for: `LAB_CHECKER`, `CUSTOMER_FINANCE`, all `PLATFORM_*`.
- **Step-up** (fresh MFA ≤ 5 min, stored as `user_session.mfa_verified_at`) for: report publish (T-21), bank account add or change, payout release, refund approval above the threshold, break-glass access, platform role changes.
- MFA reset: by `PLATFORM_ADMIN` only, after identity verification. Audited.

## 3. Authorisation model
- **Permission codes** (e.g. `booking.accept`, `receipt.approve`, `report.publish`, `masterdata.changeset.approve`) are mapped to roles in `packages/shared/src/permissions.ts`, generated from the matrix in `ROLES_AND_PERMISSIONS.md`.
- Nest guards, in order: `AuthGuard` (valid access token, session not revoked) → `MembershipGuard` (resolve the active membership, load roles and site IDs into `CurrentActor`) → `PermissionGuard(@RequirePermission)` → `MfaGuard(@RequireStepUp)`.
- **Resource checks** in the domain service: the tenant scope matches; the lab site is in the actor's `siteIds`; Maker ≠ Checker on the target record; the state allows the action.
- Unknown or out-of-scope resources → 404. In-scope but not permitted → 403.

## 4. Session security
- Revoke on: logout, membership deactivation (all sessions for that membership's user, when the session's active membership is the one revoked), role change, MFA reset, detected refresh-token reuse.
- Device list via `user_session`. Anomaly signals (new country or ASN, many failed OTPs) are logged and alerted.
- CSRF: the API accepts the cookie only on `/auth/refresh` (SameSite=Lax + `Origin` check). Other calls use the bearer token held in memory by the web app.

## 5. Lab claim verification (FR-DAT-07)
The OTP is sent to `lab_site.contact_email` from **NABL-imported data only** (never a user-supplied address). Fallback: a manual letterhead upload, reviewed by `PLATFORM_OPS`. On approval, the claimant becomes the first `LAB_CHECKER` (MFA enrolment forced) and the org becomes `CLAIMED`.

## 6. Service-to-service and system actors
- The worker uses the same DB role. Domain commands run as `SYSTEM` with `actor_party='SYSTEM'`.
- Webhooks are authenticated by gateway signature verification (scheme per ICICI docs, OQ-01), not by user auth.
