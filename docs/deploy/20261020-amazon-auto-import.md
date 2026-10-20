# Amazon automatic import investigation — 20 October 2026

Read-only production observations from 11:16–11:30 UTC (13:16–13:30 Europe/Madrid), project `sjkxxbedkkmgmqnvaqjh`.

## Established evidence

- Deployed Orders v24 and worker v42 have byte-identical worker entrypoint, shared Orders implementation and shared queue implementation to main `9ce09977`.
- Orders producer and worker both run `*/5 * * * *`. The producer can enqueue just after the worker has finished claiming; an example Orders job created 09:15:05 UTC started 09:20:00 UTC.
- At 11:28 UTC: 60 Amazon orders purchased today Madrid, first analytics import mean 7.92 minutes after purchase, maximum 19.49 minutes. These timings include Amazon publication time, scheduling and import; publication time is not independently recorded.
- Orders queue: 160 automatic (`payload.mode=hourly`) successes, one manual success and one queued. Automatic average queue wait 153.5 seconds, maximum 376 seconds. No failed or running jobs; two historical superseded jobs remain. No active/stale worker lease.
- Both cron jobs had 162 succeeded SQL invocations. That proves HTTP enqueue SQL succeeded, not destination completion. Retained pg_net responses included 71 HTTP 202 worker acceptances and one HTTP 200 already-running response. Eleven global pg_net timeout responses were also present; destination attribution is unavailable from these retained response rows, so they cannot all be called Amazon worker failures.
- Nine per-marketplace Orders cursors were aligned at 11:18:04 UTC, last success 11:20:15 UTC, same grouped job.
- The current six-hour replay overlap is already broader than 10–15 minutes. Both initial and incremental requests cap their upper bound at now minus two minutes. Grouped page failure prevents successful completion and checkpoint advancement.

## Merchant-fulfilled orders today

All timestamps below are Europe/Madrid. `purchase_date` is normalized from Amazon `createdTime`; there is no separate independently observed Amazon creation/publication timestamp.

| Order | Purchase | First analytics insert | First operational insert | Purchase → operational |
| --- | --- | --- | --- | --- |
| 407-8017670-0175504 | 11:04:24.121 | 11:20:06.614 | 11:20:07.186 | 15m43s |
| 402-8935535-6572312 | 12:30:00.794 | 12:40:04.017 | 12:40:04.700 | 10m04s |

Both first inserts precede today's only manual Orders job (13:10:03 created, 13:10:06 started). They occur within automatic worker intervals, so neither first import was caused by that later manual request. There is no persisted per-row import job ID; do not invent one. FBA orders intentionally populate analytics without creating merchant fulfillment rows.

The second merchant order was updated at 13:11:21 after the manual request, with operational `order_updated_at=11:11:21 UTC`, later than analytics Amazon `last_update_date=10:59:06 UTC`. This merits reconciliation/status investigation. Existing first-insert evidence does not establish why the user's screen showed the order only after refreshing.

## Narrow correction

Apply `20261020113031_amazon_restore_worker_cadence.sql` only after review/CI. It changes the existing worker schedule to `* * * * *` using `cron.alter_job`; the deployed invocation command, job ID, enabled state, producer cadence, credentials and auth remain intact. Missing worker configuration aborts instead of silently succeeding. Existing worker lease protects against overlapping execution.

This removes the demonstrated extra queue delay. It does not promise Amazon publication latency below five minutes or establish the cause of the reported UI observation.

## Deployment verification and rollback

1. Save the current cron row including job ID, schedule, command and active state before applying.
2. Apply the migration; verify only the worker schedule changed.
3. Observe at least two real minute invocations and their HTTP/worker results, fresh lease cleanup and actual queue start times. Observe the next real merchant order when one exists; do not fabricate a future order or manual test production data.
4. Compare nine Orders cursors, first analytics/operational insert times and queue errors after the change.
5. Roll back only the schedule using `select cron.alter_job(<captured_worker_job_id>, schedule => '*/5 * * * *');` if needed. No Edge deployment is needed for this scheduler correction.

## Local verification

- Cadence regression failed against production-like five-minute scheduling, then passed with the migration in PGlite. It verifies invocation preservation, unrelated schedule preservation and idempotence.
- Grouped runtime coverage verifies all nine marketplaces, oldest per-market cursor selection, late-published replay, pagination failure without cursor advancement, and safe initial/incremental API cutoffs.

## Status visibility and future provenance

The 13:00:05 automatic worker's safe bound was approximately 12:58:05 Madrid, before the second merchant order's Amazon update at 12:59:06. The next automatic job was created 13:05:04 but did not start until 13:11:20, finishing 13:11:23. Its processing interval includes that order's operational last_synced_at=13:11:21.772; the manual job had already completed at 13:10:11. This demonstrates avoidable queue delay when applying a later order update. Historical initial status is not stored, so Pending-to-Unshipped remains a hypothesis.

The shared Orders importer now emits amazon_operational_order_first_import only after a successful new operational insert. Fields are job ID, job enqueue time, mode, recovery flag, order/marketplace identifiers, initial status, Amazon created/updated timestamps and observation time. Names, contact details and addresses are excluded. Replays, updates and unique-conflict recovery emit no first-import event and add no database writes. Deploying this instrumentation requires redeploying worker and Orders Edge bundles; scheduler correction itself requires only the migration.

Local pre-instrumentation full verification passed 1,140 Node tests, 217 Vitest tests and the production build. Instrumentation has four additional passing runtime cases: automatic/manual first-insert origin and no false first-import event for an existing order or unique conflict. Final Node suite after instrumentation passed 1,144 tests. Two additional real-worker dispatch tests then passed, covering new-order import across all nine marketplaces and partial-failure retry with no cursor advancement.

Manual recovery can enqueue `mode=hourly,recovery=true`; `hourly` alone is not proof of an automatic origin. Read the recovery flag and correlate the job ID with its enqueue context. Historical payload controls may omit the recovery flag, so historical hourly counts identify a queue mode rather than proving every job was cron-created. The two first imports demonstrably predate the observed later manual refresh, but there is no historical row-level origin field.

The current payload allowlist removes recovery, so the event also recognizes the persisted recovery-prefixed job key. This preserves recovery attribution without changing the payload privacy allowlist or the manual recovery API.

A read-only job-key check found no recovery-prefixed Orders jobs today and confirmed the three timing examples use incremental:orders:region:EU keys for 09:15, 10:35 and 11:05 UTC. This rules out the known manual recovery path for those examples, while retaining the absence of historical per-row import attribution.

The event enqueued_at is the queue row created_at, distinct from imported_at and Amazon createdTime. The existing importer maps Amazon createdTime to analytics purchase_date and operational order_created_at; the log preserves that same API timestamp without inventing an independent Amazon publication timestamp. A target below five minutes is measured from API availability; a five-minute producer plus a two-minute safe API lag cannot guarantee purchase-to-import below five minutes for every order.

Official API reference: https://developer-docs.amazon.com/sp-api/reference/searchorders documents the two-minute upper-bound requirement, PENDING versus UNSHIPPED meanings, and default rate 0.0056 requests/second with burst 20. Retaining the five-minute producer avoids increasing SP-API request frequency while the worker polls the database each minute.

Final review verification: 1,148 Node tests passed (including recovery origin after payload scrubbing, enqueue timestamp, worker dispatch, and rollback), 28 focused tests passed. Earlier full Vitest (217 tests) and production build passed.
