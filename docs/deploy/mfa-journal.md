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

## Pre-Phase B checks — 2026-10-18 10:31 UTC
- Amazon cycle job 8 at 10:30 UTC succeeded. Exactly nine Amazon jobs created at 10:25:04 reached `success`, one attempt each, and all released leases by 10:30:20 UTC. Zero failed among that cohort.
- All 300 MFA RLS policies use `(SELECT private.mfa_allowed())` initPlan; `mfa_allowed`, `mfa_error`, `mfa_required` are STABLE and have explicit `search_path=''`.
- Pre-optimization AAL1 EXPLAIN ANALYZE average milliseconds (three warmed runs): fulfillment_orders 4.601, products 0.641, sales_invoices 0.667; dropping only MFA policies inside rolled-back transaction: 0.415, 0.401, 0.434.
- Fast-path SQL proposed `20261018123000_admin_mfa_rls_fast_path.sql`: when disabled, check only account recovery locks; otherwise retain original `mfa_error(false)` behavior. Tested inside BEGIN/ROLLBACK: average milliseconds 1.090, 0.642, 0.603 (four runs). CI was started; **do not deploy SQL optimization or any Edge batch until MFA integration CI passes and optimization is applied/verified**.
- `pg_stat_statements` historical query means mix pre/post Phase A and cannot prove an isolated before/after; EXPLAIN transaction tests are the controlled comparison.

### 2026-10-18 10:34 UTC — RLS fast-path verified and applied
- Migration `20261018123000_admin_mfa_rls_fast_path.sql` applied to production; registry version aligned to the file version.
- Green integration run [39119496157](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39119496157) plus green build/Auth tests on commit `92b20107`.
- Production AAL1 synthetic admin and ordinary user RPC and list reads inside ROLLBACK passed after optimization; MFA still disabled.
- Amazon 10:25 cohort nine jobs all `success` with one attempt, 0 failed/active leases, finishing in 10:30 worker cycle. No worker/cron changes.
- Phase B **not yet begun** at this journal entry; plan small batch of 3 non-Amazon/non-shipping Edge Functions. Snapshot located on `safety/mfa-production-snapshot-20261018`.

### Phase B batch 1, step 1 — app-agent-tools
- Deployed version 6 using archived production bundle + MFA shared guard, verify_jwt=true. Pre-deployment probe (request 1569) returned HTTP 401 `Sesión no válida.`; post-deployment (1572) returned exactly HTTP 401 and same body. No authenticated user-flow test performed.
- Rollback: source files in `safety/mfa-production-snapshot-20261018/supabase/rollback/snapshots/edge-20261018/app-agent-tools.json`; deploy source preserving verify_jwt.

### Phase B batch 1, step 2 — invoice-document-intelligence
- Deployed version 8 with unchanged business source plus MFA guard, verify_jwt=true. Pre probe request 1570: HTTP 401 `Sesión no válida.`; post probe 1573: HTTP 401, same body. No authorized user flow exercised.
- Rollback source snapshot: `edge-20261018/invoice-document-intelligence.json` on safety branch.

### Phase B batch 1, step 3 — transport-tariff-parser
- Deployed version 13, using archived configuration verify_jwt=true and the new MFA guard. Pre probe 1571: HTTP 401 `Sesión no válida.`; post probe 1574: HTTP 401 and same body.
- Rollback source snapshot: `edge-20261018/transport-tariff-parser.json` on safety branch.
- This batch performed only safe invalid-session probes, not a complete real authorized-user transaction. Before the next batch or UI release, perform an authorized interaction test through the browser as agreed.

### Phase B batch 1 — completed 2026-10-18 ~10:36 UTC — STOP
- The first batch consists of exactly 3 Edge Functions and no others: `app-agent-tools` (v6), `invoice-document-intelligence` (v8), `transport-tariff-parser` (v13). All were deployed using the original `verify_jwt=true`, retained production entrypoint logic plus shared MFA guard. No Amazon/shipping workers, no main merge, no Vercel frontend.
- Each pre- and post-deployment safe invalid-session HTTP POST probe returned **401** with identical `{"error":"Sesión no válida."}` body. Baseline request IDs: 1569,1570,1571; post: 1572,1573,1574. These do not establish a full logged-in user functional test; such a test remains pending.
- MFA SQL enabled=false, 300 public MFA policies (additional 4 policies in private schema; total count without schema filter is 304). 10 cron active. Latest observed Amazon job 8 cron at 10:35 UTC succeeded; nine newly queued jobs were created at 10:35:02 UTC after that cycle, for the next worker run.
- Auth 5xx in 10:30–10:45 log window: 0 among 0 available records; cannot claim observed requests or end-to-end login success.
- RLS fast-path already deployed and tested: post-deploy four-run EXPLAIN averages: fulfillment_orders 1.567ms, products 0.662ms, sales_invoices 1.051ms; benchmark variability exists. Historic pre-optimization fulfillment_orders average was 4.601ms and without MFA policies in rolled-back transaction was 0.415ms. No per-row MFA invocation in policies.
- Source backups for each deployed function: `safety/mfa-production-snapshot-20261018`. On failure restore exactly saved files and verify_jwt and record new versions. The three deployments passed safe access probes.
- **Stop here; next Edge batch requires a separate user turn. No global AAL2 activation.** Before batch 2 confirm new 10:35 Amazon jobs cleared and perform supported authorized functional tests where available.
