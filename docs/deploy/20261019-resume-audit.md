# Production resume audit — 19 October 2026

Read-only inspection around 11:11–11:15 UTC (13:11–13:15 Madrid). No production mutation, Edge deployment, frontend publication or merge.

- Live HTTP HTML serves `index-BkauntMi.js`, matching the emergency rollback. Vercel connector returned 404 for both domain and journal deployment ID; do not claim its control-plane alias metadata was independently verified.
- `private.mfa_configuration`: enabled=false, cohort_user_ids=NULL. Pilot has two verified TOTP factors. No changes.
- Today's migration registry: 20261019075300 mfa_rename_manifest_wrapper; 20261019104723 amazon_sync_job_retention; 20261019110237 amazon_job_status_grouped_counts.
- Retention config enabled=true, 14 days, 500/batch. Five supervised receipts total 2,500 deletions, 54–137 ms each. Backup table contains 12,753 rows. Cron active at 03:25 UTC (`SELECT private.amazon_sync_job_retention_once();`). Daily schedule invokes one bounded batch. Existing rollback: PR238 `supabase/rollback/amazon_sync_job_retention_20261019.sql`; disable retention before restoring backed-up rows with conflict protection. No rollback performed.
- `amazon-status` v21 (11:03 UTC): entrypoint matches perf/amazon-status-grouped-20261019; existing btree index (owner_id,amazon_account_id,status) present. No redundant index created.
- All 15 Amazon Edge bundles retrieved; versions and deployed bundle hashes in 20261019-amazon-inventory.json. Dependency-by-dependency comparisons against main, PR237, grouped-status branch and production-snapshot branch in 20261019-amazon-code-comparison.json. Comparison ignores trailing whitespace only.
- (a) NOT deployed or partially deployed: deployed orders.ts matches main in amazon-sync-orders v20, worker v38 and reconcile v9; each differs from PR237's modified orders.ts. Do not deploy PR237 wholesale. Its reconciliation patch and upsert patch need combined-flow tests before release (a status change can otherwise still produce two UPDATEs).
- Pre-existing dependency drift: internal Amazon bundles have an older shared supabase.ts without the human-MFA hook; human endpoints include an older shared mfa-policy.ts bridge helper signature. Preserve exact live dependencies in any narrow (a) deployment; do not overwrite them opportunistically.
- Latest completed job observed 11:11:21 UTC. Queue at 11:11 had 47,379 success, 853 superseded, zero queued/running/failed and no outstanding lease. At 11:15 a fresh cron cycle queued 9 jobs; this is a new observation, not a stuck-queue finding. 135 successes with updated_at >=10:28 UTC; no failed jobs then present. Cron invocation records since 10:28 have zero failed records. Cron success means HTTP scheduling succeeded, not by itself that its Edge execution succeeded.
- `orders_dashboard_page_v1` is absent: (d) not installed.
- Log API queries for 10:28–11:13/11:14 UTC failed with `Backend error` twice, including `SELECT * FROM logs LIMIT 1`. PGRST003/57014 absence is UNVERIFIED; queue and connection checks cannot substitute for log evidence. Snapshot showed 31 connections, 2 active, 22 idle and 7 background.

## Transport investigation (no product change)

All three live shipping bundles use `withAmazonBuyerRead` around quote actions. It calls `amazon_pii_claim_external_read`, obtains an exclusive order lease and returns 409 for competing reads. The finally block attempts release; an interrupted function can retain the lease until expiry. This explains simultaneous provider quote requests competing even without label creation. Frontend getShippingOptions uses Promise.allSettled, silently maps rejected providers to null, and waits for the slowest provider. MRW aggregator exclusion currently depends on successful MRW options, not active direct integration configuration.

## Release gate

No main merge while disabled-MFA startup recovery is untested. Transport PR must remain undeployed until user interface review. No production changes were necessary to recover a partial (a), because no (a) bundle had been deployed.
