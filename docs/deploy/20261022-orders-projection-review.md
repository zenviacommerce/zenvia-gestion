# Orders RPC performance review — 2026-10-22

Production project: `sjkxxbedkkmgmqnvaqjh`. No performance migrations or statistics resets have been applied by this branch.

## Evidence

Production authenticated `aal2` calls for an active workspace member: pickup baseline **842.301 ms**, page baseline **773.748 ms**, with **1043/1045 temporary blocks written** respectively. The tenant initially contained 1014 source rows / 1000 deduped groups (986 singleton groups, 14 duplicate groups); live ingestion subsequently added a row. Snapshot timings are individual observations, not p95 or CPU measurements.

The same private pickup SELECT, using the RPC's definer privileges, verified workspace/MFA helper and explicit tenant predicate, took **835.103 ms before / 255.107 ms with singleton fast path**. The candidate wrote no temporary blocks. A same-statement full JSON equality comparison at 06:59:59 UTC returned true (7 matching pending/selectable rows). The private-table SELECT cannot run directly as authenticated because receipt membership tables intentionally deny that role; the real public-wrapper baseline above did run as authenticated.

The initial candidate alone does **not** meet 50 ms. The incremental projection precomputes the exact merged/classified row per changed dedupe group; query-dependent periods, overdue time, membership, KPI scopes, search, selection and pagination stay in the original RPC body.

Synthetic PGlite benchmark, 1014 rows / 1000 groups, seven warmed samples per scenario:

| RPC/scenario | Baseline mean | Projection mean | Projection maximum |
|---|---:|---:|---:|
| Page / pending | 222.64 ms | 20.88 ms | 22.04 ms |
| Pickup / pending | 208.58 ms | 22.69 ms | 23.47 ms |
| Pickup / search | 226.23 ms | 27.39 ms | 29.30 ms |
| Pickup / next page | 211.88 ms | 27.66 ms | 28.34 ms |
| Pickup / selection | 187.53 ms | 12.05 ms | 12.56 ms |
| Pickup / REC sort | 224.20 ms | 33.48 ms | 35.64 ms |

Warm single-group source updates cost approximately 4.2–4.7 ms locally. This WASM fixture is not production latency or 10/50/200-workspace capacity evidence. With seven samples nearest-rank p95/p99 both equal the maximum; they are not stable tail estimates.

`20261022-orders-pgstats-baseline.json` preserves the historic window since 2026-10-19 10:28:22 UTC. The 88.7 s outlier was identified, without re-execution, as a one-off five-period baseline CTE containing the full old dashboard body. It is not one normal page RPC. Historic Shopify 43-call/2448 ms and newer 265-call/55.7 ms normalized statements coexist; aggregate history cannot establish a current regression.

## Deployment, DML and rollback

1. `20261022064741_orders_singleton_merge_fast_path.sql`: function-definition changes only, plus at most one SQL-definition backup per target RPC (normally three). No source-order writes, no grants/wrapper/MFA-manifest changes, no DROP. Singleton PII sanitization mirrors the old merge, including malformed item JSON normalization.
2. `20261022065250_orders_incremental_classified_projection.sql`: **shadow only**. Creates one justified `(owner_id, dedupe-group)` expression index for bounded refreshes (existing owner/sendcloud, ASIN and SKU indexes are not duplicated), private typed derived projection, metadata/backup tables, and source triggers. Backfill INSERT/UPSERT affects roughly 1000 new derived rows. The refresh function contains UPDATE through `ON CONFLICT DO UPDATE` and DELETE of a derived group when classification produces no row; it never modifies source orders. Subsequent source edits refresh one group, or two groups if tenant/order key changes. Group locks serialize competing refreshes. The initial nonconcurrent index holds a source-table write-blocking lock through the migration transaction/backfill; use an approved short maintenance window and inspect lock timeout/backfill duration first.
3. Run `20261022-orders-shadow-probe.sql` after shadow installation and before activation. It performs only a guarded tenant/MFA read plus EXPLAIN against the derived projection; no RPC definitions change. The frozen probe is for the current legacy schema and should be regenerated after a classifier release. Compare full JSON under the same timestamp and representative filters, including REC membership/sort, before activation. Preserve plans and take enough warmed real RPC samples for useful p95/p99 after activation.
4. `20261022070148_orders_incremental_projection_activate.sql`: replaces only the common classifier prefix with a tenant-filtered projection read. Fails closed if any RPC classifier differs from the shadow classifier. Leaves wrappers, grants, signatures and manifest hashes intact. Inserts normally three definition-backup rows; no business-row DML.

Read rollback restores function definitions with hash guards and revokes direct projection reads. **Maintenance triggers deliberately remain active** so later source purges/deletes continue sanitizing private derived data. This is a read rollback, not full decommissioning; removing index/derived rows/triggers requires a separately reviewed cleanup. Source orders and statistics are never deleted/reset by rollback.

## Verification

Full suite before the final additional dependency assertions: **71 files / 338 tests passed**. Final targeted SQL tests execute both legacy and modern tracking classifiers, authenticated source writes, tenant isolation, MFA rejection, complete JSON equality, duplicate regrouping, visible Amazon → excluded Pending → visible transitions, malformed purged item JSON, source insertion/deletion/purge, and unchanged wrapper manifest hashes. Tracking-state updates refresh modern cached classification. Shadow installation is asserted not to change RPC sources.

## Pending tracking UI compatibility

Performance can ship the current legacy classifier without publishing the tracking UI. The held tracking UI migration currently expects the original classifier inside RPC sources and will fail safely after projection activation. Its future cache-aware adapter must transform the preserved classifier, extend the typed projection with normalized tracking fields, regenerate the refresh INSERT/upsert column mapping, rebuild existing groups atomically, and add the tracking-state dependency trigger. Installing performance after the UI already supports that modern classifier and dependency; perf-first followed by UI needs the adapter before UI release. This ordering must not be hidden as an approval dependency for the performance deployment.

## Remaining measurements

Production shadow population/index/refresh cost and real RPC post-activation mean/p95/p99 remain pending root coordination. No claim that production is below 50 ms is made. SQL exposes connections, cache and temporary IO statistics; available Supabase tools do not expose project CPU/memory time series. Obtain those from project telemetry for the same 24–72 h window; execution elapsed time is not CPU. Per-workspace cost instrumentation, Broadcast/cron idle-cost changes, load at 10/50/200 workspaces and compute/margin recommendations are separate workstreams and are not completed by this SQL optimization.
