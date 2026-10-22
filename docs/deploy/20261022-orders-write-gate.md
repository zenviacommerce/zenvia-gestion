# Production write gate — 22 October 2026

**Gate not passed conservatively. Reads remain unactivated and `read_enabled=false`; maintenance remains on. No pg_stat_statements reset and no frontend publication.** PR #281 contains only the separately prepared visible-tab refresh frontend.

Each phase updated the same cohort of 200 real, non-purged Amazon orders, one harmless `updated_at` change per row. The transaction always rolled back. Receipts execute after ROLLBACK and verify `pg_xact_status=aborted`. The same cohort hash was observed throughout. Independent pg_cron connections split distinct groups across 1, 2 or 4 sessions; timestamp overlap and a separate observer confirmed actual concurrency. Earlier MCP parallel attempts were serialized and are excluded.

| Sessions | Off p50 / p95 ms | On p50 / p95 ms | Paired added p50 / p95 ms |
| --- | --- | --- | --- |
| 1 | 1.371 / 3.759 | 1.857 / 4.409 | 0.435 / 2.505 |
| 2 | 1.162 / 3.530 | 1.495 / 2.701 | 0.366 / 1.166 |
| 4, first | 1.197 / 4.472 | 2.176 / 7.176 | 0.685 / 5.385 |
| 4, repeat | 1.191 / 3.423 | 1.750 / 7.606 | 0.562 / 5.615 |

Paired differences match each actual row between separate-time on/off passes. They include scheduling/background-load variance and are not a causal microbenchmark of the trigger alone. The difference between phase p95 values is smaller (2.705 and 4.184 ms for four sessions), but cannot establish that the p95 of added per-row latency is below 5 ms. We therefore hold activation rather than declare that gate passed.

All eight phases completed 200 successful updates: 1,600 total rolled-back updates, zero timeout errors, zero trigger failure deltas, exactly 400 queued entries per enabled phase and zero per disabled phase. All 22 writer transactions are aborted. There were zero observed lock waits and zero observed advisory waits in 300 observer samples per phase, ~10 ms apart. This cannot exclude waits shorter than the sampling interval. Two/four-session overlap was observed in 22–40 samples per phase. A separate control restore and the observers restored maintenance; no benchmark cron jobs remain.

The jobs unschedule themselves at startup to prevent reruns; pg_cron labels these runs `job canceled` even though the post-ROLLBACK receipts and observers completed. Those scheduler labels are not used as evidence of benchmark success. Complete source, queue, failure and abort assertions determine validity.

## Proposed correction, not installed

`20261022085809_orders_projection_single_enqueue.sql` replaces only the private trigger function. An UPDATE whose tenant/group is unchanged enqueues once rather than twice. INSERT/DELETE remain one entry; a tenant or group move still enqueues both old/new groups. Exception handlers, failure ledger, 25 ms timeout, kill switch, freshness guard, reconciler and ACL/OID remain in place. No existing data UPDATE or DELETE and no DROP are present. The installed migration is unchanged. A function-only rollback is supplied.

Targeted PGlite tests first reproduced the duplicate enqueue, then passed with the proposal. The full SQL parity/failure/privacy/tenant regression also passes with the proposed replacement applied. Added checks cover failure of the second enqueue and execution of the rollback. Production latency of the proposal has not been measured and no improvement is claimed yet.

## Resource baseline and follow-up

Historical pg_stat_statements reset remains 2026-10-19 10:28:22 UTC. Baseline retained in `20261022-orders-preactivation-pgstats.json`; execution time is elapsed SQL time, not CPU. Two Metrics API observations 61.052 seconds apart yielded 7.78% non-idle CPU (6.19% excluding iowait/steal) and 45.55% memory use based on MemAvailable; this is a short pre-activation sample during diagnostic work, not a retrospective 2.8-day CPU average.

Metrics access is authenticated server-side with the existing Vault secret; no key is returned or stored in the repository. Private diagnostic receipts retain CPU counters, available/total/cache memory and load. `orders-projection-resources-24h` samples every five minutes and stops itself after 2026-10-23 09:15 UTC. This provides observation in shadow; the requested post-release 24-hour/reset comparison has not started. It starts only once the write gate is accepted and the frontend is published.
