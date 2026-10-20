# 20 October 2026 — Amazon import, package weights and product-line consistency

## Before production changes

Owner authorized publication of A in order import → weights → visual; B is analysis/proposal only after A. C remains MFA 48-hour watch and expansion, public SP-API developer application, then Seller Central reconciliation. Advanced stamp processing remains cancelled.

- Current Vercel production: dpl_ESrx67iYsYex7Z72asky3bMcSpyz, main 9ce099771ff73dd6f43e81bbcc85f0af3563a368, index-C6YyMSqI.js. Instant Rollback target for visible changes is this deployment.
- PR #256 head 1dd3283b38f138af9e01b68cdb7089a36045bced: worker every minute; producer still every five minutes, six-hour overlap, two-minute API cutoff, all nine marketplaces. Production Edge snapshots (worker v42 / Orders v24) and cron hashes are committed under docs/deploy/20261020-amazon-auto-before on that branch. Fresh downloads were byte-identical to snapshots.
- Exact schedule rollback: supabase/rollback/20261020_amazon_restore_worker_cadence.sql. Edge rollback: redeploy each saved bundle with its existing verify_jwt=false (own authentication unchanged).
- Before health 11:42:59 UTC: guard findings 0, 34 connections, no queued/running/failed jobs. Latest automatic queue waits include 297.25s and 322.29s; previously observed maximum 376.13s. Two FBM first inserts were automatic and preceded the later manual refresh; historical initial status was not recorded.
- Local import validation: 1148 Node tests, 28 independently repeated focused tests; rollback schedule exactness covered. All five GitHub checks must pass the current head before applying.
- PR #257 visual head 1db690eabce870c4f3dc16b80c8a354c2993d30c: all product lines match the previous first line, desktop/mobile screenshots and computed-style assertions. Local Vitest 219 passed and production build passed. No Auth or stamp changes.

## Limits

Minute worker cadence removes the demonstrated extra queue delay. A five-minute producer, mandatory now-minus-two-minute API bound and Amazon publication latency cannot guarantee every purchase is imported in under five minutes. Log actual purchase / queue / first import times and verify next real FBM orders; do not manufacture orders or labels for proof.

## Weight pre-deployment review

The owner has received the five-order current/calculated/source table. At that observation the sole eligible pending order 402-8935535-6572312 had an explicit manual 7 kg adjustment and remains 7 kg; four sampled shipped orders remain unchanged. Zero current eligible orders require modification at that observation. Refresh before any recalculation. Sources: mapped internal base-unit weights and mapping factors, Amazon catalog measurements, Shopify line weight, configured SKU/global fallback marked estimated.

## Production phases

Not applied yet. Record migration, Edge versions, two real worker cycles and subsequent frontend deployments here after each step.

### Import backend applied — 11:46 UTC

- All five #256 head checks success: https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39416798991 (Build check), /39416799138 (MFA visual), /39416799132 (Build Gestión), /39416799035 (Auth), /39416798951 (MFA real integration).
- Migration amazon_restore_worker_cadence applied as 20261020114605 and history aligned by guarded one-row DML to canonical 20261020113031. Worker schedule now every minute; producer remains every five minutes; both command hashes and active state unchanged.
- Worker deployed v42 → v43; Orders v24 → v25. Only shared first-import instrumentation changed; existing verify_jwt=false retained with existing own authentication.
- PR #256 merged with expected head 1dd3283b38f138af9e01b68cdb7089a36045bced, merge 55eb828e8bcc4e321a563ff6fd42a3c56706f088.
- Two-cycle observation and next-real-order latency verification pending; no test order/label generated.

### Import post-deployment verification — 11:50 UTC

- Minute invocations at 11:47 and 11:48 UTC both succeeded and returned worker HTTP 202 accepted, no HTTP error; lease table and queued/running/failed counts all zero after completion; guard 0.
- First subsequently produced grouped Orders job 11:50:03.494 started 11:50:04.154 (0.660 seconds queue), finished 11:50:10.785, 219 rows processed, success on first attempt. Nine marketplace cursors all 11:48:04.174, last success 11:50:10.785.
- New real FBM 171-8517620-7502702 purchased 11:40:46.975, first operational import 11:45:08.370 (4m21s), before this deployment; do not present it as post-change evidence. It arrived automatically. No new post-deployment FBM first insert observed yet.
- New pending order changes weight-audit population: 4 units, stored 1 kg, no manual marker, one recalculation candidate (fallback would be 4 kg estimated unless verified catalog supplies another mass). Owner-adjusted 402-8935535-6572312 remains manual 7 kg. Shipped rows excluded.
- Vercel deployed merge #256 as dpl_5rvsytgNKm5hqR3hh8TUiwcxHdab, no frontend source changes. This is the latest pre-visible-change rollback candidate; original dpl_ESrx67iYsYex7Z72asky3bMcSpyz remains available.

### Weight pre-deployment gate — PR #258

Head fa55c8b7d54b9ea85797fcd4de357d765d052549, based on #256. Final local verification: 1166 Node / 221 Vitest tests, build and shared Deno check passed. Four desktop/mobile screenshots and eight Edge rollback bundles committed in PR. Full remote Edge typecheck could not resolve npm registry; deployment bundling and live verification are mandatory.

SQL snapshot captures current product columns/constraints and exact Shopify preservation guard; rollback file matches its original body and deliberately retains the additive product-weight column and entered values. No production order rows will be written by the migration.

Preexisting production-vs-main shared dependency differences (MFA bridge helper signature, Amazon auth helper, Shopify install helper, logistics PII helper) were detected. Preserve each deployed bundle's original unmodified dependencies; replace only reviewed task entrypoints/shared Orders and add resolver/config/SP-API/http dependencies required by the resolver. Do not change authentication during this rollout.

### Weight backend applied — 11:57–11:58 UTC

All five #258 checks passed for fa55c8b7d54b9ea85797fcd4de357d765d052549: runs 39418158693 (Build check), 39418158101 (MFA visual), 39418158084 (Build Gestión), 39418158259 (Auth), 39418158364 (MFA real). Isolated rollback rehearsal restored the original Shopify guard body exactly and retained a saved 0.89 kg product weight.

Migration order_unit_weights applied as 20261020115740 and history aligned by guarded one-row DML to canonical 20261020113006. Product column numeric/nullable with positive constraint; guard findings 0, connections 30 after deployment.

Edge batches deployed and source verified against prepared per-function bundle (including all unchanged dependencies): worker 43→44, Orders 25→26, Shopify Orders 12→13, logistics 16→17, Envia 43→44, MRW 23→24, Sendcloud tools 35→36, Sendcloud Orders 33→34. verify_jwt retained per function. No label purchased or report generated.

Awaiting next automatic Orders cycle to prove pending recalculation before merging visible frontend. Pre-change owner terminal set: 891 rows, weight/provenance hash a1deda4566b30edb7068550e43fb2bc0. Pending candidate 171-8517620-7502702 and manual7kg captured in snapshot.

### Weight live cycle and frontend merges — 12:01 UTC

The automatic 12:00 grouped job started 12:01:00.543 and finished 12:01:04.971, success, 217 rows, no error. Order 171-8517620-7502702 changed 1→4 kg with provenance quantity4 × unit1 global_fallback, estimated=true. Exactly one current real order required recalculation. Manual 402-8935535-6572312 remains 7kg with its original manual marker/time.

All 891 previously labelled/shipped owner rows retain identical weight/provenance hash a1deda4566b30edb7068550e43fb2bc0 after the cycle. Guard findings remain0. No label was purchased.

#258 merged with expected head fa55c8b7d54b9ea85797fcd4de357d765d052549 → merge1deada1ed533b77c8d8d7db2ae1a0cbf1ce3e2ee. Then #257 merged with expected head1db690eabce870c4f3dc16b80c8a354c2993d30c → merge58687e42f63f0cc4a0c62fdc0582926668ed6c89. All five visual-head checks success: runs39416859725/39416859925/39416859720/39416859853/39416859879.

Vercel building weight deployment dpl_ZnLq12dV9Pim1sGxKuUTgZ1J26wy and final combined deployment dpl_BoN1LhgBjj2yaWn1koZzbYgs9xnB. Waiting for READY and production bundle verification. Rollback recorded before merges: dpl_5rvsytgNKm5hqR3hh8TUiwcxHdab.

### A completed — production verified

Final Vercel deployment dpl_BoN1LhgBjj2yaWn1koZzbYgs9xnB is READY for main58687e42f63f0cc4a0c62fdc0582926668ed6c89. Public production HTML returned HTTP200 and serves /assets/index-Duin0MgL.js. Owner browser reload retained the session and reached Resumen; DOM script URL confirms the same bundle. Pedidos now renders both real order product lines with the same strong/name/quantity structure. No label/report generated. All three requested corrections are published.

B begins read-only layout inventory and screenshots; no UI implementation or deployment is authorized in that phase. C order remains MFA watch/expansion → public SP-API developer application → Seller Central metric reconciliation.
