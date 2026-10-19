# MFA pilot activation attempt — 2026-10-19
Baseline: project sjkxxbedkkmgmqnvaqjh; pilot UUID 7461b2b7-f383-460d-b1c7-6ccbb52e42b2; 2 verified TOTP; enabled=false, cohort_user_ids=NULL.
Baseline saved: docs/deploy/mfa-pilot-activation-snapshot-20261019.txt in this safety branch.
An atomic BEGIN/DO/COMMIT attempted single-cohort enable after identity, two-factor, baseline and rowcount assertions.
DB trigger private.mfa_configuration_guard rejected with P0001 MFA_ACTIVATION_BLOCKED; transaction rolled back.
Finding: public.security_mfa_rename_factor(uuid,text) — unwrapped or changed public definer.
Explicit emergency-off transaction updated singleton enabled=false; asserted enabled=false and cohort_user_ids IS NULL; committed.
Outcome: pilot NOT activated. No cohort RPC/Edge/platform-bridge claims can be made without activation. Do not bypass integrity guard. Remediate rename definer integrity and rerun real MFA tests before retry.
## Recovery checkpoint after interrupted connection
- Production schema_migrations: 20261019075300 mfa_rename_manifest_wrapper registered; earlier 20261018223844 mfa_rename_verified_factor retained.
- `private.mfa_activation_findings()` returns no rows. Rename manifest hash equals md5(pg_get_functiondef(function_oid)); implementation private.mfa_impl_rename_factor(uuid,text).
- Current singleton pre-activation enabled=false, cohort_user_ids=NULL; pilot has exactly 2 verified TOTP.
- PR #235 SHA 297ffa6aa5795aa4705abb13953751f4f18a957f has all 5 checks success (Build check, Gestión, Auth resilience, Playwright, real GoTrue/Vault).
- Production transaction with ROLLBACK simulated pilot enabled=true, single cohort. Pilot AAL1 `MFA_REQUIRED`, bridge denied. Non-cohort active admin and ordinary user with synthetic AAL1 `ready` / mfa_error=NULL and bridge allowed. system:plan-sync allowed.
- amazon-sync-worker, amazon-worker-maintenance and amazon-pii-purge-daily cron jobs active. No SQL modification from the simulation.
- Emergency command from snapshot ready: `BEGIN; UPDATE private.mfa_configuration SET enabled=false WHERE singleton=true; COMMIT;` followed by readback.
