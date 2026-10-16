# Administrator TOTP MFA implementation and release gates

Date: 2026-10-16. Base: `1225eaafdec01d1476e2a4a2faa424590f809685`. Branch: `feature/admin-mfa-20261016`.

**Local implementation only. No remote migration, deployment, push, merge, production user/session/factor access, or feature activation.** This document is not approval to enable MFA. External control-plane delegation and the combined OAuth release remain explicit blockers.

## Implemented behavior

The database owns activation/cohorts. `private.mfa_configuration.enabled` starts **false**; optional `cohort_user_ids` is server-only (`NULL` means all current administrative actors when enabled). A principal enrolled through the security process remains enforceable when enabled. During a pilot, newly created, promoted or reactivated tenant/platform administrators enter `bootstrap_pending`, independently of the pilot list. Browser fields, metadata roles and JSON actors cannot satisfy policy.

`MfaProvider` sits above `SettingsProvider`. Settings receives an explicit user ID only after backend status is ready. App profile/branding/data initialization, administrative mounts, usage writes and Shopify callback completion wait for that gate. Auth callbacks schedule work outside the SDK auth lock. Tenant/session/token changes and tab resume recheck authority. Generations reject stale results; a six-second deadline and AbortController bound only the status read. Failed/missing status RPCs block access and offer retry without signing out or deleting credentials. Non-Auth mutations do not receive a global timeout.

TOTP uses pinned Supabase JS 2.105.0. The SDK SVG data URI is displayed directly after format validation; QR/secret/code stay in component memory. Server preparation reserves the unverified factor for an authorized session. Verification creates a fresh challenge, preserves six digits including leading zeroes, verifies with Auth, then requests server admission. Scanning alone grants nothing. Challenge choices contain admitted TOTP factors. Recovery-locked users see the protected support route and their own eligible session reference for independent verification, never a public disable-MFA button.

Settings supports a second authenticator and explicit withdrawal. Addition requires recent proof from an admitted factor even while globally off; its intent binds the initiating session. Completion preserves previous admitted devices. Withdrawal requires recent proof and another admitted verified factor, removes database admission before Auth unenrollment, refreshes the session, clears scoped view cache and rechecks. Direct Auth deletion of the last factor cannot satisfy backend authorization when enforced. Unknown mutation results are never automatically replayed.

`sensitiveRPC` covers the seven maintenance/reset paths. Stable MFA errors open a challenge and ask the user to inspect the prior result and explicitly confirm again. Other Edge callers still receive backend denial even if their screen lacks an automatic challenge prompt.

## SQL and Edge boundary

`security_mfa_assert(p_recent)` is called using the received human bearer. PostgREST verifies that token; SQL uses trusted `auth.uid()`/`auth.jwt()` and live roles. MFA never makes a normal user an administrator. All existing permission, owner, tenant and workspace rules remain necessary.

For enforced privileged actors the guard requires exact `aal2`, the live matching `auth.sessions` row, `not_after`, security epoch, session `factor_id`, a current verified TOTP factor in the admitted list and a live Auth AMR row matching the token's TOTP timestamp. Critical operations require proof within five minutes; a new JWT `iat` cannot refresh old MFA. Explicit recovery/pending locks survive rollback. Session existence does not prove the Auth project's inactivity/single-session rules; real Auth tests remain mandatory.

Public function OIDs, ACLs, owners, signatures/defaults and dependencies are preserved. Human-executable public SQL/PLpgSQL definers are cloned privately; their original public bodies become guard+implementation wrappers. Clones retain configuration/strictness/volatility, with API execute grants revoked. Wrappers are deliberately **VOLATILE** so immutable originals cannot cache authorization in prepared plans. The private manifest stores original definitions and wrapper fingerprints. Machine-only definers/trigger functions remain unchanged. OUT/INOUT/variadic signatures fail preflight rather than receive a guessed wrapper.

Ordinary definer reads require admitted MFA, not a challenge every five minutes. `configuration_*` and names identifying purge/reset/workspace deletion/credentials/secrets/permissions require recent proof. Review classification whenever adding a sensitive RPC; naming does not replace inventory.

Existing RLS tables in `public` and `storage.objects` receive restrictive SELECT/INSERT/UPDATE/DELETE gates, retaining permissive owner/tenant policies underneath. Own-row bootstrap SELECT on `app_users`/`platform_admins` remains possible. The migration does not enable RLS on unprotected tables or change view semantics while off. These are activation blockers. `private.mfa_activation_findings()` reports exposed tables lacking gates, unsafe exposed views/materialized views and changed/unwrapped definers. A configuration trigger rejects activation or an enabled-cohort change while findings remain. This is a point-in-time check; subsequent schema/Edge changes require renewed review.

See [mfa-edge-inventory.md](mfa-edge-inventory.md) for all repository human Edge entries and alternate internal paths. Clients preserve the original human bearer even with a privileged API key. Critical user administration and credential actions request recent proof. Existing machine cron/worker authentication remains intact.

`platform-bridge` and the platform branch of `support-notify` fail closed when enforcement is enabled or a pending/recovery principal exists. The bridge secret and JSON actor do not prove human MFA. No protocol has been invented for the external control-plane. Bridge denial is an activation blocker, not implementation of that external endpoint.

## Assisted enrollment and recovery

Only service-granted security procedures authorize locked principals. They are not browser capabilities. Use an organizational operational path protected by MFA and independent approvals:

1. Verify established business identity and a previously registered independent contact route. Record the approval reference. A newly supplied email/password reset/document is insufficient.
2. `security_mfa_authorize_enrollment(user, reference, recovery)` locks the principal, clears admitted devices/intents, advances epoch, deletes that user's Auth sessions and audits the event. Initial controlled enrollment uses this same process; existing factors are never autoapproved.
3. Use Auth Admin to remove old verified factors after approval. Auth Admin credentials/deletion are not exposed through a public recovery endpoint.
4. The intended user signs in at AAL1. Independently verify that person's specific new session reference shown on the locked screen; a password holder's different session must not be approved.
5. After second approval, `security_mfa_release_enrollment(user, second_reference, approved_session_id)` requires a current user/session/epoch, no old verified factors and a different approval reference. It authorizes a 15-minute window bound to that session.
6. UI preparation/verification binds the new factor to the reservation, session factor, TOTP AMR and verified challenge. Completion consumes authorization, admits the device and audits completion. Replay fails. Add and test a second device.

The two reference strings are **audit evidence**, not cryptographic proof of two independent humans. Operational separation of duties and MFA-protected identities must be established/rehearsed before activation. The app adds no unauthenticated recovery-request endpoint; use the existing independently registered support route. Native recovery codes remain unimplemented/disabled pending pinned SDK/Auth staging validation.

A canceled/lost unverified QR never grants access. If its reservation survives a reload but the QR was not scanned, use approved operational reset rather than automatic replacement. Another session cannot consume a factor-add intent.

## Local evidence

All commands completed and exited zero after the implementation changes:

| Check | Result |
| --- | --- |
| `node --test scripts/*.test.mjs` | **991/991**, zero failed/canceled/skipped |
| `npm test` | **62/62**, five files; existing Auth **20/20**, MFA **42/42** |
| SQL cases | **23**, PGlite **0.3.14**, actual PostgreSQL **17.5** WASM engine |
| React/SDK boundary cases | **11**, controlled SDK/network doubles |
| Edge boundary cases | **8**, behavior plus source inventory checks |
| `npm run build` | TypeScript/Vite success; production iOS icon check passed |

The existing large-chunk warning remains. Auth negative tests intentionally log simulated network exceptions. SQL fixtures model required Auth metadata and representative functions/tables; they do not run the entire historical schema or GoTrue server.

Observed RED→GREEN regressions include AAL1 definer/direct-RLS denial, stale proof despite new JWT, immutable prepared-plan caching, rollback recovery/bridge locks, unauthorized enrollment, cross-session factor-add race, last-factor withdrawal, actual SDK QR format, status timeout and stale-response rejection. Harness/import setup errors were corrected before behavioral verification and are not counted as proof of security denial. Existing Edge doubles now return the guard RPC result while preserving business tenant/permission/idempotency assertions.

Parent read-only metadata checks found the required Auth columns and no currently exposed unsupported variadic/OUT/immutable/non-SQL-PLpgSQL definers. These read definitions/columns only, never Auth rows. Structural compatibility is not real factor/session proof or full migration validation.

## Activation blockers

- Rehearse over a full staging **schema** clone, comparing every signature/default/ACL/owner/config/dependency and machine-only RPC. Representative local fixtures do not prove whole-schema migration safety.
- Resolve every `private.mfa_activation_findings()` row. Review Storage, views/grants/security invoker and equivalent REST routes. Production data-surface closure is not established here.
- Test actual SDK+deployed Auth signature/issuer/audience/expiry, session-factor-AMR-challenge binding, refresh/revocation, direct last-factor deletion, backup-device recovery and network races. No live account was used.
- Implement/test brief, one-use, action/tenant/target-bound delegation in the external control-plane before reopening human bridge operations.
- The independent Amazon OAuth branch adds human/start/service paths outside this base. **Do not activate the combined release** until its human MFA start guard, trusted actor-session binding and live checks are implemented/reviewed. Its disabled flag does not prove combined closure.
- Pilot two independently controlled administrators/devices; rehearse identity checks, second approval and rollback. New promotions require controlled enrollment.
- Enforced rollout, observe-only telemetry, experimental recovery codes and production monitoring remain operational changes. This branch activates none of them.

## Rollback

Supported runtime rollback is an audited **server-only** change of `private.mfa_configuration.enabled` to false while retaining state, migration, SQL wrappers/RLS, Edge guards and recovery controls. There is no browser bypass. Pending/recovery locks keep denying after rollback; bridge stays closed while any lock exists. Local regressions exercise both properties.

Do not revert Edge to versions lacking human guards during recovery: privileged clients can bypass RLS. Do not blindly restore manifest originals or delete security tables/policies. The manifest supports a separately reviewed restoration after all accounts/alternate paths are resolved. No destructive uninstall script is supplied/executed.

## Official interfaces checked

- [Supabase changelog](https://supabase.com/changelog.md), fetched 2026-10-16. Recent TLS deprecation is a device QA item, not an MFA compatibility guarantee.
- [TOTP](https://supabase.com/docs/guides/auth/auth-mfa/totp) and [sessions](https://supabase.com/docs/guides/auth/sessions).
- Installed Auth JS `GoTrueClient._enroll` confirms `data:image/svg+xml;utf-8,...` QR format.
- Current official Auth [sessions.go](https://github.com/supabase/auth/blob/master/internal/models/sessions.go) and [amr.go](https://github.com/supabase/auth/blob/master/internal/models/amr.go) inform factor/AMR handling. Upstream master does not prove the deployed Auth version's behavior.
