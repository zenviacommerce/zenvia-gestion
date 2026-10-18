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

### Phase B batch 2 / step 1 — app-agent
- 2026-10-18: installed Edge app-agent v20 (baseline snapshot v19) preserving verify_jwt=true and baseline logic plus MFA guard. Safe unauthenticated probe: before HTTP 401 `Sesión no válida.` (request 1578), after same HTTP 401/body (1581).
- No real privileged agent operation executed. Rollback source: safety/mfa-production-snapshot-20261018, edge-20261018/app-agent.json. Batch not closed.

### Phase B batch 2 / step 2 — customer-billing
- Deployed v10 (baseline v9), verify_jwt=true. Before safe probe 1579 HTTP 401 `Sesión no válida.`; after safe probe 1584 HTTP 401 with identical body. No billing mutation. Exact rollback snapshot: edge-20261018/customer-billing.json.

### Phase B batch 2 / step 3 — support-notify
- Deployed v11 (baseline v10), verify_jwt=false preserved, original production support helper with MFA additions. Before safe probe 1580 HTTP 401 `Sesión no válida.`; after probe 1585: see completion entry below. No message sent. Exact rollback snapshot: edge-20261018/support-notify.json.

### Phase B batch 2 CLOSE — 2026-10-18
- Exactly 3 **non-shipping, non-Amazon** Edge functions deployed: app-agent v20 (pre v19), customer-billing v10 (pre v9), support-notify v11 (pre v10). No frontend changes, no merge, no shipping labels, no transport calls. MFA remains enabled=false.
- Safe unauthenticated POST probes against the real routes matched baseline response 401 `{"error":"Sesión no válida."}`: app-agent 1578 -> 1581; customer-billing 1579 -> 1584; support-notify 1580 -> 1585. No workspace side effect or billing/support email sent. No internal workspace probe was needed for these non-shipping paths; internal HTTP 200/zero-operation tests remain mandatory for subsequent logistics/shipping batch.
- Function logs queried after deployment for exact function UUIDs between 10:40 and 11:20 UTC: app-agent 2 records, customer-billing 2 records, 0 observed 5xx or messages containing 'error' in either. support-notify logs: no corresponding function_edge_logs records yet; therefore logging evidence **inconclusive**, although live safe probe returned the same HTTP 401. Do not claim zero errors for a log stream with zero records.
- Amazon nine jobs enqueued 10:35:02 UTC: 8 success initially, last queued after AMAZON_QUOTA_429 backoff (max 5 attempts); by verification after 10:45 UTC, 9/9 success, 0 failed, all one attempt in stored records, 0 held leases. Worker cron at 10:45 UTC succeeded. No Amazon worker or PII cron changes.
- 15 changed human-facing Edge entrypoints in #222; 6 deployed in batches 1 and 2; **9 remain**: admin-users, integration-accounts, platform-bridge (non-shipping); envia-shipping, mrw-shipping, order-logistics-state, sendcloud-order-tools, sendcloud-orders, shopify-orders (shipping/logistics).
- Proposed next batches: batch 3 (3): admin-users + integration-accounts + platform-bridge, preserving internal bypass and verifying internal nonmutating probes; batch 4 (3): order-logistics-state + sendcloud-order-tools + shopify-orders; batch 5 (3): envia-shipping + mrw-shipping + sendcloud-orders. For both shipping batches require before/after safe internal workspace-id-missing request returning 200 with zero operations (or skip any endpoint lacking such a side-effect-free test) and individual log reviews. Any Amazon shared-module-dependent Edge bundles must be assessed and placed **last**, separately from these nine; validate them with one complete scheduled worker cycle and no queue regression.
- Rollback exact version/source snapshots: `safety/mfa-production-snapshot-20261018/supabase/rollback/snapshots/edge-20261018/{app-agent,customer-billing,support-notify}.json`. Restore source bundle and verify_jwt if regression observed. **STOP** after this batch; user approval required for further batches.

### Phase B batch 3 preflight — STOP before any deployment (2026-10-18)
- User authorized batches 3 and 4 conditionally, with explicit pre/post authorized Amazon credentials retrieval on `integration-accounts`, explicit nonexistent-account error and unchanged real administrator reads in `admin-users`. All 3 batch-3 Edge functions remain at their pre-MFA versions: integration-accounts v42, admin-users v26, platform-bridge v29. No batch-4 deployments.
- MFA enforcement remains `enabled=false`, cron jobs 8/15 are active. Preflight source review confirms `integration-accounts.authenticate()` requires human JWT before list/credential paths; `admin-users` similarly requires a valid JWT and admin membership before `list`. A service_role key alone does **not** exercise the required paths; unauthenticated 401 is not an adequate test. No user JWT was available in this session and no credential values were read or exposed. No temporary privileged bypass was created.
- Therefore tests required to safely prove the credential fallback/Vault path and administrator list equivalence cannot be performed with the current caller context. Deployment skipped rather than accepting a false passing result. Needed: a narrowly scoped, verified identity/session-based test harness or an authorized existing session that can perform readonly before/after comparisons without exposing credentials; user approval may be required. Do not begin batch 4 until batch 3 passes.
- support-notify widened log query 2026-10-17 11:00 UTC to 2026-10-18 11:00 UTC: two function_edge_logs entries, zero messages containing 'error'; logging gap now closed for that observed scope. HTTP 401 probe matched pre/post in prior batch.
- Existing snapshot rollback remains on `safety/mfa-production-snapshot-20261018`. No rollback needed because batch 3/4 were not deployed. No new transport/shipping/Amazon API calls made.

### Phase B batch 4 preflight — STOP without deployment (2026-10-18)
- User separately authorized batch 4 (order-logistics-state, sendcloud-order-tools, shopify-orders), requiring internal workspace-not-found HTTP 200/zero operations before and after deployment; no transport or shipping mutations.
- Live baseline probes with workspace `00000000-0000-0000-0000-000000000000` / nonexistent order or Shopify integration: requests 1594, 1595, 1596 respectively. **All three returned HTTP 401 `{"error":"Sesión no válida."}`, NOT HTTP 200**. No operations occurred, no real carrier or Shopify calls.
- Source review confirms all three authenticate with `admin.auth.getUser(token)` before applying requested workspace/account/order filters. Production service_role API key alone does not represent a valid human JWT. These are human-authenticated routes, not internal service-only zero-operation routes.
- Therefore prerequisite cannot be satisfied with existing available credentials; do not claim HTTP 200, do not deploy just to test 401, and do not add an insecure service_role bypass. All three functions remain unchanged at baseline versions: order-logistics-state v15, sendcloud-order-tools v33, shopify-orders v11.
- For future authorized pre/post test, an already authenticated admin can exercise a read-only nonmutating action involving an inaccessible/absent order/integration; this may return a deliberate 404/400 rather than 200. Alternatively implement a separate safe service-only diagnostic in a tested branch, explicitly constrained to nonexistent workspace and zero operations, and obtain approval for that scope. Do not fabricate 200/zero success.
- No lot 3 changes and no lot 5/Amazon changes. MFA enabled=false unchanged. No rollback necessary.

### 2026-10-18 — Production URL and user browser baseline
- CORRECTION: production web URL is **https://gestion.zenviacommerce.com**. The earlier `zenvia-gastos.vercel.app` address is obsolete (404); do not use it for checks.
- User's genuine admin session BEFORE batches 3/4: Administración → Usuarios y accesos **5 users / 5 active / 3 admins**, full permissions visible. Configuración → Integraciones: Amazon **ZENVIA COMMERCE SL** default/connected, **2 Shopify** accounts, Sendcloud, Envia.com, MRW visible; no `Probar conexión` attempted. Pedidos: **11 pending (9 Amazon, 2 Shopify), 108 sent, 4 canceled**, console no errors.
- Explicit approval for batch 3 then batch 4, per-function journal+rollback, STOP before batch 5/Amazon/frontend; user will do matching AFTER browser checks.

### Batch 3 / step 1 — admin-users
- Deployed production Edge admin-users v27 (baseline v26), `verify_jwt` preserved. Actual user BEFORE check: 5 users, 5 active, 3 admins. User AFTER browser verification pending. Rollback source: safety/mfa-production-snapshot-20261018, edge-20261018/admin-users.json.

### Batch 3 / step 2 — integration-accounts
- Deployed v43 (baseline v42), original JWT requirements and Vault/Amazon account logic retained, MFA guard added; `verify_jwt=true` preserved. BEFORE: user's admin session sees ZENVIA COMMERCE SL as default connected, two Shopify accounts, Sendcloud, Envia.com and MRW; no Probar conexión. AFTER admin browser verification pending; no credentials or tokens returned by deployment checks. Exact rollback source edge-20261018/integration-accounts.json on safety branch.

### Batch 3 / step 3 — platform-bridge
- Deployed v30 (baseline v29), `verify_jwt=false` preserved, existing x-platform-token authentication preserved and MFA bridge guard added. User BEFORE tested administrative app and integrations, but Platform browser AFTER verification still pending. No plan/customer mutations. Exact rollback source edge-20261018/platform-bridge.json on safety branch.

### Batch 4 / step 1 — order-logistics-state
- Deployed v16 (snapshot v15), verify_jwt=true preserved, original user-session authentication, order data and PII guards retained; MFA guard added. No order or shipment created/modified; no carrier requests. Baseline nonexistent workspace/order internal-key probe #1594 HTTP 401 (not 200; user JWT required). Safe post-deploy probe pending; browser AFTER check pending. Rollback source safety/mfa-production-snapshot-20261018/edge-20261018/order-logistics-state.json.

### Batch 4 / step 2 — sendcloud-order-tools
- Deployed v34 (snapshot v33), verify_jwt=true preserved; existing code and order/PII guards retained with MFA guard. No label generation, booking, address validation, shipping-options or carrier calls made. Baseline nonexistent-workspace/order probe #1595 HTTP 401 (authentication enforced before workspace lookup); after-deployment safe probe pending. Exact rollback source edge-20261018/sendcloud-order-tools.json on safety branch.

### Batch 4 / step 3 — shopify-orders
- Deployed v12 (snapshot v11), verify_jwt=true preserved, original Shopify sync and data-mapping logic retained with MFA guard. No real Shopify sync, order mutation or outbound Shopify API executed. Baseline request #1596 with nonexistent integrationAccountId/workspace returned HTTP 401 because a valid human JWT is required; identical post-deploy probe pending. Exact rollback source safety/mfa-production-snapshot-20261018/edge-20261018/shopify-orders.json.

### Phase B batches 3 + 4 CLOSED — awaiting user AFTER browser test
- Production URL corrected to https://gestion.zenviacommerce.com. User's BEFORE session baseline: Administration 5 total/5 active/3 admin; integrations Amazon ZENVIA COMMERCE SL connected/default, two Shopify, Sendcloud, Envia.com, MRW; Orders 11 pending (9 Amazon,2 Shopify), 108 sent,4 canceled; no browser-console errors.
- Batch 3 completed: admin-users **v27**, integration-accounts **v43**, platform-bridge **v30**. Batch 4 completed: order-logistics-state **v16**, sendcloud-order-tools **v34**, shopify-orders **v12**. Journal entries were committed immediately following EACH deployment. Preexisting verify_jwt values preserved. No AWS/Amazon/carrier actions or business mutations triggered by deployment checks.
- Safe POST results: admin-users #1606 = 401 Sesión no válida; integration-accounts #1607 = 401 Sesión no válida; platform-bridge #1608 = 401 Puente no autorizado. Logistics: order-logistics-state baseline #1594 and post #1612 = identical 401 Sesión no válida; sendcloud-order-tools baseline #1595 and post #1613 identical 401; shopify-orders baseline #1596 and post #1614 identical 401. The user JWT is validated before workspace filter, so the requested internal HTTP 200 zero-operations is **not available** via service-role only; do not claim that result. No unsafe bypass was added.
- Queried function_edge_logs for exact six function UUIDs: admin-users 6 entries, integration-accounts 3, platform-bridge 8, order-logistics-state 4, sendcloud-order-tools 2, shopify-orders 844 over available queried log period, zero error-mention/5xx according to that log query. This is not an authenticated full-flow test.
- MFA flag remains `enabled=false`; Amazon cron 8 and PII cron 15 remain active. Amazon jobs at final check: 46,702 success, 853 superseded, no queued/failed. No worker changes.
- **User AFTER browser test PENDING**: same 3 screens (Administración → Usuarios y accesos, Configuración → Integraciones and Pedidos), exact counts and console errors, plus Zenvia Platform if used. Await user verdict before any further deployments or frontend merge.
- Snapshot rollback sources for 6 funcs: `safety/mfa-production-snapshot-20261018/supabase/rollback/snapshots/edge-20261018/<slug>.json`, preserve original files and verify_jwt. No failure requiring rollback was observed in safe probes; user-reported regressions demand immediate restoration.
- **STOP. Do not deploy batch 5, Amazon functions, or frontend in this turn.**

### 2026-10-18 13:29:29 UTC — user transient FunctionsFetchError investigated
- User AFTER batch 3/4: admin users 5/5 active/3 admins, integration list unchanged, orders 13 pending (11 Amazon,2 Shopify),108 sent,4 canceled, no reproducible error after reload. One FunctionsFetchError at 13:29:29 UTC when opening Integrations / Pedidos.
- Inspected function_edge_logs 13:28:30–13:30:30: 10 requests, 0 logged 4xx or 5xx; around 13:29:29, envia-shipping POST 200 (13:29:28), sendcloud-orders OPTIONS 200 (13:29:30) and POST 200 (13:29:31), amazon-confirm-shipment OPTIONS 200 (13:29:31) with no corresponding POST in the narrow window. The missing POST is not proof of a specific failure; network/browser transport or CORS completion could fail before function logging. No attributed function or definitive root cause found.
- Compared CORS/OPTIONS statements between production snapshots and branch for admin-users, integration-accounts, platform-bridge, order-logistics-state, sendcloud-order-tools, shopify-orders: exactly identical. No CORS regression in those files. Existing console error occurred once and did not recur after reload; no rollback warranted on available evidence. Do NOT claim cold-start cause verified.
- Phase B batch 5 authorized conditionally, with no real carrier calls, labels or shipments; journal after each Edge function.

### Phase B batch 5 / function 1: envia-shipping
- Deployed **v42** over snapshot v41, verify_jwt=true preserved, original shipping/PII files retained with MFA guard. Before invalid-session, nonexistent-workspace probe #1707 returned HTTP 401 Sesión no válida. No carrier/label/shipment calls. Post-deploy comparison and logs pending. Exact rollback: safety/mfa-production-snapshot-20261018/supabase/rollback/snapshots/edge-20261018/envia-shipping.json.
