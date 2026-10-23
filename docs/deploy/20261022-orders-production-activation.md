# Orders production activation — 22 October 2026

Owner approved the observed 5.6 ms concurrent-write margin and authorized read activation, PR281 publication, statistics reset and subsequent single-enqueue installation after CI green.

## Installed and verified

- Read routing migration 20261022070148 applied with read switch initially OFF. It backed up three original implementations; the public MFA wrapper is unchanged.
- The first freshness check correctly refused a stale projection: one source version had changed during the earlier maintenance-OFF benchmark interval. Bounded repair/reconciliation rebuilt it. No stale result was authorized.
- Exact full-JSON public RPC parity passed14/14 before activating the global switch and again after activation at09:12:58.833UTC. Last postactivation samples (one per case, not a new latency percentile): pending page91.636ms versus858.434ms fallback; pending pickup55.190ms versus666.575ms fallback.
- Frontend PR281 merged as fdf991df572769136b772db6e9ad147c2769b260 after6/6CI green. Vercel commit status success. Public https://gestion.zenviacommerce.com returns200 and serves index-Cq7mUe6G.js, SHA256 0bce930596497ecc89d2934d3b853041d35a41d83736e8c468f9245f9872bae7, byte-identical to the tested local production build.
- Single-enqueue migration20261022085809 applied after its exact PR280 headf645e9d1699b14834eeff8b27fc7f2bf441632c3 passed6/6CI. OID3877413, ACL{postgres=X/postgres}, search_path and25ms timeout unchanged. Function hash changed30d1218a555db66aa3d74f6a7d97c173→0dc05711e36f5599371517d0a448010d.
- Serial200real-row rollback test:200queueentries,0failures/timeouts, transaction aborted; p501.4265ms,p952.2516ms total.
- Four actual independent sessions,50realrows each, enabled then disabled: both phases200updates and aborted transactions, one queueentry per enabled update and none disabled. Same cohort hash throughout. Enabled totalp501.872ms,p956.8914ms; disabled1.1635/2.5255ms. Paired differences0.715/5.67215ms, including separate-phase scheduling variance. No sampled lock/advisory waits. This does not establish <5ms concurrent overhead or a large latency reduction; it halves redundant enqueue volume.
- After the briefly disabled benchmark phase, bounded repair/reconciliation processed14groups. Full JSON parity passed14/14 again. Both switches restored ON; source orders were never committed by diagnostic updates.

## Rollback

Immediate read rollback, retaining maintenance and exact legacy fallback:

```sql
UPDATE private.orders_projection_control SET read_enabled=false WHERE singleton;
```

Single-enqueue function rollback: supabase/rollback/20261022_orders_projection_single_enqueue.sql. Original read function definitions remain backed up privately and the existing full projection rollback remains available. For frontend rollback, revert the PR281 merge with CI; the prior main is4a268924213ac29f9d1f74d5ca1b269d032aa5b9. No MFA, PayPal or subscriptions changed.

## 24-hour window

Pre-reset full top60query/database statistics retained in20261022-orders-before-pgstats-reset.json. pg_stat_statements reset verified2026-10-22T09:19:20.702302UTC (11:19:20Europe/Madrid). No reset of source data or CPU/memory counters.

CPU/memory collector every5minutes uses the existing Vault secret entirely server-side and retains only selected resource series privately. It self-stops after23October09:45UTC. One-time comparison scheduled23October09:19:53UTC (11:19:53Europe/Madrid). Compare normalized call/time rates against the retained baseline, distinguish elapsed SQL time from CPU, and state that historical CPU baseline is only a short diagnostic sample. New tracking UI remains unpublished for screenshot review.
