# Reconciliation repeat — 17 October 2026

## Outcome

SUCCESS. The reviewed reconciliation remains deployed. No rollback was performed. Production cron and manual access were restored before observing the natural cycles. No frontend, MFA, OAuth, #216, main merge, PII purge or Storage deletion was deployed.

Window authorized: 13:55–14:30 Europe/Madrid. Producers paused at 13:55:46.951, restored at 13:57:49.574. Natural complete cycle verified at 14:11:42.118; final operational check at 14:12:12.708.

## Changes and deployment evidence

Candidate source: 11eb6120cf65a2fc87be9d5a4613eef3a5ec14d1; later branch commits only document verification. Authoritative repeat plan: c8db5123c169e45a39455417b20653a123a30a0a.

Before pausing, downloaded all fourteen current production bundles and compared all 84 files against production-snapshot/<function>/<file> at 09c68337c1053dba4480e3916b537a907d9a793a. Zero source drift; existing JWT configuration preserved. Fresh original code/metadata and cron definitions were captured. Lease was naturally free before deployment; no lease or job was manually altered.

Temporary manual maintenance candidate returned HTTP 503. The exact normal candidate was restored as v24 and returned the expected session denial (403) for an unauthenticated public-key request, proving maintenance was removed. Cron 1/8/9 were all originally active and restored active, schedules and command hashes unchanged.

All installed files were read back after each deployment and compared to the reviewed bundle; JWT flags checked. Auth denial probes and, for inventory/finances/orders, authenticated missing-job HTTP 400 probes returned before commercial Amazon calls. Some existing handlers map their own authentication denials to HTTP 500; these were expected negative tests, not Supabase Auth 5xx.

|Order|Function|Before version|Installed version|verify_jwt|Files|
|---:|---|---:|---:|---|---:|
|1|amazon-sync-fx|34|35|false|3|
|2|amazon-backfill-finance-components|17|18|false|3|
|3|amazon-sync-inventory|12|13|false|6|
|4|amazon-sync-finances|17|18|false|7|
|5|amazon-sync-orders|19|20|false|6|
|6|amazon-sync-product-images|22|23|false|5|
|7|amazon-recipient-fallback|5|6|false|3|
|8|amazon-reconcile-orders|7|8|false|6|
|9|amazon-status|17|18|false|6|
|10|shopify-analytics-sync|8|9|false|4|
|11|amazon-confirm-shipment|17|18|true|7|
|12|amazon-sync-manual|21|24|true|8|
|13|amazon-sync-orchestrator|17|18|false|8|
|14|amazon-sync-worker|37|38|false|12|

No forced orchestrator/worker cycle and no successful commercial handler invocation was used as a verification. No shipment confirmation POST was submitted.

## Natural-cycle evidence

Baseline at 13:54:57: 15 connections / 60; no live lease, one eligible queued job, zero running/failed. Previous 24 hours: zero terminal failed out of 3,249 finished jobs.

At 14:05:23: first normal cycle drained; 18 successful jobs, zero queued/running/failed, lease free.
At 14:07:08: normal hourly producer had queued 27 jobs.
At 14:10:13: worker held one lease and was processing jobs.
At 14:11:42: 54 successes total, queue empty, running zero, failed zero and lease released.

|Source|Successful jobs|Rows processed (handler metric)|Maximum attempts|
|---|---:|---:|---:|
|orders|36|430|2|
|finances|9|248|1|
|inventory|9|2781|1|

Finance transactions: 44,181 → 44,185 (four net new rows); four rows synced in the window, latest synced_at 14:10:39.876. Amazon orders: 22,443 → 22,445. Final invariant checks: zero owner/account mismatches and zero duplicate natural keys in both orders and finance transactions. These are count/ownership/key invariants, not an independent audit of every commercial amount.

Logs from 13:55:46 through 14:11:50: 76 amazon_legacy_fallback_used events, all for integration 4e55e0f5-9388-467c-b35c-a86dd4a7b383; zero unexpected integrations. Auth: zero 5xx across 105 requests.

Connections sampled during observation peaked at 36/60 (60%, not above the rollback threshold); final 14:12:12 check: 34/60. All sampled running jobs remained under 15 minutes. Sampling cannot establish a continuous instantaneous maximum.

Final cron states:
- job 1: active, 7 * * * *, command MD5 88a002c2cd1b86f67d314410b1471c50
- job 8: active, */5 * * * *, command MD5 88d1e0c65d67a2f1a0c289da65ec6eb3
- job 9: active, */5 * * * *, command MD5 f2165fd44d710ed79ff3ff52d285b9f8

## Transients and comparison with the previous window

One observed failed job attempt was HTTP 429, orders job 4aa43262-ae2d-440a-a6d3-4cba808b431a. It automatically succeeded on attempt 2 at 14:11:30.864, with last_error cleared. No terminal failure; no rollback criterion met.

Earlier investigation compared equal six-minute intervals: normal 12:00–12:06 Madrid had 27 successful orders jobs and one 429 attempt; the previous 13:00–13:06 window had 36 orders + 9 finances + 9 inventory successes and one 429 attempt. Both recovered on attempt 2. The extra manually forced hourly cycle in that previous window created 27 additional jobs and consulted marketplaceParticipations. The fourteen negative probes returned before SP-API. Additional load was real; causation of the 429 was not established. Outbound per-request/per-endpoint telemetry does not exist, so these figures must not be presented as exact SP-API HTTP counts.

This repeat removed the extra business calls and observed only scheduled work. Another normally recovered 429 occurred and was handled as expected.

## Secret probe and deviations

The previously accepted protected runtime probe returned {defined:true,matches:true}. Fresh preflight and final function inventories show tmp-verify-fallback-secret is absent. It was not recreated; no claim is made that this run deleted it. No dashboard/browser actions or secret-value reads were performed.

Manual maintenance used a temporary reviewed-code condition forced true, rather than configuring another environment secret. Exact normal source was restored after all fourteen validations.

## Rollback

Not used. Only the user's revised operational criteria applied; a recovered quota error is not a failure criterion. Exact previous source remains available per-function in production-snapshot at 09c68337c1053dba4480e3916b537a907d9a793a and was freshly verified before changes; redeployment increments versions and must preserve JWT flags. An actual rollback would gate manual access, pause original producers, await natural lease release, restore every touched bundle with manual last, verify installed source, then restore original producer states.

## PII purge: prepared, not executed

Published compatible preparation as draft PR #224:
https://github.com/zenviacommerce/zenvia-gestion/pull/224
Commit 73f8e26769191a78fcdee4d798b70e59ab5820ab. It combines the existing bounded purge/anti-rehydration/null-safe consumer work with reconciled credential behavior. No production PII was anonymized; no PII backup was created; Storage untouched.

Fresh local compatibility validation: 57 focused Node tests passed; 35 Vitest tests passed; frontend build passed. A full Node-suite attempt exited zero but its captured output lacks the final aggregate, so no fresh full-suite count is claimed.

Before any exact-ten pilot: finish financial related-identifier provenance/copy review, attest deployed writers, test real multi-connection PostgreSQL contention, deploy and verify compatible guards/readers/carriers, run production browser checks (list/detail/VAT/analytics/exports) and an up-to-date identical-selection dry-run. Synthetic PGlite tests are not evidence of real PostgreSQL concurrency or production browser behavior. Readiness gates remain unapproved. Pilot belongs to a subsequent prepared window; follow-up batches and Storage deletion follow only after pilot verification.
