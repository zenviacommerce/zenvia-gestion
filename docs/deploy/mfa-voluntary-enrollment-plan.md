# MFA voluntary enrollment — release plan (NOT APPROVED FOR DEPLOY)

Branch: `feature/mfa-voluntary-enrollment-20261018`. This is a planning document; it does not authorize production changes.

## Rationale and current risk
Supabase Auth limits an enrolled TOTP user's unchallenged AAL1 session to 15 minutes, independently of `private.mfa_configuration.enabled`. The MFA status RPC previously returned `ready` for all outside-cohort users, even when they had an admitted verified TOTP. It also hid `MfaDevices` with zero factors. Directly enabling cohort for an un-enrolled administrator would yield `recovery_locked`.

## Behavior proposed
- Admin without any verified GoTrue factor can press **Añadir autenticador** on Configuración regardless of flag/cohort when MFA not mandatory.
- `security_mfa_begin_self_enrollment()` is authenticated, SECURITY DEFINER, checks active admin, real Auth session, not required, no verified TOTP, no existing principal except expired self-enrollment. Writes an audit event.
- A distinct `self_enrollment_pending` state is session-bound and expires after 15 minutes. Expiration returns to optional `ready`, not recovery_locked; a retry creates a new authorization. A verified-but-unadmitted factor instead requires protected recovery (no self-service bypass).
- Existing `security_mfa_prepare_enrollment` and `security_mfa_complete_enrollment` admit this new state with current-session checks, GoTrue verified factor, challenge, AAL2, AMR evidence. An initially authenticated valid session can precede self-initiation, unlike service-led recovery.
- The existing `security_mfa_begin_factor_add` remains the second-factor flow and requires fresh AAL2. The recovery functions and their service-only permissions remain unchanged.
- `security_mfa_status()` emits `challenge_required` whenever an admitted verified TOTP exists and JWT is not AAL2, even when enabled=false/outside cohort. Auth sign-in and refresh drive MfaContext rechecks. There is no 15-minute AAL1 timer to wait for because the challenge appears immediately.
- An enrolled verified factor without app admission fails closed with `recovery_locked`, not an unsafe bypass.

## Prerequisites / CI release gates (PENDING)
- Build, Vitest UI/SQL, full disposable GoTrue/Postgres/Vault integration must be green **on this branch SHA**. Do not describe tests as passed without workflow evidence.
- Tests: voluntary first factor while disabled; second factor; AAL1 login challenge outside cohort; AAL2 refresh; no-factor user unaffected; deny self service after verified factor and during recovery lock; test expired session-bound authorization.
- Disposable local Supabase Auth must have TOTP enabled. Simulating the **hosted Auth AAL1 15-minute limit** is not established in the current CI fixture; verify on a non-production isolated Auth project with the same session setting (or via a short test limit when available), never by modifying production Auth settings.
- Compare exact live SQL definitions and migrations. Confirm schema collisions and PostgREST RPC visibility. Confirm current normal RLS, Amazon worker, Auth error baseline, Platform bridge v31 and Vercel rollback targets.
- Security review: real actor role, no verified factor, existing principal states, RLS/SECURITY DEFINER and privileges; adversarial concurrency of two initial starts and third-party verified factors.

## Phased release (each phase requires explicit user approval)
**Phase 1 — SQL ONLY**
- Snapshot exact existing function definitions/ACL/config/cron; verify rollback script first; deploy only `20261018214155_mfa_voluntary_first_factor.sql`, leaving `enabled=false`, `cohort_user_ids=NULL`.
- Verify function exists, execute denied for anon/normal users, service recovery unchanged, voluntary admin possible, no verified GoTrue factor bypass. Record version, UTC, SQL tests, Auth 5xx/worker health, rollback.
- SQL rollback preparation: restore prior exact `security_mfa_status`, `prepare_enrollment`, `complete_enrollment` definitions/ACL from production snapshot; revoke/drop self RPC; remove `self_enrollment_pending` constraint alternative only after verifying no principal remains in that state. Never execute destructive rollback blindly with active enrollments.
- STOP after phase, no frontend in same turn.

**Phase 2 — Edge**
- No Edge changes currently required. If an unforeseen dependent Edge change is discovered, separate explicit approval, 1–3 functions max, baseline snapshots and safe probes. Otherwise record phase as not applicable and do not deploy any function.

**Phase 3 — frontend**
- Merge reviewed PR only after SQL verification, green CI, and a known Vercel instant-rollback deployment ID; warn user before and after because screens change. No MFA activation.
- User browser checks: previously unenrolled admin sees security card; initiates first enrollment, QR, verifies code, sees factor count 1; re-login triggers code despite disabled; register second factor via recent AAL2 and independently test both after sign-in. Confirm ordinary non-enrolled account unaffected, Platform bridged reads unchanged, console clean.
- If a regression occurs revert Vercel deployment; do NOT turn on MFA as a workaround. Journal every change and STOP after browser acceptance.

**Future pilot (not in this release)**
Only after two independently verified TOTP and successful login/refresh tests for the target Gestión Auth UUID, explicitly approve single-user cohort activation with kill switch `UPDATE private.mfa_configuration SET enabled=false WHERE singleton=true;` and a rollback transaction. Refresh login for target because the original enrollment session may predate principal `not_before`. Validate outside-cohort users and Platform service operations before expanding enforcement.
