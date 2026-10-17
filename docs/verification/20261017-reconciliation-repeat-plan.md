# Amazon reconciliation repeat — 17 October 2026

This plan supersedes the original any-failure rollback criterion. User explicitly authorized choosing and executing another low-activity window without further confirmation, then a safe purge pilot in this or a later window.

## Window

17 October 2026,13:55–14:30 Europe/Madrid (11:55–12:30UTC). Last14days in that exact daily interval:4MERCHANT/FBM purchases and0Amazon operational labels. Deploy after13:55; restore producers promptly and observe the natural hourly enqueue14:07 and worker14:10. Do not force another hourly sync or worker merely to produce evidence.

## Prior429 investigation

Compared equal six-minute intervals12:00–12:06 and13:00–13:06Madrid on17October using function_logs worker success/failure events and persisted jobs. Logs are not a record of individual outbound HTTP requests: the deployed spApiRequest fetch loop has no per-endpoint/status/attempt logging. Pagination, internal four-attempt retries, fallback403 reads and the early empty-window return prevent converting job counts into exact HTTP counts. No retrospective exact SP-API request count can be claimed.

| Main job endpoint | Normal successful jobs | Window successful jobs | Normal/window429 job attempts |
|---|---:|---:|---:|
| GET /orders/2026-01-01/orders |27|36|1/1|
| GET /finances/2024-06-19/transactions |0|9|0/0|
| GET /fba/inventory/v1/summaries |0|9|0/0|
| Total |27|54|1/1|

These are job units mapped to their primary endpoint, NOT outbound HTTP request counts. The54/27ratio is2x successful jobs. The two periods have the same normal cron phase; the window additionally forced one hourly orchestrator (pg_net614) at13:02, adding27jobs(9/source), and also its seller-marketplace call and any configured automatic image work. Additional HTTP counts are unknown. The normal hourly financial cycle is at:07/:10, outside these two six-minute intervals; do not generalize this comparison into an all-day endpoint rate.

The14 validation denials lacked a valid human/internal caller; the three internal missing-job400 validations returned before credential/SP-API reads. Source/handler inspection supports zero SP-API business calls from these validation requests. Supabase Auth validation calls are separate. There was no fabricated Amazon shipment confirmation.

Normal429 job9051aac6-f242-4deb-8ddb-292702f70ab1 at12:00:22.616 recovered12:05:04.807 on attempt2. Window429 jobd3007240-6a44-46af-b022-9f54197bfea4 at13:02:35.038 recovered13:05:05.680 on attempt2. Both now success and last_error cleared. Thus429 was not unique to the deployment. The extra cycle increased work, but a causal attribution of the429 is unproven.

## Verification without an Amazon load spike

Use installed source/version/JWT-setting checks and unauthorized/validation-only HTTP denials. Do NOT invoke live business handlers successfully one-by-one. No additional orchestrator/worker trigger; observe scheduled work after restoring original cron states. If any genuinely necessary read-only Amazon call is added, perform only that call and separate such checks by at least60seconds; no confirmationPOST as a smoke test. Do not use per-function rate spacing to imply unauthorized denials call Amazon.

Existing candidate code remains commit11eb6120cf65a2fc87be9d5a4613eef3a5ec14d1; subsequent branch commits add evidence docs only. Existing18focused and1003full Node tests/build passed for this exact source; no new product change is introduced by this plan.

## Secret and probe

Allowlist variable expected integration_accounts.id4e55e0f5-9388-467c-b35c-a86dd4a7b383. Prior authenticated runtime probe12:50–12:51Madrid returned HTTP200 and only defined=true/matches=true; negative401 confirmed. User accepted this as satisfying the secret condition. If tmp-verify-fallback-secret still exists at the new window, re-invoke once using the existing internal cron credential server-side, returning no key/value. If user already deleted it, do not recreate it solely for this repeat; retain the accepted verification and confirm the candidate's account-scoped fallback in the natural worker cycle. Never read Amazon/LWA credentials or unrelated dashboard secrets.

User subsequently requested deletion of tmp-verify-fallback-secret. Connector has no delete-function method, CLI has no authenticated access, and focused dashboard navigation on17October13:20–13:21 reached Sign in. No deletion or other dashboard change occurred. Cleanup remains pending authenticated access/user deletion. This independent cleanup is not an operational rollback condition.

## Deployment and state restoration

Before pausing: re-fetch all14 deployed bundles and compare to production-snapshot/<function>/ at09c68337c1053dba4480e3916b537a907d9a793a. Code matched before and after the preceding rollback; versions increased, so compare files/flags, not original version numbers. Stop before mutation on unexpected drift; preserve fresh code-only rollback evidence. Capture exact cron1/8/9 definitions and active states plus baseline queue, leases, failed rate, connections, financial/order integrity and Auth errors.

Pause1/8/9. Temporary manual candidate changes only the existing pause condition to literaltrue (no other secret configuration); preserve verify_jwt=true. Verify POST503 with public anonymous JWT and no manual jobs. Wait natural lease release, no theft. Deploy order:
1.amazon-sync-fx
2.amazon-backfill-finance-components
3.amazon-sync-inventory
4.amazon-sync-finances
5.amazon-sync-orders
6.amazon-sync-product-images
7.amazon-recipient-fallback
8.amazon-reconcile-orders
9.amazon-status
10.shopify-analytics-sync
11.amazon-confirm-shipment
12.amazon-sync-manual(still503)
13.amazon-sync-orchestrator
14.amazon-sync-worker

Check exact installed dependency closure and original JWT settings for each. After all pass, restore exact normal candidate manual code, verify auth denial returns403 rather than503, restore original cron states/definitions, and observe scheduled complete cycle including finance. Source-level/denied HTTP tests do not prove successful financial/business behavior: only the natural cycle does.

## New exclusive operational rollback criteria

- A job reaches terminalfailed for a non-quota error, OR terminalfailed rate exceeds measured normal baseline.
- Actual credential error, or fallback selection for any integration other than allowlisted account.
- Incorrect financial/order writes, new duplicates or data loss; inspect actual invariants and compare against pre-window baseline, not expected legitimate new business changes.
- Stuck lease, running job over15minutes, or queue ceasing to drain. Distinguish legitimate future available_at backoff from eligible stalled jobs.
- Any Auth5xx, or connections above60% of configured max(above36whenmax60).

Recovered429,5xx/network/transient attempts are NOT rollback reasons. Do not use last_error IS NOT NULL as a generic rollback trigger. Count observable job-level transient events, link to final state/retry recovery, and distinguish unavailable per-HTTP counts. Do not manufacture a new transaction to obtain a nonzero finance-write count; if Amazon has no new records, verify successful financial processing/state and report that limitation honestly.

On a qualifying incident pause producers/manual, allow live lease to end, restore every touched function from exact per-function snapshot, manual last; verify sources and restore original producer states. Keep a rollback time reserve. A tool/compile/readback issue is a blocked deployment requiring safe diagnosis, not an Amazon429; do not reactivate an unverified partial set or fabricate a qualifying operational incident.

## Report and purge

Report changes, evidence, deviations, transients/recovery and rollback status. Record whether candidate remains deployed, no ambiguous success claim. No main merge or MFA/OAuth/PR216/frontend deployment is part of reconciliation.

After successful reconciliation continue purge preparation/pilot in this or a later safe window. Existing purge branch89e2732d has runner/guard/tests but no production migrations/consumer deployment; its docs list outstanding financial related-identifier provenance, actual deployed writer attestation, multiconnection lock contention and production browser smoke gates. Do not mark those gates passed based on synthetic tests. Before any irreversible write rebase safely, deploy compatible guards/readers/carrier protections, complete all-copy review and validate exactly10 dry-run selection. No buyer backup, no fiscal exemption, purchase+60days absent reliable delivery. Pilot10 only after these conditions; validate list/detail/analytics/VAT/exports before later batches. Storage last. If not ready, report exact blocker and keep preparing; do not rush purge merely because deployment succeeded.
