# 2026-10-19 — MFA reactivation preflight (NOT ACTIVATED)

## Phase 1: baseline and investigation
Owner present with two devices. Live baseline 21:24–21:31 UTC: enabled=false, cohort=NULL; principal active, two admitted and verified TOTP. No recovery lock writes in MFA audit today. Integrity activation guard: zero findings. 34 connections /90, 2 active; project ACTIVE_HEALTHY, shared_buffers512MB. Last-hour logs20:25–21:25UTC: zero PGRST003/57014 across all ten sources. Worker last hour: orders12, finances9, inventory9 successful, no failed/running; cron active and recent runs succeeded. These do NOT prove live CPU percentage; compute SMALL is the owner's recorded configuration, not a fresh CPU measurement.

## Server defect reproduced
No EXCEPTION handler exists in deployed security_mfa_status or mfa_error. SQL read/cancellation errors propagate; they are not converted to empty factor lists. The final status CASE does however map MFA_SESSION_REQUIRED and ACCESS_DISABLED to recovery_locked. Real PostgreSQL/PGlite reproduction with two verified admitted factors + missing session returns200 recovery_locked before the correction. Migration raises42501 for these errors; actual explicit recovery locks remain locked; unknown reasons raise55000. An injected internal57014 propagates without state mutation. Snapshot is supabase/rollback/snapshots/20261019-mfa-status-before.sql.

Historical limit: retrieved gateway POSTs07:00–13:00UTC contain200 responses and one401, not the reported503x3 sequence. The response body/reason of the reported200 was not logged, so the exact historical branch cannot be asserted from current evidence. Global logouts and refresh_token_not_found are present that morning, but no token-level correlation proves this particular200. Do not present the reproducible missing-session defect as a proven historical cause.

## Frontend correction
Enabled/unknown release mode: six-second read deadline, max3 reads separated by500/1500ms, then explicit Reintentar. Focus/visibility/token events cannot restart an exhausted budget; active token events cannot create unlimited superseding reads. Successful reads reset the budget. No signOut, credential removal or durable lock. Existing disabled fail-open remains intact. Tests cover503x3→manual200 with two factors, hung reads, active/exhausted event storms and stale-ready races. Production build flag is still false: do not claim enabled startup enforcement deployed until the activation release explicitly changes it and records frontend rollback.

## Phase 2: transaction rehearsal / identity correction
With cohort limited to owner inside BEGIN/ROLLBACK, bridge plan-sync=true and outside-cohort actor=true; a synthetic Platform actor using the pilot email=false. This is an intentional negative security control, not proof of a real Platform outage. Initial reporting wrongly treated it as a blocker before identifying the actual operator. Read-only verification in the independent Platform Auth project finds no account with pilot email; the active actual operator uses a different identity. Rehearsal with that actual actor's ID/email passes the live SQL bridge gate, as does plan-sync. No bridge protection was weakened. No real actor UUID/email is committed here. This validates SQL policy; no signed external bridge request under an uncommitted transaction was claimed.

Emergency switch tested inside BEGIN/ROLLBACK: enable single-owner cohort, disable enabled, assert disabled and cohort retained. Rollback restores enabled=false,cohortNULL. No factor/session changes or production revocations. Final live flag recheck required after every rehearsal.

## Publication policy
Corrections require green CI and backend snapshot/rollback rehearsal before application. No pilot activation while any required gate lacks evidence. No Auth settings, factors or bridge security weakening. Frontend rollback before corrections: dpl_5g5QN5ZfoW5BfjmPD7oR8BPgSAVH (index-DGoL6EBd.js), zenvia-gestion-3po88kwig-sergiorojasdiaz-7097.vercel.app.

Subsequent phase receipts belong on audit/production-resume-20261019 to avoid documentation-only production deployments.

## Phase 3: real database rehearsals, all rolled back
- SQL claims under authenticated: pilot AAL1 denied + challenge; current real AAL2 session/proof permits status and orders_dashboard_page_v1;3 outside admins and2 ordinary users unaffected. Plan sync permitted. Pilot-email negative control denies as intended; actual active Platform actor passes in a separate rolled-back rehearsal. These are SQL/role tests, not newly minted bearer tokens or an HTTP owner login.
- Exact production status reproduction: old function + two real admitted verified factors + absent session returns recovery_locked. Revised function raises42501 MFA_SESSION_REQUIRED. Restoring snapshot reproduces original canonical md5 6bec4d51a567fa26b8b6e6570a6f796b; principal stays active. Entire rehearsal ROLLBACK.
- Browser captures: real MfaProvider+MfaScreen, synthetic offline503x3 then manual retry→two-factor challenge, desktop/mobile. Three reads maximum, zero logout calls. No visual component/layout/copy changes; only context retry scheduling.
- Local Node suite initially1129/1130: existing Amazon forecast clock test fails when host's local date differs from Europe/Madrid/UTC. Re-running focused suite with TZ=Europe/Madrid passes19/19. Full Madrid suite1130/1130 passed; no unrelated product/test edits.

Independent review corrected active token-storm retry resets and stale identity after exhausted budget; regressions added. Local final Vitest165/165, Node1130/1130 in Europe/Madrid, build passed.

## Phase 4: corrective backend deployment (policy stays OFF)
- Original head4708cd963ffd4499cb72f4e1314fb50cfd56e9e9: all five workflows green, including real disposable GoTrue/Vault.
- Applied migration20261019214614_mfa_status_transient_errors (Supabase assigns application version; CLI-generated filename was renamed to match actual history). New status hash a18577108e2b660f8effe809b55e2663, old6bec4d51a567fa26b8b6e6570a6f796b.
- Post-apply: enabled=false, cohortNULL, activation guard0, anonEXECUTEfalse/authenticatedtrue. No factor/session/bridge/Auth configuration changes.
- Remaining activation gates: exact historical200 reason not recoverable from retrieved evidence; direct CPU measurement unavailable; activation frontend release must change the currently-false build flag and retain tested rollback. Keep policyOFF.
