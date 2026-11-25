# Authentication and authorisation

**Status:** Approved at gate G2 (2026-11-25). Decision: ADR-006 (in-house passwordless auth on NestJS, with Amazon Cognito recorded as an alternative).

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

## 7. As built (P3-03)

Code: the logic is in `packages/core/src/identity/` (framework-free; functions take a `Prisma.TransactionClient` and a `Clock`, the caller owns the transaction). The HTTP layer is `apps/api/src/modules/identity/` (controllers, `AuthGuard`, `@CurrentSession()`, `@AllowPartialSession()`, the e-mail `OtpMailer` adapter). Where this document and the OpenAPI contract disagree, the contract wins; the differences are listed at the end of this section.

**Sign-in.**
- `requestOtp` stores `HMAC-SHA256(AUTH_HASH_SECRET, code | challenge id)` and `HMAC` of the normalised email (`destination_hash`); the code is 6 digits from `crypto.randomInt`. A new request closes the open challenges of that address, so only the newest code works. The code is sent by the `OtpMailer` port after the transaction commits; it is never written to the outbox, the audit log or a log (OQ-65). No user is read, so the answer does not depend on whether the address has an account. Limits: 5 per 15 minutes per address, 20 per hour per IP, counted in `otp_challenge` (OQ-88); a request over a limit stores nothing and gets `429 RATE_LIMITED` with `Retry-After`.
- `verifyOtp` checks the newest open challenge: 10 minutes (`OTP_EXPIRED`), 5 wrong guesses (`OTP_LOCKED`, also the CHECK of C-79; the right code is refused once locked), single use (one conditional `UPDATE`, so of two simultaneous correct submissions one wins). Then it finds or creates the user (`ACTIVE`, email verified, local part of the address as the placeholder name, OQ-93) and starts a session. A `DISABLED` user and an unknown address get `OTP_INVALID`, like a wrong code (OQ-35). An `INVITED` user may sign in and stays `INVITED` (OQ-86).
- If any active membership has a role that requires MFA (`roleRequiresMfa`: Lab Checker, Customer Finance, all platform roles), the answer is the contract's `mfaRequired` challenge: a **partial session** (access token with `pre_mfa: true`, 10 minutes, no refresh token, no cookie, `mfaEnrolled` says whether to enrol first). Otherwise a full session and the refresh cookie.

**Sessions and tokens.**
- Access token: JWT, `EdDSA` (Ed25519), header `typ: at+jwt`, `kid`; claims `sub`, `sid`, `amr` (`["otp"]`, then `["otp","totp"]`), `mfa_at` (when MFA last succeeded, absent if never), `iss`, `aud`, `iat`, `exp` (+10 minutes), `jti`; a partial session adds `pre_mfa: true`. Keys come from `AUTH_JWT_PRIVATE_KEY` (see `.env.example`); the public key is derived. `AUTH_JWT_PREVIOUS_PUBLIC_KEY` keeps old tokens valid while a key rotation settles.
- `sid` is `user_session.token_family_id`. A session is one family of rows: each refresh retires the live row (`revoked_reason = ROTATED`) and inserts a new live row with the new token's hash (OQ-92). The refresh token is 256 random bits; only its SHA-256 is stored. Idle expiry 12 hours (renewed on each refresh), absolute expiry 7 days from sign-in (`created_at` of the first row is carried forward).
- **Reuse.** Presenting the hash of a `ROTATED` row revokes every live row of the family (`REFRESH_REUSE`) and writes `auth.refresh_reuse_detected`. Two simultaneous refreshes with one token: one wins, the other counts as reuse and revokes the family, so both callers are signed out (OQ-91).
- `AuthGuard` verifies the token, then asks the database on **every request** whether the session is live (not revoked, not expired, user not `DISABLED`), so a logout or revocation works at once although the token has not expired. Every failure is the same `401 UNAUTHENTICATED`. A partial token is accepted only by handlers marked `@AllowPartialSession()`: `/auth/mfa/*` and `/auth/logout`.
- The refresh cookie is `lc_refresh`: `HttpOnly; Secure; SameSite=Lax; Path=/v1/auth`, host-only (no `Domain`), `Max-Age` up to 12 hours. `/auth/refresh` is the only route that reads it and requires an `Origin` in `AUTH_ALLOWED_ORIGINS` (`403 FORBIDDEN` first, OQ-90). Token responses carry `Cache-Control: no-store`.
- `logout` revokes the family; `logoutAll` every live session of the user (partial ones too). Both clear the cookie.

**MFA.** TOTP is on `node:crypto` (RFC 4226 and RFC 6238, tested against their vectors): 30 seconds, 6 digits, one step either side, every step of the window compared in constant time. The secret (160 bits) is encrypted by the `SecretCipher` port (AES-256-GCM with `AUTH_ENCRYPTION_KEY` for local and test; the KMS adapter comes with P3-11, and the blob format has a version byte so an envelope format can follow) and bound to its row by the AAD `mfa_factor:<id>`. **Replay:** `mfa_factor.last_used_step` (new column, see the migration `20261125100000_mfa_factor_replay_and_lockout`) records the last accepted step, and a step at or below it is refused; the update is conditional, so one code cannot be accepted twice even by simultaneous requests. **Lockout:** `failed_attempts` and `locked_until` (also new): 5 wrong codes in a row lock the factor for 15 minutes (`OTP_LOCKED`, `Retry-After`); the right code is refused while locked; a right code clears the count. The same limits apply to `confirmMfaEnrolment`. Enrolment: `startMfaEnrolment` makes a pending factor (a new start replaces an unconfirmed one; `409` once a factor is verified); `confirmMfaEnrolment` activates it and returns 10 recovery codes once (HMAC-stored, `XXXXX-XXXXX`), and does not issue a session, so the sign-in that follows needs a *new* code (the confirming step is already used). Recovery codes cannot sign anyone in (OQ-35).
- `verifyMfa` with a **partial** session revokes it (`MFA_COMPLETED`) and starts a new full session with `mfa_verified_at` set (new `sid`, refresh cookie). With a **full** session it is a step-up: `mfa_verified_at` of the live row is set to now and a new access token carries `mfa_at`; no cookie. A user with no verified factor gets `403 MFA_ENROLMENT_REQUIRED`.
- `assertStepUp(session, clock, maxAgeSeconds = 300)` (in `sessions.ts`) throws `STEP_UP_REQUIRED` (`meta.maxAgeSeconds`) unless `mfa_verified_at` is no older than that (and not in the future). Read the session from the database (`authenticateSession`), never from the token alone. The `MfaGuard` of P3-04 calls it (section 8).

**Database contexts (RLS).** `otp_challenge` is `platform_only` and `app_user` writes need `id = app_user_id()`, so the flows before a user is known run with `withDbContext(prisma, { kind: 'system' })` as the `app_rw` login role: OTP request and verification, sign-in and user creation, refresh, and the session lookup of the guard (the case `db-context.ts` names: "finding a session by its token"). Once the access token has identified the user, the work runs as `{ kind: 'tenant', orgId: '', userId }`: no organisation, so the policies `own_user` (`user_session`, `mfa_factor`, `mfa_recovery_code`), `membership_visibility` and `user_visibility` apply and a user sees only their own rows. The organisation of a request is never taken from the client: `X-Active-Membership` and `membershipId` only choose among the user's own active memberships (`404 NOT_FOUND` otherwise), and the composite foreign key (C-06) backs that in the database.

**Audit** (same transaction, no codes, tokens, secrets or addresses): `user.create`, `auth.signin`, `auth.session_revoke`, `auth.sessions_revoke_all`, `auth.refresh_reuse_detected`, `auth.mfa_enrol_started`, `auth.mfa_enrol_confirmed`, `auth.mfa_verified`, `auth.mfa_locked`, `auth.membership_switch`.

**Tests.** Unit: `packages/core/src/identity/*.test.ts`, `apps/api/src/modules/identity/*.spec.ts`. Database (real tables, grants, RLS, `app_rw`): `packages/core/test/db/identity-*.test.ts` (`pnpm test:db`). HTTP (`contractRequest`, real database): `apps/api/test/integration/` (project `http-db`, run by `pnpm test:contract`; see TESTING_STRATEGY section 8).

**Contract and document differences.**
- The OTP is emailed through the `EmailSender` the notifications worker uses (`EMAIL_TRANSPORT`): SES when deployed, Mailpit over SMTP on a developer machine (`SMTP_HOST`). The API refuses to start in production or UAT without a real sender. The message is sent directly after the commit, never through the outbox, the `notification` table or the templates; a failed send gives a bare 500 with no detail, and the code and the address are never logged or kept in the error (OQ-172).
- ADR-006 and this document put throttles in Redis; the OTP limits are counted in the database (OQ-88).
- The contract requires `Idempotency-Key` on every identity POST; it is accepted and ignored (OQ-87).
- The contract's `refresh` says only "cookie scoped to the API domain"; the path is limited to `/v1/auth` as well.
- `getMe` and `setActiveMembership` accept full sessions only (a partial token is `401`, as the contract lists no 403).
- Sign-in limits are constants (OQ-85); `report.publish_mfa_max_age_seconds` (300) is the only key that exists, and `assertStepUp` takes the age as a parameter.

## 8. As built (P3-04)

Code: the framework-free part is in `packages/core/src/identity/` (`actor.ts`, `resource-checks.ts`, `tenant-scope.ts`, `repository.ts`, `membership-repository.ts`); the Nest part is in `apps/api/src/modules/identity/` (`membership.guard.ts`, `permission.guard.ts`, `mfa.guard.ts`, `authorised.decorator.ts`, `current-actor.ts`). The guards belong to the identity module (MODULE_BOUNDARIES: identity exposes "guards, `CurrentActor`"); another module imports `IdentityModule` to use them.

**Protecting a route.** `@Authorised({ permission: 'booking.decide' })` stacks `AuthGuard` → `MembershipGuard` → `PermissionGuard` → `MfaGuard` in that order and maps core errors to problem responses. The options are a union, so one of three must be chosen: `permission` (one code, or a list that needs **all** of them), `anyPermission` (a list that needs **one**), or `noPermissionRequired: true` (any signed-in actor, also one with no membership; the handler checks what it needs). `stepUp: true | seconds` adds `MfaGuard`'s check. The pieces are also exported on their own: `@RequirePermission(...)`, `@RequireAnyPermission(...)`, `@NoPermissionRequired()`, `@RequireStepUp(maxAgeSeconds?)`, `@CurrentActor()`. A code that is not a permission throws when the route is declared, so a typo fails at start-up.

**`PermissionGuard` fails closed.** A route behind the guards with neither a permission declaration nor `@NoPermissionRequired()` is `403 FORBIDDEN`, and so is a request that reaches it with no actor. The check is role level: a permission the role holds as ○ or ◐ passes the guard and is enforced again by the domain service (`grantsFor`; OQ-105).

**`CurrentActor`** (`{ userId, sessionId, membershipId, orgId, orgType, roles, permissions, siteIds, allSites, mfaVerifiedAt, isPlatform }`) is built once per request by `MembershipGuard` from the session and the database (`loadCurrentActor`, run as the user alone). Nothing of the request is an input except `X-Active-Membership`, which only chooses among the user's own active memberships (`404 NOT_FOUND` for any other value, OQ-108).
- It is read on **every request**, so a deactivated membership, a revoked role or a `SUSPENDED`/`CLOSED` organisation is refused at once with `403 FORBIDDEN` while the access token is still valid (OQ-106, OQ-109). `permissions` is the union of `permissionsOf(role)` over the membership's roles that fit the organisation type.
- A user with no active membership has an actor with no organisation and no permissions: only `@NoPermissionRequired()` routes serve it.
- `siteIds` are the live `membership_site` rows (lab members); an empty list means no site (OQ-110). Platform staff have `allSites` and `isPlatform`.
- **MFA.** `AuthGuard` already refuses a partial session everywhere but `/auth/mfa/*` and `/auth/logout`, which is what stops an MFA-required user who has not finished sign-in. As a second line `buildCurrentActor` refuses a membership with an MFA-required role when the session never completed MFA (`401 STEP_UP_REQUIRED`, `meta.reason = MFA_REQUIRED_FOR_ROLE`, OQ-107): a role gained after sign-in cannot slip through. `MfaGuard` then handles `@RequireStepUp` with `assertStepUp` on the session row `AuthGuard` loaded on this request (`401 STEP_UP_REQUIRED`, `meta.maxAgeSeconds`).

**Resource checks** (`resource-checks.ts`, used inside the service's transaction): `assertSameOrg`, `assertPartyOrg` (customer or lab of a booking), `assertSiteInScope`, `assertNotSameUser` (Maker is not Checker, `403 SELF_APPROVAL_FORBIDDEN`), `assertPermitted`, `assertVisible`, `assertAccess`. They throw `IdentityError`, which `@Authorised` maps to the problem response. The 404-versus-403 rule: the role-level 403 comes from the guard and does not depend on the resource; a resource that is unknown or out of the actor's scope is then 404; only an in-scope resource can be 403. Platform staff pass the organisation and site checks; their access is role-based (OQ-111).

**Platform staff and `x-roles`.** A platform actor has `isPlatform` and `allSites`, and runs in the `platform` database context. Admin routes use the same `@Authorised({ permission })` as any other; the contract's `x-roles` is not enforced separately, because that would be a second source of truth for who may do what. `apps/api/test/admin-roles-permissions.spec.ts` compares the two and prints the operations where no permission is held by exactly the roles `x-roles` names (10 of 73 today, OQ-112); it does not fail. Acting on behalf of an organisation is `TenantScope.runOnBehalfOf` (see TENANT_ISOLATION section 5).

**Not changed by P3-04:** `getMe` and `setActiveMembership` keep `AuthGuard` only (a user with no membership must be able to call them).
