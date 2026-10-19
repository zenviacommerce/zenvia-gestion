# Amazon operational write suppression — PR and phased release

Root cause: page sync reconciles status/tracking with UPDATE for every returned order, then writes the same merchant order again including last_synced_at. No business-data comparison; JSON key/timestamp representation and retained-PII guards can defeat naive comparison.

Change: one merged merchant patch, read/compare before writing; standalone reconciliation reads owner-scoped copies and changes only differing rows. Canonical JSON and timestamp comparison. Preserve local edits/logistics and SQL-redacted PII fields. last_synced_at remains present and advances on business writes; unchanged rows keep their existing timestamp. Job started/finished times remain the per-observation freshness source. Analytics amazon_orders/amazon_order_items upserts unchanged by this scope.

Tests first: unchanged page2 UPDATE vs expected0; status change2 vs expected1; standalone1 vs expected0; JSON/timestamp representation failed. Corrected tests now pass, including purged no-op and local edits. Updated prior reconciliation test to provide real selected copies and assert both copies update.

Snapshots: exact deployed worker38, sync-orders20, reconcile9 under supabase/snapshots/20261019-amazon-writes. Before production, compare/refetch no drift. Deploy only _shared/amazon/orders.ts into each exact live bundle; preserve unrelated production dependencies. No SQL migration needed.

Verification: collect pg_stat_statements UPDATE calls/rows and completed jobs over complete natural worker windows before/after. Separate unchanged suppression from source-data differences. Inspect lease release/queue/failed. Roll back by redeploying exact snapshot files on a failed cycle/regression. No frontend merge/deploy authorized by this task.

Review caught and fixed confirmed order/label cancellation trigger rewrites and optional null item keys. New regressions exercise nonempty items, cancelled tracking and replacement shipment preservation. Cancellation metadata is read in one owner/selected-rows-scoped batch and used in memory only. Final target source/test commit is the only version eligible for deployment; earlier green SHAs are insufficient.
