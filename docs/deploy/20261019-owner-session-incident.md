# Owner session loss — investigation19 October2026

No application or Auth configuration changes, no production writes or deployment. Investigated requested17:40:26–19:40:26UTC window, then expanded back to16:00 because the invalidation predates the reported observation.

## Confirmed evidence (Europe/Madrid)
-18:19:54: Windows Chrome owner refresh succeeded (HTTP200).
-19:12:11: iPhone sent POST /auth/v1/logout?scope=global; authenticated owner event logout; HTTP204. Scope is present in gateway URL, not inferred from the audit label.
-19:12:20: iPhone passkey login succeeded.
-19:12:44: iPhone TOTP verification succeeded.
-19:18:54: Windows Chrome from same address/user agent as earlier owner refresh received400 refresh_token_not_found. Error log lacks user ID; attribution of this row uses address/user-agent/time correlation. Do not mistake correlation for a token-level trace.
-20:14:48 and21:40:00: owner iPhone token refresh HTTP200. token_refreshed and token_revoked share request IDs: normal rotation, not proof of reuse-family detection.
-21:37 approximately: PR247 deployed after Windows refresh failure.

Current auth.sessions contains one owner iPhone session, AAL2, created19:12:20, refreshed21:40:00, not_afterNULL. No logout, refresh-token/session-expiry errors in the requested two-hour Auth window. No refresh_token_already_used/reuse-detection event found. Global Auth timebox/inactivity settings were NOT read (connector exposes no config read); current session metadata is not a substitute for those global settings.

## Cause and limits
Confirmed cross-device invalidation mechanism: explicit global logout request from iPhone. Installed auth-js2.105.0 signOut default scope=global. Eight ordinary UI signOut() calls omit scope (App4, MfaDevices1, MfaScreen3); only explicit onClick/onLogout handlers, no automatic startup signOut found. Tenant switching already uses local scope. SDK clears persisted session on terminal refresh failure, explaining missing storage. Cannot identify which iPhone button/action generated request from server logs. Does not establish the cause of the earlier PR237 incident without separate correlation.

PR247 changed only Shopify service/cards in src; no Auth/MFA startup change. MFA AAL2 does not protect against intentional global sign-out. Expiry is not the evidenced cause of this invalidation.

## Proposed correction (not implemented)
Centralize ordinary logout in signOutCurrentDevice using auth.signOut({scope:'local'}); use it in all eight ordinary controls, including MFA logout/relogin. Local scope signs out shared tabs of the current session/browser while preserving other devices. Reserve global scope for an explicitly labelled all-sessions action. Do not remove SDK cleanup after an actually revoked refresh token and do not revive revoked credentials.

## Reproduction tests
 tests/auth-logout-scope.incident.test.ts uses REAL supabase-js2.105.0 with two independent synthetic storage stores and controlled offline GoTrue responses. Default logout emits scope=global; other browser's next refresh400 removes its persisted session. Explicit local logout preserves other browser's refresh/session. Both tests pass. This is SDK/client behaviour against a simulated Auth server, not a live production revocation experiment.

## Separate retry concern
fetchWithAuthTimeout performs one underlying fetch per invocation; it maps5xx to AuthRetryableFetchError. auth-js _refreshAccessToken retries that class with backoff and the same refresh token. This is a real design surface to audit (ambiguous timeout after server rotation, lost response, multiple tabs), but no such incident is evidenced in this trace. Do not fix it by blindly converting transient refresh errors to terminal errors: SDK would erase otherwise recoverable sessions. Proposed additional regression cases: rotated response lost, expired reuse window, cross-tab lock/re-read, genuine revoked token and outage preservation before changing retry policy.
