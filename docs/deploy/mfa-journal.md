# MFA deployment journal — 2026-10-18

Status: **STOPPED / awaiting explicit Phase A approval**. No MFA activation or new deployment is authorized in this phase.

## Exact production reconciliation
- 20261016191517 — admin_mfa_security; SQL equals the repository migration exactly.
- 20261016194211 — admin_mfa_oauth_actor_binding; exact SQL match.
- 20261017192500 — admin_mfa_adaptive_recovery; exact SQL match.
- 20261018092127 (2026-10-18 **09:21:27 UTC**, 11:21:27 Madrid) — rollback_admin_mfa_pre_activation; the registered SQL matches the separately saved rollback script exactly (185,325 characters).
- The last script explicitly disables MFA, restores pre-MFA SECURITY DEFINER SQL, removes MFA policies, triggers, public/private functions and MFA tables, then reloads PostgREST. It is an explicit rollback, not an automatic Supabase rollback.
- The initiating actor and exact failed check are not included in schema_migrations; no specific failed pre-rollback check is proven by this record. Do not invent one.
- SQL state verified after rollback: configuration absent, 0 MFA policies, 0 MFA functions. 128 pre-existing public RLS policies, 77 triggers, 43 SECURITY DEFINER functions, 10 active cron jobs.
- app-agent-tools was restored from the stored exact production source snapshot; version number incremented but its two files match baseline byte-for-byte. All other 36 Edge Functions matched the backed-up checksums. PR #222 remains open.
- History is now mirrored under `supabase/migrations/` for **all four** applied operations; never rerun the original three merely because MFA objects are absent.
- Backups: `safety/mfa-production-snapshot-20261018`. Do not roll back the Amazon PII country guard, purge tombstones, leases, or auth resilience.

## Safe release structure: one phase per turn
**Phase A — SQL only (NOT STARTED):**
- Obtain explicit user approval for Phase A. Create a *new* versioned forward migration for MFA reinstallation, instead of reusing already-applied migration versions; make the first SQL transaction set and assert enabled=false, and be careful about name collisions with restored original functions/policies.
- Preflight migration history exact matching, complete rollback snapshot and service health, then apply SQL and test real active admin and ordinary authenticated AAL1 claims inside ROLLBACK, startup RPCs and primary table reads, and cron/worker/0 Auth 5xx.
- Journal exact SQL version, timestamp, before/after checks, rollback decision, and stop at end of turn. If any baseline regression, roll back promptly and journal.

**Phase B — Edge, at most 3–4 functions per turn (NOT STARTED):**
- Compare each actual deployed function and its shared dependencies against the pinned snapshot and new branch. Deploy a small batch, preserve verify_jwt and internal-service bypass, validate representative requests and worker/crons/5xx. Journal functions + new version + results and stop at end of turn.
- Resume only after the user approves the next batch. Do not redeploy automatic workers unless the actual bundle needs a compatible change.

**Phase C — frontend (NOT STARTED):**
- Merge #222 only after CI green on reconciled main and all Edge batches verified; confirm Vercel deployment/rollback target. User tests live login/refresh/logout before any pilot.
- Production Auth: TOTP enabled (max 10 factors), phone disabled, AAL1 sessions expire after 15 minutes when unchallenged with an enrolled factor. Login must promptly show the TOTP challenge.
- No global AAL2 activation without separate approval.

## CI
The previous pre-rollback branch commit `bea4b22476bb` passed build, Auth tests, MFA GoTrue/Vault integration. The newly archived historical rollback migration can execute during a disposable full migration reset and erase the MFA schema before integration scenarios. **Current branch CI must therefore be rerun and corrected safely before authorizing Phase A.** Never represent the old CI as green for the new commit.

## Current action
Only recorded exact rollback SQL in the repository. A CI workflow change to test forward migration and rollback separately was blocked by tooling; no CI green result or deployment is claimed.

## 2026-10-18 — forward reinstall prepared
- Created `20261018121500_admin_mfa_reinstall_after_rollback.sql` as one transaction containing the exact three prior MFA installation statements after an absent-schema assertion; final assertion enforces `enabled=false`.
- Does not modify applied migration history and must be run only once after historical rollback.
- CI on commit `8d826ef973307725bb12e6c9a38f03ee577fb1b7` started; results pending. No production SQL/Edge/frontend changes in this step.
- Stop conditions: if any CI fails, do not apply Phase A. If forward migration fails, no Edge/frontend changes.

## Phase A — production SQL applied 2026-10-18 10:21 UTC (2026-10-18 12:21 Madrid)
- User explicitly approved Phase A contingent on green CI. Commit 3908739b and earlier SQL commit 8d826ef9 passed Auth resilience, build, build-check, and actual Supabase GoTrue/Vault integration: [CI integration run 39118592522](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39118592522).
- Applied **only** `admin_mfa_reinstall_after_rollback` in one transaction. Production's migration registry version has been reconciled to `20261018121500` (matching the file); the prior four entries remain.
- Backend immediately after: `private.mfa_configuration.enabled=false`, 300 MFA restrictive policies, 428 total public RLS policies, 13 security_mfa RPCs, 10 active cron jobs.
- Inside `BEGIN ... ROLLBACK`, used real active admin and normal user identities with synthetic authenticated AAL1 claims, invoked `security_mfa_assert(false)`, `get_workspace_context()` and read app_users/workspaces/app_settings/products/clients/sales_invoices/fulfillment_orders/amazon_orders. **Both passed**.
- Amazon cron jobs 8 (*/5m) and 15 (02:30 UTC) remain active; most recent observed successful worker cron was 10:20 UTC. At 10:23 UTC, one Amazon sync job queued with attempts=1 and no held lease; awaiting the next scheduled worker cycle for final health confirmation, no automatic rollback triggered on a transient queued job alone.
- Auth logs checked 10:10–10:30 UTC: three records, 0 observed 5xx.
- **No Edge Functions or frontend were deployed.** No global AAL2 activation or factor registration performed. Stop here after final worker check; Phase B requires a separate user turn.

### Phase A post-deployment cycle observation — 2026-10-18 10:25 UTC
- Next worker pg_cron cycle (job 8) at 10:25:00 UTC: **succeeded**. Cron job 15 remains active and unchanged.
- Amazon 9 new sync jobs were enqueued at 10:25:04 UTC, four seconds **after** the 10:25 worker trigger. At 10:25:44 they remained `queued`, none held a lease. This is NOT evidence the 10:25 cycle failed or a verified drained queue; the next natural worker cycle is due at 10:30 UTC. Follow-up on these nine jobs is necessary, and the next phase must not begin if they become stuck. Do not falsely report queue empty.
- SQL registry version `20261018121500` is aligned with repository filename.
- Final Phase A scope: **SQL only**; Edge and frontend untouched. Stop before Phase B. No rollback because all AAL1/RPC/Auth 5xx/cron checks passed and the new queue batch has not yet missed its first eligible worker cycle.
