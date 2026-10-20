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

### Phase B batch 5 / function 2: mrw-shipping
- Deployed **v22** over snapshot v21, verify_jwt=true preserved, original MRW transport/PII shared files retained with MFA guard. Before invalid-session nonexistent-workspace probe #1708 was HTTP 401 Sesión no válida. No shipment/label/transport operation executed. Post probe and log review pending. Exact rollback: safety/mfa-production-snapshot-20261018/supabase/rollback/snapshots/edge-20261018/mrw-shipping.json.

### Phase B batch 5 / function 3: sendcloud-orders
- Deployed **v32** over snapshot v31, verify_jwt=true preserved; original Sendcloud operations and Amazon buyer PII guard files retained, MFA guard added. Before invalid-session nonexistent-workspace probe #1709 returned HTTP 401 Sesión no válida. No carrier/label/shipment operation executed. Post probe and log review pending. Exact rollback: safety/mfa-production-snapshot-20261018/supabase/rollback/snapshots/edge-20261018/sendcloud-orders.json.

### Phase B batch 5 CLOSED — 2026-10-18, STOP
- Deployed precisely three transport functions: envia-shipping **v42** (from v41), mrw-shipping **v22** (from v21), sendcloud-orders **v32** (from v31). Committed journal immediately after EACH function.
- Baseline safe invalid-session+nonexistent workspace requests: IDs 1707,1708,1709; post-deploy IDs 1710,1713,1714. All HTTP 401 with `{"error":"Sesión no válida."}`. These are auth-denial regression probes, **not an authenticated 200/zero-ops test**; no labels, shipments or calls to carriers.
- Production functions retain original JWT enforcement and CORS/OPTIONS source text; snapshots preserve full original files and ACL-related deploy settings. Source rollback references `safety/mfa-production-snapshot-20261018/supabase/rollback/snapshots/edge-20261018/{envia-shipping,mrw-shipping,sendcloud-orders}.json`.
- After deployment, function_edge_logs queried for these three exact function IDs in 13:33–13:50 UTC: envia-shipping six entries, mrw-shipping one, sendcloud-orders one; 0 recorded 5xx, no exception/internal-server-error messages in logged event texts. User's browser AFTER confirmation for transport remains pending.
- MFA remains enabled=false, 10 cron jobs active. Job 8 ran successfully at 13:35 UTC. Nine Amazon sync jobs were enqueued at 13:35:02 UTC **after** that cron cycle, and remain queued/no held leases at this observation. They should be checked against the next 13:40 cycle before proceeding to an Amazon-specific batch. Do not assert that they are already drained.
- Incident 13:29:29 UTC was a one-off Supabase FunctionsFetchError seen in browser. Six newly deployed function CORS/OPTIONS blocks match exact pre-MFA snapshots; edge function logs in 13:28:30–13:30:30 show 10 successful requests (0 4xx,0 5xx), including OPTIONS 200 amazon-confirm-shipment at 13:29:31 with no corresponding POST in that narrow window, and 200s from envia-shipping/sendcloud-orders/Shopify. Not possible to prove which browser request failed, or whether this was transient network, post-preflight failure or cold start. No demonstrated CORS regression, and no reproducible error after reload. Documented; no rollback on present evidence.
- No Amazon functions redeployed, no main merge, no Vercel frontend changes, and no AAL2 enforcement enabled. **STOP: await real browser Pedidos check; no next batch without further authorization.**

### Amazon final batch / amazon-status
- Deploy amazon-status v20 from baseline v19; verify_jwt=false. Deployed production snapshot's existing code and shared modules plus MFA guard. Baseline auth/internal probe previously captured. Post-deploy safe probe pending. No real shipment confirmation or carrier call. Exact rollback safety/mfa-production-snapshot-20261018/supabase/rollback/snapshots/edge-20261018/amazon-status.json.

### Amazon final batch / amazon-sync-manual
- Deploy amazon-sync-manual v25 from baseline v24; verify_jwt=true. Deployed production snapshot's existing code and shared modules plus MFA guard. Baseline auth/internal probe previously captured. Post-deploy safe probe pending. No real shipment confirmation or carrier call. Exact rollback safety/mfa-production-snapshot-20261018/supabase/rollback/snapshots/edge-20261018/amazon-sync-manual.json.

### Amazon final batch / amazon-confirm-shipment
- Production is at v19 (baseline snapshot v18). Its operational/index files are unchanged vs snapshot and only _shared/amazon/supabase.ts plus the two new MFA guard files differ, exactly matching #222. Deployment completed before an orchestration tool-call limit interrupted journaling. NO real shipment confirmation invoked. Safe unauthenticated POST probe still required. Rollback: safety/mfa-production-snapshot-20261018/supabase/rollback/snapshots/edge-20261018/amazon-confirm-shipment.json.

### Amazon final batch / amazon-reconcile-orders
- Deployed production v9 from snapshot v8 with human MFA helper, preserving existing index and internal-key fast path. No actual workspace orders were processed. Baseline safe nonexistent-workspace internal probe #1721 returned HTTP 200 with processed=0/failures=0; post-deployment verification pending. Exact rollback source safety/mfa-production-snapshot-20261018/edge-20261018/amazon-reconcile-orders.json.

### Amazon final batch / amazon-recipient-fallback
- Deployed production v8 from snapshot v7, preserving service-only authorization and the restricted fallback, with new MFA check only in human auth path. No actual buyer or recipient data was read or returned during validation. Baseline safe nonexistent workspace internal probe #1722 returned HTTP 200 enriched=0 failures=[]; post-deployment probe pending. Rollback source safety/mfa-production-snapshot-20261018/edge-20261018/amazon-recipient-fallback.json.

### Amazon final batch — verified and CLOSED, 2026-10-18 14:02 UTC
- User approved final Amazon Edge batch without real shipment confirmation; no frontend/PR merge/AAL2 activation.
- Before: exactly nine sync jobs at 13:35:02 UTC all **success**, 0 failed, no held leases, no running/queued. Amazon cron 8 (*/5 min), PII cron 15 (02:30 UTC) remained active.
- Scoped precisely to **human-authenticated** Amazon functions using `_shared/amazon/supabase.ts.authenticateUser`: amazon-status v20 (from v19), amazon-sync-manual v25 (from v24), amazon-confirm-shipment v19 (from v18), amazon-reconcile-orders v9 (from v8), amazon-recipient-fallback v8 (from v7). All independently deployed and journaled, with deploy verify_jwt preserved. The interruption of a multi-call script after amazon-confirm-shipment was reconciled by comparing all live files: old operational source/index unchanged, MFA helper files equal branch; its journal was recovered immediately. No real shipment confirmation, label, carrier or order mutation.
- Existing **automatic** functions (amazon-sync-worker v38, orchestrator, sync-orders, finances, inventory, FX, image worker, backfill) were NOT redeployed: they use `requireInternalSecret`, unaffected by human MFA guard.
- Safe baseline/post probes: amazon-status #1718 / #1725 = 403 `Sesión no válida.`; amazon-sync-manual #1719 / #1726 = 403; amazon-confirm-shipment #1720 / #1727 = 401; amazon-reconcile-orders #1721 / #1731 = HTTP 200 `processed:0, failures:[]`; amazon-recipient-fallback #1722 / #1732 = HTTP 200 `enriched:0, failures:[]`. No real shipping confirmation. No credentials or recipient data returned.
- Post-deploy logs for all five function UUIDs (13:47–14:05 UTC) show 0 HTTP 5xx and 0 logged exceptions; counts per UUID vary, 1–17 records.
- Worker **after full batch**: scheduled cron 13:50 and 13:55 and 14:00 UTC succeeded. Edge worker POST at 13:50 and 13:55 returned HTTP 202 (source worker returns 202 only after `amazon_worker_acquire_lease` returns true; returns HTTP 200 if lease already held). Critically at **14:00:18 UTC** queried `public.amazon_worker_leases` and saw **one live lease** while the worker ran; by **14:01:06 UTC** table had zero lease rows and all sync jobs were settled. At **14:02:20 UTC** queue pending 0, leases 0, total failed 0. This directly verifies actual acquisition and subsequent release.
- Scoped recipient fallback: source code `recipientSource` requires source ID from that Amazon account's `recipientSourceAccountId`, exact equal `owner_id`, enabled active source, supported provider; CI test `scripts/recipient-fallback.test.mjs` rejects other-owner and disabled sources. Production metadata check: **1** configured Amazon account/source, **1** eligible same-owner source, **0** cross-owner fallback references. No live external fallback was triggered and runtime secret `AMAZON_LEGACY_FALLBACK_ACCOUNT_ID` was not read in this step; do not conflate this tenant-bound recipient fallback with any legacy secret.
- Production MFA `enabled=false`; 10 cron jobs active, job 15 unchanged; main/frontend/Vercel untouched. Rollback snapshots available for all five on `safety/mfa-production-snapshot-20261018`; no failures requiring rollback. **STOP — Phase C in a separate explicitly approved turn only.**

### Phase C pre-merge — 2026-10-18
- User verified Amazon UI with genuine session: Amazon connected; profitability periods and product listings load without errors. Amazon worker 14:00 UTC acquired and released lease, no failed jobs, zero remaining queue; Phase B closed.
- Current Vercel production rollback reference **dpl_3W2T4KqMQYqspkCT6FAupXTH2jba**, immutable deployment URL `zenvia-gestion-juhd7pj3d-sergiorojasdiaz-7097.vercel.app`, GitHub main SHA `07505dda4eb489c5016fcc218992efbaba10e96a`, alias `gestion.zenviacommerce.com`, READY. Use Vercel Instant Rollback to this deployment if AFTER user test detects regression; do not redeploy code for rollback.
- MFA SQL flag checked `enabled=false` before merge. Candidate #222 head `d68456efd200aaced9f4137d83baa0017b47e933`; four latest CI workflows successful (build, auth resilience, MFA GoTrue/Vault, build check). No AAL2 enforcement and no factor pilot authorization.
- Intended frontend behavior: when `security_mfa_status` returns `ready` with disabled feature, no MFA challenge screen. `MfaDevices` renders nothing with zero admitted factors. Post-Vercel main bundle fingerprint and real browser checks required before declaring Phase C complete.

### 2026-10-18 — Phase C accepted by real administrator / PILOT NOT ACTIVATED
- Production URL: https://gestion.zenviacommerce.com. User independently verified the new public bundle `index-DPFdQ0Eo.js`, session preserved after reload and no TOTP challenge with MFA disabled. Resumen, Pedidos, Amazon all profitability periods, Administración (5 users, 5 active, 3 admins), and Integraciones all loaded without application console errors. **Phase C closed by user acceptance**.
- Pilot preparation only: current SQL `private.mfa_configuration.enabled=false`, `cohort_user_ids=NULL`, and `private.mfa_principals` empty. No factors or MFA user-enforcement configured. Auth production TOTP enabled, maximum 10 factors; phone MFA disabled, AAL1 verification deadline 15 minutes from login when factor enrolled.
- Proposed pilot target a single resolved authenticated admin `user_id` in `cohort_user_ids=ARRAY[target]::uuid[]`, `enabled=true` **only after security gate review and enrollment plan**. Immediate kill switch is `UPDATE private.mfa_configuration SET enabled=false WHERE singleton=true;` followed by assertion. Do not disable tenant-wide auth settings or alter other user sessions.
- **BLOCKER identified during code review:** production `public.security_mfa_bridge_allowed()` currently returns `not enabled and not exists(...pending states...)`; therefore enabling MFA even for a single-user cohort will deny **all** platform-bridge delegations globally. Separate explicit design/code/CI acceptance required before any pilot that promises no impact to the other four users. Do not bypass the bridge with service_role; delegate safely or account for this downtime.
- Enrollment requires service-only `security_mfa_authorize_enrollment` and recovery workflow; the initial challenge UI is `MfaScreen` gating App; secondary authenticator control `MfaDevices` in Configuración (admin-only), visible only if `factor_ids.length>0` (therefore not visible for an unenrolled user with disabled feature). The 15-minute AAL1 enforcement means immediate challenge on next login after first TOTP registration.
- Pilot, factor changes, global AAL2 and bridge modification **NOT authorized/executed**. User will explicitly schedule pilot after preparation.

### Bridge cohort correction follow-up — 2026-10-18, NOT DEPLOYED
- User requested genuine backend pre/post calls for (a) delegation from an operator outside cohort, (b) system:plan-sync, and (c) no service token rejection.
- Existing production `platform-bridge` v30 calls the zero-argument `security_mfa_bridge_allowed()` despite cohort-sensitive three-argument SQL installed; this is a verified caller mismatch.
- New branch `fix/mfa-platform-bridge-actor-20261018` changes shared `_shared/mfa-policy.ts` to send actor id, email and action to SQL, and `platform-bridge/index.ts` to parse the body **after verifying the bridge token** and bind those values to the authorization call. Added a static regression test in `scripts/platform-bridge.test.mjs`.
- SQL transaction simulation with enabled=true, one-user cohort, then ROLLBACK: outside-cohort operator allowed=true, system:plan-sync allowed=true, missing actor=false. This is not a live bridge HTTP test.
- No plaintext `x-platform-token` is available via the connected tools; the `platform_bridge_secrets` table holds its hash and no related Vault name was found. Real authenticated pre-deployment bridge calls cannot be reproduced here without the authorized service caller. **No production redeploy**, no production MFA activation, no secret extraction. Need real authorized internal caller test plus CI and a user-visible platform read-only screen check before deploy.
- Production MFA flag confirmed enabled=false. User's pilot and any expansion of Amazon access remain NOT activated.
- Design-only future requirements: all users with Amazon data access; failed login/TOTP lockout and anomaly detection; annual client secret rotation using Amazon Application Management API and annual LWA refresh-token reauthorization with dual-app staged cutover. No design-only item implemented.

### Cohort bridge fix CI result — 2026-10-18
- Draft PR #230 contains caller-to-SQL binding and updated tests, **NOT DEPLOYED**. CI green: Build check #39160752105, Auth resilience #39160752065, Build ZENVIA Gestión #39160752074, MFA real integration (GoTrue/Vault) #39160752098.
- Verified live production no-platform-token HTTP probe request #1970: HTTP 401 `{\"error\":\"Puente no autorizado.\"}`; no service delegation executed. SQL transaction simulation with temporary enabled=true + one user cohort and ROLLBACK produced outside-cohort operator=true, system:plan-sync=true, missing actor=false; production remains enabled=false.
- **Release gate still unmet**: real authorized bridge calls with valid x-platform-token from existing trusted Platform backend for outside-cohort operator and system:plan-sync before/after. Only token hash in public.platform_bridge_secrets and no matching Vault name; cannot honestly claim those HTTP results. Do not extract token, bypass guard, merge or deploy until verified safe authenticated calls are available.
- User requested UI check: ZENVIA Platform → Clientes list, selected client details, users/integrations; platform plans screen exercises bridge on an actual plan sync but must not mutate live plan merely for testing. Exact custom Platform hostname not verified.

### Platform bridge PR #230 — production Edge step, 2026-10-18 20:58 UTC
- User authorized ONLY platform-bridge deploy after real Platform BEFORE baseline: ZENVIA customer 5 active users, Amazon / Envia.com / 2 Gmail / MRW / Sendcloud connected; browser console clean. Real predeploy bridge calls observed 20:55–20:56 UTC HTTP 200.
- Production preflight: `private.mfa_configuration.enabled=false`, `cohort_user_ids=NULL`. Live `platform-bridge` v30, `verify_jwt=false`.
- Exact predeploy complete bundle (five files, original verify_jwt=false, ezbr_sha256 b4321683aeeb1680d6f88a20d8f3640a212cfc4d4c0073f860cf021b9a9bd618) persisted to `safety/mfa-production-snapshot-20261018/supabase/rollback/snapshots/edge-20261018/platform-bridge-pre-pr230-v30.json`, safety commit `33111a8522c5b034484e58dddbc847032cc4d82a`.
- Deployed ONLY `platform-bridge` v31 (ezbr_sha256 `66e9d0d3f569f2b6217752a40f1f6ba3ea5c17cd82d735e5470fd39c07af2414`), `verify_jwt=false`. Source index diff exclusively changes MFA check from zero-argument to `actor,action` after service token verification; `_shared/mfa-policy.ts` sends p_actor_id, p_actor_email, p_action. Other three production shared modules kept byte-identical.
- No SQL flags, frontend/Vercel, other Edge Functions, MFA enrollment or global MFA activation changed. Rollback: redeploy all five files from exact v30 JSON with verify_jwt=false; confirm active version and Platform calls.
- Postdeployment live calls/log evidence and user's AFTER UI acceptance PENDING. Do not claim acceptance yet. STOP after checking logs; if verified real Platform call 5xx, immediately rollback.

### Platform bridge v31 — immediate post-deploy log review / STOP
- Production deployment update timestamp from Supabase: `1792357104552` (2026-10-18 20:58:24.552 UTC). v31 active confirmed from deploy response.
- Log query returned two successful real bridge POST 200 at 20:58:06.778 and 20:58:06.919 UTC, **before** v31 deployment timestamp; they cannot be called v31 successes. Earlier 20:55–20:56 UTC calls also returned 200. No later platform-bridge request was present in the inspected latest results.
- No post-v31 real Platform call error observed, but no post-v31 real successful Platform operation verified either. No rollback triggered on an absent post-deploy call; exact v30 rollback remains ready.
- STOP NOW for user AFTER browser verification of ZENVIA client 5 active users, same named integrations Connected, browser console and actual bridge calls. If real calls yield 5xx or regress, restore v30 immediately and journal. No SQL/pilot/global MFA change.

### Platform bridge v31 — AFTER accepted (2026-10-18)
- ZENVIA Platform: user confirmed same five active users and roles, Amazon, Envia.com, two Gmail, MRW and Sendcloud connected, no browser console errors and no writes.
- Real platform-bridge POST logs at 20:59:07.718 UTC and 20:59:15.681 UTC returned HTTP 200. Both occurred after v31 activation at 20:58:24.552 UTC. No 5xx observed in those requests.
- All five files in production v31 were checked byte-for-byte against PR #230 branch and matched. JWT setting unchanged (false).
- Signed Platform read-only flow accepted. MFA remains off; cohort pilot, system plan sync under enabled MFA and recovery tests are not covered by this validation.
- Rollback: safety/mfa-production-snapshot-20261018/supabase/rollback/snapshots/edge-20261018/platform-bridge-pre-pr230-v30.json. No rollback needed.

### PR #230 merged; pilot prepared, NOT activated — 2026-10-18
- Accepted AFTER Platform browser check and real bridge HTTP 200 at 20:59:07.718 and 20:59:15.681 UTC after v31 activation. No observed 5xx on these calls. User saw same five active ZENVIA users, roles and connected integrations, no console error/no write.
- PR #230 merged into main: merge commit `4a7fa1064de032d42ef4a3cddcf8593677b5bb00`.
- Re-fetched production bridge v31 and main: all FIVE files identical byte-for-byte. No further Edge or SQL deployment necessary. Source rollback v30 snapshot retained.
- Pilot runbook added `docs/deploy/mfa-pilot-runbook.md` on main (commit `2ba8d8adfd88f485e802c49a0aef409a2c979c28`): single-user activation TEMPLATE, SQL emergency disable, two authenticator steps and acceptance tests. NO SQL executed; enabled remains last verified false, cohort last verified NULL; fresh SQL verification was blocked by connector safety controls and must be repeated at pilot preflight. No MFA activation, factor enrollment or pilot execution.
- STOP; user explicitly authorizes pilot separately when available.

### Voluntary enrollment implementation branch — 2026-10-18 / NOT DEPLOYED
- User explicitly prohibited deployment/MFA activation. Branch `feature/mfa-voluntary-enrollment-20261018` created from main; production remains unchanged. This section describes **unverified candidate code**, not a production release.
- SQL candidate: `20261018233000_mfa_voluntary_first_factor.sql` adds authenticated, audited first-factor RPC, session-bound `self_enrollment_pending` with expiry, and status-based AAL1 challenge for any admitted verified TOTP even outside cohort/when flag disabled. Existing service-only recovery functions left untouched. Verified-but-unadmitted Auth factors fail closed.
- Frontend: `MfaDevices` now visible to an admin with zero admitted factors; first factor calls self-service RPC, subsequent devices use existing recent-AAL2 RPC. `MfaScreen`/App/MfaContext need no new branch logic because they already handle `enrollment_required` and `challenge_required` from SQL.
- Added UI, PGlite SQL and disposable GoTrue integration tests for first/second factor, enabled=false, login challenge outside cohort, AAL2 refresh, unregistered user, and recovery rejection. Tests are **committed but have NOT been run or passed in CI**.
- Proposed gated release and SQL/frontend rollback instructions: `docs/deploy/mfa-voluntary-enrollment-plan.md`.
- **STOP before deployment**, including SQL, Edge, frontend and MFA cohort. Existing production flag latest verified disabled/cohort NULL; no attempt made to alter it. CI and security review are mandatory before deployment.

- Additional test-only commit `fe39e6f93a52881ebafdc78643d8aa4d2b9eade0`: mandatory cohort rejection and expired voluntary authorization safely returning to ready/restart. CI still not executed; branch remains pre-deployment. No production write.

### PR #231 CI gate — in progress, no production deployment
- PR #231 created in draft; first SHA `1e5361a203c6cd4b5167131033d6b252b01f151e` failed disposable integration **before GoTrue startup** during PGlite SQL synthetic regressions (21 failures/17 passes). No true TOTP AAL2 outcome can be claimed from that run.
- Identified activation guard's inventory needs to account for the exact new approved SECURITY DEFINER `security_mfa_begin_self_enrollment`. Corrected in branch migration commit `59c135088642b75731f4db057b94e869f27399a9` with existing inventory logic otherwise retained. A new set of four CI workflows has been triggered; results pending.
- First-TOTP post-verify AAL2 and immediate refresh preservation were added to the actual GoTrue integration script in commit `1e5361a203c6cd4b5167131033d6b252b01f151e`. These assertions have NOT executed in live GoTrue yet.
- STOP SQL deployment unless all CI green, backend preflight snapshot/rollback and exact SQL provenance complete. Production unchanged.

### PR231 Phase SQL preflight — CI GREEN, production not yet modified
- Four PR workflows green on `05d494be3699a1a268b24584024cfec5f5e0b43b`: build check #39168547968, app build #39168548025, Auth resilience #39168547982, disposable GoTrue/Vault #39168547980. Real integration subtest for first TOTP -> AAL2 and refresh persistence passed; second TOTP also passed.
- Before migration, production `private.mfa_configuration` checked `enabled=false`, `cohort_user_ids=NULL`; migration history currently has no voluntary MFA migration and most recent MFA migration `20261018170000_mfa_strict_pilot_cohort`.
- Production exact pre-change definitions + ACL snapshot stored on safety branch at `supabase/rollback/snapshots/mfa-pre-voluntary-sql-20261018.json` (commit b4792f98). Guarded rollback SQL stored `supabase/rollback/mfa-voluntary-sql-rollback-20261018.sql` (commit 9ca04840), refuses if any self-enrollment pending. No session, factor, Edge or frontend mutation performed by preflight.
- Next authorized operation is SQL-only migration. STOP and inspect errors if it fails; no frontend deploy.

### PR231 Phase SQL / step 1 — migration applied, backend verification pending
- Supabase project `sjkxxbedkkmgmqnvaqjh`: `apply_migration(name='mfa_voluntary_first_factor')` returned `{success:true}` using the EXACT committed branch SQL file `20261018233000_mfa_voluntary_first_factor.sql` from green-CI candidate. No frontend, Edge, Auth settings or cohort activation changes made.
- Prior production function + ACL snapshot and guarded rollback SQL preserved on `safety/mfa-production-snapshot-20261018`. Need verify Supabase-recorded migration version and reconcile filename if different; backend verifications pending. DO NOT claim full release acceptance yet.

### PR231 SQL PHASE CLOSED — 2026-10-18 21:41 UTC — STOP
- Applied only SQL migration `mfa_voluntary_first_factor` via Supabase migration API; successful `{success:true}`. Supabase registry assigned version `20261018214155`; renamed branch migration file to **exactly** `supabase/migrations/20261018214155_mfa_voluntary_first_factor.sql` (unchanged SQL contents). Updated test and plan paths; branch PR remains DRAFT and UNMERGED. Re-run CI after path adjustment is needed before frontend phase.
- Before: `private.mfa_configuration.enabled=false`, `cohort_user_ids=NULL`. After: same values confirmed by SQL. Zero `self_enrollment_pending` principals observed immediately after migration.
- Backend synthetic authenticated AAL1 checks inside explicit `BEGIN...ROLLBACK`: real active admins and ordinary users with no verified factors returned `security_mfa_status().state='ready'`; assertion required at least one of each role and passed. No user session, factor or data modified.
- ACL check: `authenticated` may execute `security_mfa_begin_self_enrollment()`, `anon` may not. 10 active cron jobs; no Auth 5xx appeared in the inspected auth_logs filter, but this query did not prove full login volume. No Edge/frontend/Vercel deployment.
- Snapshots: `safety/mfa-production-snapshot-20261018/supabase/rollback/snapshots/mfa-pre-voluntary-sql-20261018.json` (four exact prior SQL definitions and ACLs), rollback SQL `safety/mfa-production-snapshot-20261018/supabase/rollback/mfa-voluntary-sql-rollback-20261018.sql`. Rollback refuses an active pending voluntary enrollment. No rollback executed: checks passed.
- CI precedent: build, build-check, Auth tests, disposable GoTrue/Vault all green at code SHA `05d494be` prior to filename-only reconciliation (MFA integration run #39168547980, successful first-TOTP AAL2 + refresh assertions). Filename reconciliation committed after deployment; any new workflow failure must be resolved before next phase.
- STOP. Frontend and pilot are NOT authorized in this turn; user must do browser BEFORE and AFTER checks in separately agreed Phase frontend. MFA pilot not activated.

### Phase SQL final CI reconciliation — green and stopped
- After version-only migration filename reconciliation, all four PR checks also passed on commit `389994796a7180c44d8e625596f713532705f6c0`: Build check #39169097884, Build Gestión #39169097892, Auth resilience #39169097827 and real disposable GoTrue/Vault integration #39169097826. No code/SQL content changed in that reconciliation.
- Exact Supabase registry `20261018214155` matches renamed branch migration file. Re-checked backend: `enabled=false`, `cohort_user_ids=NULL`, `cron.job` 10 active, authenticated-only self-enrollment RPC. Synthetic AAL1 admin and ordinary user without factors both pass `security_mfa_status` within transaction and rollback.
- User-facing frontend remains unchanged; PR #231 is still DRAFT and UNMERGED; no TOTP factor enrollment in production. STOP per requested SQL-only release.

### PR231 frontend deployment preflight — 2026-10-18
- User BEFORE browser baseline: Administrator session; Configuración sections General, Plan y facturación, Facturación, Gastos e importación, Pedidos, Envíos, Productos, Clientes, Proveedores, Integraciones, Alertas y automatizaciones, Mis preferencias, Mantenimiento; security authenticators card absent. Resumen, Pedidos, Amazon working.
- Live production Vercel deployment before merge: ID `dpl_33xcxSq5p7ZFgDMzwyXEqPiYMfUC`, READY, Git commit `f8c06781986563e932dfdf63bcb5b76c2afb156a`, URL `zenvia-gestion-8ib2xgt8b-sergiorojasdiaz-7097.vercel.app`; alias `gestion.zenviacommerce.com`. This is the frontend rollback target; do not rollback SQL as part of a frontend-only rollback.
- PR #231 head baseline `b6dc7a44bfd14eab81ee68f44ca5aa100acc3abe` before journal, green preceding CI on commit `389994796a7180c44d8e625596f713532705f6c0`: Build, Build check, Auth resilience, actual GoTrue/Vault. Frontend merge explicitly authorized by user, no factor enrollment, SQL flag activation, or cohort change authorized.
- After frontend merge: confirm actual Vercel production alias targets new merge SHA and READY, then STOP for user's AFTER browser session check. Rollback by restoring the saved production deployment alias if regression.

### Backup TOTP bug / UI draft (not deployed) — 2026-10-18
- User reports successful primary factor enrollment; Auth log factor enroll/challenge/verify returned 200 around 21:52-21:53 UTC. `private.mfa_audit` records self_enrollment_started and enrollment_completed. Live auth.sessions for info@zenviacommerce.com shows `aal2`, factor linked, updated 21:53:21 UTC, session created 21:15:12 UTC.
- PostgreSQL logs showed MFA_SESSION_REQUIRED at 21:55:14, 21:55:31, 21:56:01 UTC. The newly enrolled principal's not_before is newer than the current Auth session; the protected `security_mfa_begin_factor_add` calls `mfa_error(true,true)` and denies the old session. Safe remediation: new login + TOTP, not weakening session cutoff.
- Branch `fix/mfa-backup-factor-ui-20261018` changes UI only: specific stale-session error, explicit re-login action, branded Settings card, device list from Auth metadata with unavailable fallback, redesigned login MFA enrollment screen and QR panel. No backend, SQL, Edge, MFA flag or cohort changes.
- CI evidence pending. STOP before any frontend deploy.

### PR #232, release of rename SQL (frontend PENDING) — 2026-10-18
- 4/4 workflows green at PR source `b5ef71316f505e71b96b5c9c373685f36431ca74`: Build check #39172787018, Build Gestión #39172787027, Auth resilience #39172787013, full disposable Supabase/GoTrue/Vault #39172787059.
- Browser BEFORE from user: 2 admitted TOTP on admin; Settings presents native controls; tab regain focus shows access-checking screen; Dashboard/Orders/Amazon normal.
- Production Vercel rollback reference BEFORE merge: `dpl_DbqGAZbqRt6meuH7NgvELfbUYA3Q`, `READY`, Git `03c6562fa78d3dd25f43e84a6d48a701ab9b7f81`, alias `gestion.zenviacommerce.com`.
- Production before rename had no `public.security_mfa_rename_factor(uuid,text)` function. Safety rollback file: `safety/mfa-production-snapshot-20261018/supabase/rollback/mfa-rename-pr232-before.sql` (commit `13224ed7530b03492ea80054b795912f45744d0b`).
- Applied SQL-only rename migration with success. Registry version `20261018223844`; renamed branch migration to `20261018223844_mfa_rename_verified_factor.sql` with unchanged SQL. Function checks recent AAL2 security gate; UPDATE constrained to auth.uid, factor_id, verified TOTP, active principal and admitted factors. authenticated can EXECUTE; anon cannot. No real factor friendly names modified by migration.
- After SQL: `enabled=false`, `cohort_user_ids=NULL`, pilot's two verified TOTP preserved. Smoke inside explicit `BEGIN;...ROLLBACK;` checked existing factor-free active admin and ordinary user have status ready. No Edge changes. Renaming ownership guard established by SQL predicate; no cross-user real mutation used in production.
- STOP between SQL and frontend until final branch CI after migration-filename reconciliation is fully green; subsequent frontend merge/publish requires production Vercel READY/alias check; no pilot activation.

### Piloto MFA COMPLETADO — 2026-10-19, 10:08 CEST (confirmación del usuario)
- Prueba final funcional confirmada: salida de sesión, nueva contraseña + desafío TOTP, acceso a Resumen, Pedidos, Amazon y Configuración > Seguridad sin incidencias. Evidencia: confirmación de prueba por el usuario; no implica auditoría de sesión en Auth en este punto.
- Producción: migration ledger incluye version 20261019075300 (mfa_rename_manifest_wrapper). La PR #235 tiene el archivo canónico con esa misma versión, evitando futuros supabase db push duplicados. Función pública de renombrado protegida con el wrapper y manifiesto verificado.
- MFA enabled=true con cohort SOLO de 7461b2b7-f383-460d-b1c7-6ccbb52e42b2. Sin otros usuarios añadidos. Previamente probados guard=0 findings, fuera-cohort admin/user AAL1 ready, y amazon/cron activos.
- PR MFA #232, #233, #234 fusionadas; PR #235 mantiene pendiente la fusión de código hasta que la nueva CI de la migración alineada esté verde. Producción frontend Vercel READY deployment dpl_GUjcgsVFJDXYWcLNmSYwiUvEhzLb, commit f74ab6f8ca0048ea79e556f0f3b27465fa4e48bd (PR #234). El merge posterior de #235 solo alinea repo/docs/migración ya aplicada; debe verificarse deployment y no alterar cohort.
- Seguimiento condicional automatizado de 48 comprobaciones horarias desde 2026-10-19 11:08 Europe/Madrid: errores MFA inesperados, Auth 5xx, denegaciones fuera cohort, cambios de guard/cohort y salud de workers/cron y system:plan-sync. Avisar solo incidencias.
- Plan futuro no ejecutable sin aprobación: docs/deploy/mfa-expansion-plan-draft-20261019.md. Primera fase otros administradores; segunda acceso efectivo a datos Amazon, gracia y bloqueo de intentos; revisión anual de LWA. Ningún cambio de cohort fuera del piloto.


### Vigilancia piloto MFA — 2026-10-20 10:12 CEST
- Configuración verificada en producción: `enabled=true` y cohort exacto de un único usuario autorizado (`7461b2b7-f383-460d-b1c7-6ccbb52e42b2`). `private.mfa_activation_findings()`: 0 hallazgos. No se modificó configuración ni se ejecutó apagado de emergencia.
- Ventana revisada 09:10–10:12 CEST: 0 `PGRST003`, 0 `57014`, 0 `MFA_REQUIRED`/AAL1 inesperados, 0 denegaciones fuera del cohort y 0 errores atribuibles a sondas/tests. Auth registró 303 respuestas HTTP 200 y 0 respuestas 5xx.
- Worker Amazon: 16 runs `success`; 50 jobs actualizados en `success`, 0 `failed`; cola sin estados pendientes/en proceso/fallidos (histórico: 38.366 `success`, 2 `superseded`). Sin lease retenido tras finalizar los ciclos.
- Cron en la ventana: `amazon-sync-worker` 14/14, `amazon-orders-five-minutes` 14/14, `amazon-product-images-refresh` 7/7, `amazon-recipient-fallback-refresh` 5/5, `amazon-worker-maintenance` 4/4 y `amazon-orchestrator-hourly` 2/2, todos `succeeded`.
- Resultado: piloto estable; sin incidencia significativa y sin acciones correctivas.


### Vigilancia piloto MFA — 2026-10-20 11:11 CEST
- Configuración exacta en producción: `enabled=true`, cohort único autorizado; `private.mfa_activation_findings()` = 0. Sin cambios ni apagado de emergencia.
- Ventana 10:10–11:11 CEST: 0 `PGRST003`, 0 `57014`, 0 `MFA_REQUIRED`/AAL1 inesperados, 0 denegaciones fuera del cohort, 0 `context canceled` y 0 `job startup timeout`. Auth: 754 respuestas HTTP 200 y 0 respuestas 5xx.
- Worker: 16 runs `success`; 50 jobs recientes `success`, 0 `failed`; sin lease retenido. Cola sin pendientes/en proceso/fallidos (histórico: 38.396 `success`, 2 `superseded`).
- Cron: worker 14/14, pedidos 14/14, imágenes 7/7, destinatarios 5/5, mantenimiento 4/4 y orquestador 2/2; todos `succeeded`.
- Resultado: estable, sin incidencia significativa ni acción correctiva.


### Vigilancia piloto MFA — 2026-10-20 11:50 CEST
- Configuración exacta: `enabled=true`, cohort único autorizado; guard `private.mfa_activation_findings()` = 0. Sin cambios ni apagado de emergencia.
- Ventana 10:48–11:50 CEST: 0 `PGRST003`, 0 `57014`, 0 `MFA_REQUIRED`/AAL1 inesperados, 0 denegaciones fuera del cohort, 0 `context canceled` y 0 `job startup timeout`. Auth: 775 respuestas HTTP 200 y 0 respuestas 5xx.
- Worker: 14 runs `success`, 0 `failed`; cron observado sin fallos. Un job `queued` detectado a las 11:49 CEST fue consumido correctamente por el ciclo de las 11:50 (run `success`, 1 fila); cola final sin pendientes/en proceso/fallidos y sin lease retenido.
- Cron previo: worker 13/13, pedidos 13/13, imágenes 6/6, destinatarios 5/5, mantenimiento 4/4 y orquestador 1/1, todos `succeeded`.
- Resultado: estable, sin incidencia significativa ni acción correctiva.


### Vigilancia piloto MFA — 2026-10-20 12:52 CEST
- Configuración exacta: `enabled=true`, cohort único autorizado; `private.mfa_activation_findings()` = 0. Sin cambios ni apagado de emergencia.
- Ventana 11:50–12:52 CEST: 0 `PGRST003`, 0 `57014`, 0 Auth 5xx, 0 `context canceled` y 0 `job startup timeout`. Auth: 353 respuestas HTTP 200.
- Una entrada PostgreSQL `MFA_REQUIRED` a las 12:19:50 CEST fue clasificada como **prueba controlada**, no fallo real: consulta transaccional `BEGIN ... ROLLBACK` originada por `POST /mcp`, que invocó deliberadamente `security_mfa_assert(false)` desde una comprobación de la RPC de Pedidos. No fue una denegación fuera del cohort ni una regresión de login.
- Worker: 14 runs `success`, 0 `failed`; 31 jobs recientes `success` y 1 `queued` recién creado para el siguiente ciclo; sin lease retenido. Cron: worker 13/13, pedidos 13/13, imágenes 7/7, destinatarios 5/5, mantenimiento 4/4 y orquestador 1/1, todos `succeeded`.
- Resultado: estable, sin incidencia significativa ni acción correctiva.


### Vigilancia piloto MFA — 2026-10-20 14:21 CEST
- Configuración exacta: `enabled=true`, cohort único autorizado; `private.mfa_activation_findings()` = 0. Sin cambios ni apagado de emergencia.
- Ventana 13:20–14:21 CEST: 0 `PGRST003`, 0 `57014`, 0 `MFA_REQUIRED`/AAL1 inesperados, 0 denegaciones fuera del cohort, 0 `context canceled`, 0 `job startup timeout` y 0 Auth 5xx. Auth: 495 respuestas HTTP 200.
- Worker: 14 runs `success`, 32 jobs recientes `success`, 0 `failed`; cola sin pendientes/en proceso/fallidos y sin lease retenido. El cron del worker ejecutó 41 ciclos `succeeded` en la ventana, coherente con la nueva frecuencia de un minuto; sin solapamientos problemáticos.
- Resto de cron: pedidos 13/13, imágenes 7/7, destinatarios 5/5, mantenimiento 4/4 y orquestador 1/1; todos `succeeded`.
- Resultado: estable, sin incidencia significativa ni acción correctiva.


### Vigilancia piloto MFA — 2026-10-20 14:47 CEST
- Configuración exacta: `enabled=true`, cohort único autorizado; `private.mfa_activation_findings()` = 0. Sin cambios ni apagado de emergencia.
- Ventana 13:46–14:47 CEST: 0 `PGRST003`, 0 `57014`, 0 `MFA_REQUIRED`/AAL1 inesperados, 0 denegaciones fuera del cohort, 0 `context canceled`, 0 `job startup timeout` y 0 Auth 5xx. Auth: 519 respuestas HTTP 200.
- Worker: 14 runs `success`, 31 jobs recientes `success`, 0 `failed`; cola sin pendientes/en proceso/fallidos y sin lease retenido. Cron por minuto: 62/62 `succeeded`.
- Resto de cron: pedidos 13/13, imágenes 6/6, destinatarios 4/4, mantenimiento 5/5 y orquestador 1/1; todos `succeeded`.
- Resultado: estable, sin incidencia significativa ni acción correctiva.


### Vigilancia piloto MFA — 2026-10-20 16:39 CEST
- Configuración exacta: `enabled=true`, cohort único autorizado; `private.mfa_activation_findings()` = 0. Sin cambios ni apagado de emergencia.
- Ventana 15:38–16:39 CEST: 0 `PGRST003`, 0 `57014`, 0 `MFA_REQUIRED`/AAL1 inesperados, 0 denegaciones fuera del cohort, 0 `context canceled`, 0 `job startup timeout` y 0 Auth 5xx. Auth: 462 respuestas HTTP 200.
- Worker: 14 runs `success`, 31 jobs recientes `success`, 0 `failed`; cola sin pendientes/en proceso/fallidos y sin lease retenido. Cron por minuto: 65/65 `succeeded`.
- Resto de cron: pedidos 13/13, imágenes 6/6, destinatarios 4/4, mantenimiento 4/4 y orquestador 1/1; todos `succeeded`.
- Orden operativa confirmada: la llegada del fin de la vigilancia no autoriza cerrar ni ampliar MFA; primero deben cerrarse Shopify y las fases de diseño de Gestión, y después auditar/alinear Platform. No ampliar cohort ni prorrogar automáticamente la vigilancia.
- Resultado: estable, sin incidencia significativa ni acción correctiva.


### Vigilancia piloto MFA — 2026-10-20 17:56 CEST
- Configuración exacta: `enabled=true`, cohort único autorizado; `private.mfa_activation_findings()` = 0. Sin cambios ni apagado de emergencia.
- Ventana 16:55–17:56 CEST: 0 `PGRST003`, 0 `57014`, 0 `MFA_REQUIRED`/AAL1 inesperados, 0 denegaciones fuera del cohort, 0 `context canceled`, 0 `job startup timeout` y 0 Auth 5xx. Auth: 685 respuestas HTTP 200.
- Worker: 14 runs `success`, 31 jobs recientes `success`, 0 `failed`. Un job recién encolado fue reclamado por el ciclo de las 17:56 y finalizó `success`; cola final sin pendientes/en proceso/fallidos y sin lease retenido. Cron por minuto: 65/65 `succeeded`.
- Resto de cron: pedidos 13/13, imágenes 6/6, destinatarios 4/4, mantenimiento 4/4 y orquestador 1/1; todos `succeeded`.
- Resultado: estable, sin incidencia significativa ni acción correctiva.


### Vigilancia piloto MFA — 2026-10-20 19:18 CEST
- Configuración exacta: `enabled=true`, cohort único autorizado; `private.mfa_activation_findings()` = 0. Sin cambios ni apagado de emergencia.
- Ventana 18:12–19:18 CEST: 0 `PGRST003`, 0 `57014`, 0 `MFA_REQUIRED`/AAL1 inesperados, 0 denegaciones fuera del cohort, 0 `context canceled`, 0 `job startup timeout` y 0 Auth 5xx. Auth: 247 respuestas HTTP 200.
- Worker: 14 runs `success`, 31 jobs recientes `success`, 0 `failed`; cola sin pendientes/en proceso/fallidos y sin lease retenido. Cron por minuto: 65/65 `succeeded`.
- Resto de cron: pedidos 13/13, imágenes 6/6, destinatarios 5/5, mantenimiento 4/4 y orquestador 1/1; todos `succeeded`.
- Orden operativa sin cambios: no cerrar ni ampliar MFA antes de completar Shopify/Gestión y la posterior revisión de Platform; no ampliar cohort ni prorrogar automáticamente la vigilancia.
- Resultado: estable, sin incidencia significativa ni acción correctiva.


### Vigilancia piloto MFA — 2026-10-20 19:43 CEST
- Configuración exacta: `enabled=true`, cohort único autorizado; `private.mfa_activation_findings()` = 0. Sin cambios ni apagado de emergencia.
- Ventana 18:37–19:43 CEST: 0 `PGRST003`, 0 `57014`, 0 `MFA_REQUIRED`/AAL1 inesperados, 0 denegaciones fuera del cohort, 0 `context canceled`, 0 `job startup timeout` y 0 Auth 5xx. Auth: 69 respuestas HTTP 200.
- Worker: 14 runs `success`, 31 jobs recientes `success`, 0 `failed`; cola sin pendientes/en proceso/fallidos y sin lease retenido. Cron por minuto: 65/65 `succeeded`.
- Resto de cron: pedidos 13/13, imágenes 7/7, destinatarios 4/4, mantenimiento 5/5 y orquestador 1/1; todos `succeeded`.
- Resultado: estable, sin incidencia significativa ni acción correctiva.
