# Orders RPC performance review — 2026-10-22

Production project: `sjkxxbedkkmgmqnvaqjh`. No performance migrations or statistics resets have been applied by this branch.

## Evidence

Production authenticated `aal2` calls for an active workspace member: pickup baseline **842.301 ms**, page baseline **773.748 ms**, with **1043/1045 temporary blocks written** respectively. The tenant initially contained 1014 source rows / 1000 deduped groups (986 singleton groups, 14 duplicate groups); live ingestion subsequently added a row. Snapshot timings are individual observations, not p95 or CPU measurements.

The same private pickup SELECT, using the RPC's definer privileges, verified workspace/MFA helper and explicit tenant predicate, took **835.103 ms before / 255.107 ms with singleton fast path**. The candidate wrote no temporary blocks. A same-statement full JSON equality comparison at 06:59:59 UTC returned true (7 matching pending/selectable rows). The private-table SELECT cannot run directly as authenticated because receipt membership tables intentionally deny that role; the real public-wrapper baseline above did run as authenticated.

The initial candidate alone does **not** meet 50 ms. The incremental projection precomputes the exact merged/classified row per changed dedupe group; query-dependent periods, overdue time, membership, KPI scopes, search, selection and pagination stay in the original RPC body.

**Historical synchronous candidate only (superseded by the fail-open revision below):** synthetic PGlite benchmark, 1014 rows / 1000 groups, seven warmed samples per scenario:

| RPC/scenario | Baseline mean | Projection mean | Projection maximum |
|---|---:|---:|---:|
| Page / pending | 222.64 ms | 20.88 ms | 22.04 ms |
| Pickup / pending | 208.58 ms | 22.69 ms | 23.47 ms |
| Pickup / search | 226.23 ms | 27.39 ms | 29.30 ms |
| Pickup / next page | 211.88 ms | 27.66 ms | 28.34 ms |
| Pickup / selection | 187.53 ms | 12.05 ms | 12.56 ms |
| Pickup / REC sort | 224.20 ms | 33.48 ms | 35.64 ms |

The historical synchronous candidate cost approximately 4.2–4.7 ms per warm single-group source update locally; that figure does not describe the enqueue-only revision. This WASM fixture is not production latency or 10/50/200-workspace capacity evidence. With seven samples nearest-rank p95/p99 both equal the maximum; they are not stable tail estimates.

`20261022-orders-pgstats-baseline.json` preserves the historic window since 2026-10-19 10:28:22 UTC. The 88.7 s outlier was identified, without re-execution, as a one-off five-period baseline CTE containing the full old dashboard body. It is not one normal page RPC. Historic Shopify 43-call/2448 ms and newer 265-call/55.7 ms normalized statements coexist; aggregate history cannot establish a current regression.

## Deployment, DML and rollback

1. `20261022064741_orders_singleton_merge_fast_path.sql`: function-definition changes only, plus at most one SQL-definition backup per target RPC (normally three). No source-order writes, no grants/wrapper/MFA-manifest changes, no DROP. Singleton PII sanitization mirrors the old merge, including malformed item JSON normalization.
2. `20261022065250_orders_incremental_classified_projection.sql`: **shadow only**. Creates one justified `(owner_id, dedupe-group)` expression index for bounded refreshes (existing owner/sendcloud, ASIN and SKU indexes are not duplicated), private typed derived projection, metadata/backup tables, and source triggers. Backfill INSERT/UPSERT affects roughly 1000 new derived rows. The refresh function contains UPDATE through `ON CONFLICT DO UPDATE` and DELETE of a derived group when classification produces no row; it never modifies source orders. Subsequent source edits only append dirty groups (old and new keys for moves); they never run the classifier or acquire group advisory locks. A bounded worker refreshes these groups. The source/tracking enqueue triggers use function-scoped 25 ms lock_timeout for auxiliary relation/index locks; this is a per-lock wait limit, not a statement runtime bound. Worker-only nonblocking advisory locks skip competing reconcilers. The initial nonconcurrent index holds a source-table write-blocking lock through the migration transaction/backfill; use an approved short maintenance window and inspect lock timeout/backfill duration first.
3. Run `20261022-orders-shadow-probe.sql` after shadow installation and before activation. It performs only a guarded tenant/MFA read plus EXPLAIN against the derived projection; no RPC definitions change. The frozen probe is for the current legacy schema and should be regenerated after a classifier release. Compare full JSON under the same timestamp and representative filters, including REC membership/sort, before activation. Preserve plans and take enough warmed real RPC samples for useful p95/p99 after activation.
4. `20261022070148_orders_incremental_projection_activate.sql`: replaces only the common classifier prefix with a guarded choice between a tenant-filtered fresh projection read and the original classifier. Eligibility checks compare every tenant source id/xmin/ctid/ctid token in both directions, optional normalized tracking tokens, queued dirty groups, and expected projection membership (including intentionally excluded groups). Missing config or any guard error chooses the original classifier. This adds an O(tenant source/derived keys) freshness scan to cached reads; the old timing table is not evidence for its performance. Fails closed if any RPC classifier differs from the shadow classifier. Leaves wrappers, grants, signatures and manifest hashes intact. Inserts normally three definition-backup rows; no business-row DML.

Read rollback restores function definitions with hash guards and revokes direct projection reads. **Dirty-queue triggers deliberately remain active** so later source purges/deletes invalidate reads immediately. The worker must remain scheduled to sanitize the private stored derived data. This is a read rollback, not full decommissioning; removing index/derived rows/triggers requires a separately reviewed cleanup. Source orders and statistics are never deleted/reset by rollback.

## Verification

Full suite for this checkout after the fail-open core revision: **68 files / 333 tests passed, 1 tracking dependency test skipped** (held tracking migrations are absent here). Final targeted SQL checks were rerun after cleanup and membership assertions. The modern tracking dependency fixture also runs in the held tracking checkout; record its separate result with the release review. Final targeted SQL tests execute both legacy and modern tracking classifiers, authenticated source writes, tenant isolation, MFA rejection, complete JSON equality, duplicate regrouping, visible Amazon → excluded Pending → visible transitions, malformed purged item JSON, source insertion/deletion/purge, and unchanged wrapper manifest hashes. Tracking-state updates invalidate modern cached classification; the bounded worker refreshes it before projection reads become eligible again. Shadow installation is asserted not to change RPC sources.

## Pending tracking UI compatibility

Performance can ship the current legacy classifier without publishing the tracking UI. The held tracking UI migration currently expects the original classifier inside RPC sources and will fail safely after projection activation. Its future cache-aware adapter must transform the preserved classifier, extend the typed projection with normalized tracking fields, regenerate the refresh INSERT/upsert column mapping, rebuild existing groups atomically, and add the tracking-state dependency trigger. Installing performance after the UI supports that modern classifier and its asynchronous dependency; perf-first followed by UI needs the adapter before UI release. This ordering must not be hidden as an approval dependency for the performance deployment.

## Remaining measurements

Production shadow population/index/refresh cost and real RPC post-activation mean/p95/p99 remain pending root coordination. No claim that production is below 50 ms is made. SQL exposes connections, cache and temporary IO statistics; available Supabase tools do not expose project CPU/memory time series. Obtain those from project telemetry for the same 24–72 h window; execution elapsed time is not CPU. Per-workspace cost instrumentation, Broadcast/cron idle-cost changes, load at 10/50/200 workspaces and compute/margin recommendations are separate workstreams and are not completed by this SQL optimization.

## Fail-open revision and operational controls

These files remain unapplied. The business trigger catches ordinary auxiliary errors, records a failure ledger row (count rows for a cumulative failure count), and returns successfully. Its recorder has another exception handler, and the trigger also protects invocation of that recorder. Dirty refresh failures retain their queue records and record owner/group/SQLSTATE without source payloads or error messages. If the queue itself is broken, an enqueue failure may have an owner/group failure record but no dirty row. If both queue and ledger fail, no durable failure counter can be promised; a fixed server LOG message is attempted. Source-versus-version validation still rejects the stale projection and uses the original classifier. The fallback does not depend on writing an emergency flag successfully.

PostgreSQL's `WHEN OTHERS` deliberately excludes query cancellation and assertion failures. Connection termination, transaction-wide cancellation, fatal resource errors and source/business constraint failures can still abort the business transaction. This is ordinary-error isolation for optional cache maintenance, not a claim that PostgreSQL can commit through every infrastructure failure. See [PostgreSQL exception semantics](https://www.postgresql.org/docs/15/plpgsql-control-structures.html#PLPGSQL-ERROR-TRAPPING).

Version stamps are captured before classifier refresh. A concurrent source/tracking commit between those statements produces a conservative version mismatch and fallback. The token includes ctid as well as xmin so repeated updates within the same transaction are detected even if queue recording fails. New queue ids after a worker's captured high-water mark survive its DELETE. Queue ids are append-only to avoid a contended per-group UPSERT; no global counter row is updated in the business transaction. The worker serializes only other workers with `pg_try_advisory_xact_lock`. Group-size and tenant scans still need real production plans and contention measurements.

Operational SQL, after deployment approval (not executed by this branch):

```sql
-- Independent immediate controls, no new migration/DDL.
UPDATE private.orders_projection_control SET read_enabled=false WHERE singleton;
UPDATE private.orders_projection_control SET maintenance_enabled=false WHERE singleton;
-- Resume maintenance first; reads remain conservative while stale/missing.
UPDATE private.orders_projection_control SET maintenance_enabled=true WHERE singleton;
-- Worker transaction: at most 100 groups; timeout is an operator budget.
BEGIN;
SET LOCAL statement_timeout='5s';
SELECT private.orders_dashboard_projection_reconcile(100);
COMMIT;
-- Recovery after a pause/queue outage: tenant keys may be scanned; at most 100 queued.
SELECT private.orders_dashboard_projection_repair_enqueue(:owner_id::uuid,100);
SELECT private.orders_dashboard_projection_reconcile(100);
-- Repeat repair/reconcile until both return zero, then re-enable preferred reads.
UPDATE private.orders_projection_control SET read_enabled=true WHERE singleton;
-- Failure counter and queue age (no payload/PII).
SELECT count(*) failure_count FROM private.orders_projection_failures;
SELECT count(*) queued_events,min(queued_at) oldest_event FROM private.orders_projection_dirty;
```

The shadow migration registers `orders-dashboard-projection` in pg_cron when available: every minute it calls independent cleanup (100 groups), then reconciliation (100 groups), in separate committed transactions with a 5 s statement timeout each (a slow reconciliation cannot roll back completed privacy cleanup). PostgreSQL test fixtures without pg_cron emit a NOTICE; production already has pg_cron and deployment must verify the job exists in `cron.job`. An alternative scheduler must be configured before activation on any environment without pg_cron. Monitor the job status and watch oldest dirty age and fallback frequency. A one-minute cadence means cache eligibility may fall back for up to that interval after writes. Reconcile and repair limits bound group counts, not the size of a single group, queue grouping scan (oldest 10 × batch-size queue events are considered), or total elapsed time. The queue candidate scan is capped; source/group lookup and privacy-cleanup discovery still depend on source size. Limit/timeout/batch frequency need tuning from the real sync workload. Retain/prune the failure ledger under the normal operational retention policy; the supplied worker does not discard failure history.

Stale derived PII becomes unreadable immediately through the restrictive freshness policy (including direct authenticated SELECT) and RPC fallback. Independent `orders_dashboard_projection_cleanup(100)` removes stale derived groups containing a source purge, no remaining source, or a deleted/moved source member (including a surviving duplicate group). It ignores both switches, uses nonblocking worker group locks, deletes at most 100 derived rows per tick, and queues rebuilding separately. It never modifies source orders/tracking. Thus pausing maintenance does not pause physical cleanup. The normal cleanup interval is one minute plus backlog processing (100 groups/tick); scheduler failure, repeated worker contention or the 5 s budget can extend it and must alert. Freshness blocks stale PII exposure immediately, but physical deletion is asynchronous and requires job-health/oldest-queue monitoring; this remains a retention change from synchronous maintenance. An operator can call cleanup directly while reads/maintenance are disabled. Do not treat a read kill switch as a purge.

The previously prepared cache-aware held tracking-UI adapter targets the historical synchronous projection shape. It is obsolete for this revision and must be regenerated/reviewed before use; this branch does not approve or deploy tracking UI.

## Required real Amazon sync and contention measurement

The read-only receipt `20261022-projection-live-preflight.json` confirms the projection is absent; a point-in-time observation of zero advisory lock waiters is not a contention benchmark. Real trigger overhead p95 and contention cannot be measured honestly before the migration is approved/applied. No source update, migration, RPC replacement, statistics reset or synthetic production write was executed for this revision.

After approval, capture at least 100 real Amazon sync page/batch transactions per alternating maintenance-disabled/enabled window at comparable row counts, account, order age, duplicate-group distribution and worker concurrency. Instrument the existing sync transaction around its normal DML/commit (elapsed monotonic time; no payloads), record affected rows, retries, queue age, failure-count delta and API/network time separately. Report p50/p95/p99 transaction duration and per-row database duration with sample counts; use an isolated production-like clone or approved controlled operational windows to distinguish toggle effects from load. Both paths still include the small trigger dispatch/control read, so a trigger-disabled clone is needed to isolate all trigger overhead.

During overlapping Amazon writes, tracking polling and reconciliation, sample `pg_stat_activity` wait_event_type/wait_event and `pg_locks` advisory granted/waiting counts on a second connection at short intervals. Confirm source-write query texts never wait on advisory locks; test two concurrent workers targeting the same group (second skips) plus a source write while the first worker holds its group lock (source commits, queued id survives, guard falls back if necessary). On a disposable real PostgreSQL clone, also hold ACCESS EXCLUSIVE on the queue and failure ledger separately and together: source writes should commit after bounded auxiliary lock waits and RPC parity must hold with missing dirty records. PGlite cannot validate multiple-session lock contention. Include EXPLAIN (ANALYZE,BUFFERS) for fresh and fallback RPCs, source-write trigger timings, tenant freshness scans, and queue scan size. Report any unmeasured production p95/contention as pending, never as zero.

## Revised synthetic measurements

`scripts/orders-projection-failopen-benchmark.mjs` writes a separate `20261022-orders-projection-failopen-benchmark.json`, preserving the historical candidate receipt. It uses 25 warmed samples per RPC scenario and 100 warmed single-row Amazon-shaped UPDATEs per maintenance toggle. The saved receipt includes the xmin/membership guard and explicitly predates the final xmin+ctid token and independent cleanup additions; it is illustrative rather than an exact final-revision result. Rerunning the script captures migration SHA256 values with new timings. It is single-process PostgreSQL WASM: no real Amazon requests, no concurrent sessions, and no production p95 or contention evidence. P95 differences between toggle windows are descriptive local measurements rather than a causal tail-overhead estimate. Real measurements above remain pending approval.
