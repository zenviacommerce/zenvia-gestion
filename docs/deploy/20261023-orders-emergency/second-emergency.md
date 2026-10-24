# Second emergency: whole-screen concurrency

Owner explicitly approved apply-logistics.sql. Applied atomically to the single private implementation; no business data/settings changes. Production public RPC EXPLAIN verified with authenticated role, existing owner MFA context and8s timeout. Concurrent browser measurement delegated explicitly to the owner; other work remains paused pending that result.

Owner reports browser timeouts after first mitigation; previous verification was insufficient. All #298/#299/fiscal work stopped. No #298 migrations, handlers, cron or UI deployed. A documentation-only emergency branch/tree was prepared but not committed/merged.

Frontend main5db28e2 inspected: Orders requests workbench; dates omitted for pending/labelled/issues/all/reports, quarter dates2026-10-01..2026-12-31 for shipped/cancelled. Page size20 in user_preferences; empty search, all channel/tracking/country/carrier, pickup all; overdue24, stale default3. Dashboard separately reads all fulfillment orders(limit10000), then order_logistics_read with all1023 owner IDs. Browser tab inspected on explicit owner request; current DOM shows pending2/labelled0/shipped943/issues9/cancelled64 with two pending rows; this is not evidence of cold-load latency.

Original logistics read2772.055ms alone. Set-based candidate122.223ms. Full owner metadata sorted by id identical for1023rows:0252ae1c2488a2470049bc41ceaa584f. Candidate retains original source-row owner scoping and auth/MFA wrapper, exact shipment identity, evidence/legacy semantics, cancellation priority, and 10000 limit. Joins facts once; no projection staleness introduced.

IMPORTANT: Supabase connector serialized Promise.all calls. Common-barrier test proved actual DB intervals did NOT overlap: pickup18:01:58.270806..58.398893(128.087ms), workbench18:01:59.207367..59.367861(160.494ms), candidate logistics18:02:00.335242..00.502401(167.160ms), all authenticated/8s. These MUST NOT be described as concurrent benchmarks. Parallel SQL requests cannot be verified through this serialized connector. Browser extension was connected, but read-only evaluate does not expose performance; no credentials extracted, no page/runtime escape attempted. Need validate actual browser cold load after approval, or another supported concurrent API surface.

Proposed production modification: one private function definition, read-only joins on existing indexed fact tables; no rows written, no settings/timeouts changed, no frontend deployment. Exact apply-logistics.sql uses captured original hash guard. Rollback-logistics.sql restores only third RPC, leaving approved first mitigation. Old pre297 rollback also available from repository but not executed. No claim below1s for concurrent browser until measured.

