# Amazon operational write suppression — PR and phased release

Root cause: page sync reconciles status/tracking with UPDATE for every returned order, then writes the same merchant order again including last_synced_at. No business-data comparison; JSON key/timestamp representation and retained-PII guards can defeat naive comparison.

Change: one merged merchant patch, read/compare before writing; standalone reconciliation reads owner-scoped copies and changes only differing rows. Canonical JSON and timestamp comparison. Preserve local edits/logistics and SQL-redacted PII fields. last_synced_at remains present and advances on business writes; unchanged rows keep their existing timestamp. Job started/finished times remain the per-observation freshness source. Analytics amazon_orders/amazon_order_items upserts unchanged by this scope.

Tests first: unchanged page2 UPDATE vs expected0; status change2 vs expected1; standalone1 vs expected0; JSON/timestamp representation failed. Corrected tests now pass, including purged no-op and local edits. Updated prior reconciliation test to provide real selected copies and assert both copies update.

Snapshots: exact deployed worker38, sync-orders20, reconcile9 under supabase/snapshots/20261019-amazon-writes. Before production, compare/refetch no drift. Deploy only _shared/amazon/orders.ts into each exact live bundle; preserve unrelated production dependencies. No SQL migration needed.

Verification: collect pg_stat_statements UPDATE calls/rows and completed jobs over complete natural worker windows before/after. Separate unchanged suppression from source-data differences. Inspect lease release/queue/failed. Roll back by redeploying exact snapshot files on a failed cycle/regression. No frontend merge/deploy authorized by this task.

Review caught and fixed confirmed order/label cancellation trigger rewrites and optional null item keys. New regressions exercise nonempty items, cancelled tracking and replacement shipment preservation. Cancellation metadata is read in one owner/selected-rows-scoped batch and used in memory only. Final target source/test commit is the only version eligible for deployment; earlier green SHAs are insufficient.

## Authorized backend release — 14:35 Madrid

Final CI all five green: runs39252649207/39252649255/39252649168/39252649233/39252649347. Source tree737b83a6a25b7e7617c46ab3e231a7dd3b29d634; snapshots refetched without drift. Independent review important cancellation/null-item findings fixed and re-reviewed. Targeted13 tests pass, full Node1109 before last test addition; CI runs final complete suite. Build/Vitest local passed.

Batch1: sync-orders21 and reconcile10 deployed; only shared orders helper replaced. Main/frontend unchanged. Next worker batch and verification pending.

Batch2: worker39 deployed, exact helper and unchanged unrelated dependencies verified by re-fetch; JWT modes preserved for all bundles. Initial post-deploy counters at12:35:47 UTC recorded. Queue9, no failed/running/lease. Invoked the existing active worker cron command once to process that existing backlog; no new jobs or producer/schedule changes.

## Worker verification — 14:36 Madrid

Source5d2609aaee294bf8f5dd2477a28071bb5dd59859. Worker cycle12:36:13–12:36:25 UTC:9 orders jobs success,222 rows_processed units,0 queued/running/failed, lease released. Operational UPDATE counters +3 rows/calls. Baseline12:24:13–12:31:02:19 successful jobs,448 processed units,+259 UPDATE rows/calls. Different volumes: 57.81 vs1.35 UPDATE/100 processed units, -97.66% normalized. Raw259→3 is not a same-volume percentage. Analytics upserts excluded. No frontend deployed/merged. This is a complete explicitly triggered existing worker cycle; source queries remain real SP-API and producers untouched. Snapshots retained for rollback; no rollback needed. Final receipts on audit branch avoid new deployment or unreviewed main merge.
