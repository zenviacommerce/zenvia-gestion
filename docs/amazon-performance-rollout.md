# Amazon performance rollout

The dashboard read deduplication and summary/product cost aggregation optimizations are deployed. Local verification: 987 tests passed; the atomic-page SQL regression fixture passed against the database using `service_role`, with every fixture row rolled back.

The atomic finance schema and indexed deferred-reference cache are installed. The finance Edge workers have **not** been redeployed. Initial cache seeding is incomplete because both management connections and database reads/writes repeatedly exceed their timeouts. A temporary diagnostic function was replaced by an authenticated 404 response. An attempted pause of the new tracking trigger failed before migration initialization; do not assume it is disabled.

Before activating atomic ingestion:

1. Confirm project Compute Size, CPU, memory/swap and disk IO budget in Supabase Database Health; organization Pro alone does not establish project compute capacity.
2. Verify the tracking trigger state. Enable `trg_amazon_track_deferred_references` on `public.amazon_finance_transactions` before restarting the complete reference backfill in `scripts/sql/amazon-finance-deferred-reference-backfill.sql`.
3. Re-run `scripts/sql/amazon-finance-atomic-page-regressions.sql` with `SET LOCAL ROLE service_role` after its `BEGIN`; the fixture rolls back all inserted records.
4. Deploy `amazon-sync-worker` and `amazon-sync-finances` including their relative `_shared/amazon` dependencies. These functions retain their existing internal-key authentication.
5. Measure actual summary and product RPC response times for today, current month, previous month and a selected marketplace. Check refund attribution and financial parity before declaring the loading issue resolved.

Do not activate the workers with an incomplete reverse-reference cache. Existing finance source tables remain the authority; the new cache is derived metadata, not financial totals.
