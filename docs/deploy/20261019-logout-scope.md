# 2026-10-19 — Logout scope and owner session incident

## Approved change
Ordinary logout is local in Gestión (sidebar, mobile, suspended/denied access, all MFA screen exits, factor-add re-login) and Platform (sidebar and denied access). Existing workspace switch / active-tenant cleanup remain local. No automatic startup logout was found. New Configuración → Seguridad action explicitly revokes globally after confirmation, including this device; cancellation sends no request, duplicate confirmation is guarded, failure is visible and never automatically replayed.

## Other flows / scope decision
- Gestión RecoveryTokenSetup and Platform PlatformPasswordRecovery: after password save, explicit global logout, then return to login. If revocation fails, retain saved-password phase: retry only revocation; do not resubmit same password.
- Gestión InviteTokenSetup / InvitePasswordSetup and Platform InviteTokenSetup / InviteSetup: initial password / invitation activation, keep current onboarding session; not ordinary logout and no added global signOut.
- admin-users password update for another user: Auth admin.updateUserById, not caller signOut. GoTrue admin update calls User.UpdatePassword(tx,nil), which logs out all target sessions; no Edge change needed. Current upstream source inspected (internal/api/admin.go and internal/models/user.go); no password/reset experiment against real owner.
- Assisted MFA recovery: existing private.mfa_lock_recovery deletes all auth.sessions for target; stays global. Closing the locked screen itself is local and cannot unlock recovery.
- Auth errors: SDK removes its own invalid persisted session on terminal refresh failure; app does not issue global logout on 5xx/timeout/startup. Existing retryable-error resilience and MFA disabled fail-open preserved.

## Rollback recorded before publication
Gestión alias gestion.zenviacommerce.com: dpl_Fp5stLrGQMk34DMMjyrXsyjzrREX, zenvia-gestion-q9m6tnk2a-sergiorojasdiaz-7097.vercel.app, bundle index-DqlURX7K.js, main 7014c13a774c2646e0f036c577f5c0517a5a8a5a.
Platform alias admin.zenviacommerce.com: dpl_4hptdBNNaGyNLBo4fhLgGFuqSCa9, zenvia-platform-bdfamc6bq-sergiorojasdiaz-7097.vercel.app, main 853b8453caf4d381b94eb466ca4fffb9323944aa.
Instant Rollback per application to these deployments. Rolling back restores unscoped ordinary logout; it does not modify database, MFA configuration or Edge Functions.

## Evidence before merge
- Real supabase-js 2.105.0 offline two-device reproduction: default global invalidates other device and next refresh deletes persisted session; local preserves it. No real session revoked during tests.
- AST audit fails against all eight unscoped Gestión calls, passes after fix; Platform two ordinary exits similarly guarded.
- Component tests: cancel, explicit global scope, duplicate suppression, visible failure, password success/error and revocation-only retry.
- Gestión complete Vitest: 156/156; 1,130/1,130 Node tests and build pass. Platform complete suite: 248/248; build passes (local copied iOS icon matches Git blob 1977a9a27896f88f8dfa6d56c35d4ca0779e836a).
- Offline Playwright captures real SessionSecurity and shared ActionDialogHost with production CSS: security/confirmation/error, desktop/mobile, docs/deploy/logout-scope-review-20261019. Synthetic timeout fixture only in screenshot harness, all network blocked.
- Independent review found password-retry problem, corrected with regression test before release.

CI receipts and final deployment verification will be appended to the production audit branch after green checks/merge. No database/Edge/Auth configuration changes; MFA remains disabled with fail-open.
