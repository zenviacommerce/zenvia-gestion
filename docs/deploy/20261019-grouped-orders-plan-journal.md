# Grouped EU incremental Amazon Orders: local implementation journal

Status: local implementation only; no production, GitHub or deployment actions.
Baseline: local `perf/amazon-operational-write-suppression-20261019`, commit `febb27ac`.

## Approved behavior

One incremental Orders job per owner/account/EU region in each UTC five-minute bucket. Manual and reconcile producers use the same bucket identity, so the existing database unique key and ignore-duplicates upsert suppress repeated creation. Payload includes sorted unique active marketplace IDs and `region: EU`; scope is `region:EU`, marketplace column is null. The EU endpoint supports the ten explicitly listed European market IDs, with nine exercised together in tests. Other regions fail closed. No endpoint migration.

Hourly automatic incrementals enqueue finance/inventory only; the five-minute Orders-only producer handles Orders. Initial backfills retain their existing flat marketplace jobs, including Orders when enabled. Automatic source settings still apply.

Grouped Orders request all selected markets, traverse every pagination token, validate each response's actual marketplace before any page write, and route each market separately through existing analytics/operational writes. Grouped missing/outside marketplace identities fail. Legacy flat jobs remain supported; absent legacy marketplace identities retain the historical fallback.

All pages must finish before the worker calls success. Success records per-market watermarks using the actual requested safe `lastUpdatedBefore` bound, including the two-minute lag, and preserves any newer existing watermark. API/page failure cannot advance watermarks. Existing owner/account credential resolution, tenant filters, PII permission fallback, purge guards, confirmed cancellation guards and operational business-change suppression are retained.

## Necessary schema companion

`20261019183000_amazon_grouped_orders_controls.sql` replaces only the existing PII control whitelist function. It retains only `region: EU` and arrays of 1–10 known EU marketplace strings, canonicalized by sorted uniqueness, plus the exact prior controls. Arbitrary payload keys and invalid marketplace values are discarded. This migration is required: the deployed control trigger otherwise strips the grouped routing payload. No PII or pagination token is added to retention controls.

## Pagination/runtime limitation for review

No durable cursor is introduced. The worker passes its existing 300-second deadline to Orders. Before each grouped page, Orders requires 150 seconds remaining to allow existing SP-API retries/failure bookkeeping; insufficient budget throws and retries the whole original window. Partial pages may already be upserted, but checkpoint remains unchanged and replay is idempotent. This does not silently truncate a successful window.

This is a bounded-runtime implementation, not a guarantee for arbitrarily large backlogs. Large windows can repeatedly replay their early pages and exhaust attempts; operations must inspect failures and choose a separately reviewed narrower-window or durable-cursor design if observed. The unchanged LWA token-refresh fetch has no timeout, and DB/HTTP latency can exceed the reserve. The existing global heartbeat and job-owner completion guards remain unchanged. Durable cursors would require a separate safe persistence/retention design; raw response pagination tokens are not retained here.

## Deployment order (not executed)

1. Record exact production worker/orchestrator/shared sources, scheduler, migration and queue baselines, and rollback artifacts.
2. Apply the narrow PII-control migration before any grouped producer can run. Verify inserted/updated controls survive the real guard.
3. Deploy a grouped-capable worker first while producers still emit flat jobs; verify legacy job execution and single-owner lease behavior.
4. Deploy grouped producer/orchestrator/manual callers as needed for shared dependency bundling. Keep existing five-minute Orders scheduling; remove only hourly duplicate production through the orchestrator branch.
5. Observe one grouped job per owner/account/bucket, nine request IDs, last-market routing, per-market safe checkpoints, zero unchanged operational updates and one changed-status update. Review runtime/attempt behavior and queue age.

## Rollback order (not executed)

1. Stop grouped producers and restore their exact captured previous bundles/configuration.
2. While grouped-capable worker remains deployed, drain grouped jobs successfully, or pause worker and explicitly replace remaining grouped windows with equivalent legacy per-market jobs without advancing their checkpoints.
3. Restore captured previous worker only after no runnable grouped jobs remain. Legacy worker cannot consume null-marketplace grouped jobs.
4. Execute `docs/deploy/20261019-grouped-orders-controls-rollback.sql`, which restores the exact previous control-function body. Do not restore it while grouped jobs still need their payload: any update would strip their routing controls.
5. Verify restored schedule/queue and watermark continuity. Do not delete successful business data or rewind watermarks.

## Verification evidence

TDD: initial grouped-flow run failed eight cases (10 flat jobs instead of one; unsupported scope accepted; grouped worker rejected missing flat marketplace). SQL test against the original function failed because routing keys disappeared. Runtime-budget and explicit unsupported account-region tests each failed before implementation. Subsequent focused tests passed, including all twelve prior operational-write-suppression scenarios.

`npm test`: 14 files, 121 tests passed. Expected auth-resilience stderr simulates transport failures.

Broad `node --test scripts/*.test.mjs`: 1120 passed, 1 failed. The sole failure is the pre-existing environment-gated `scripts/mfa-real-integration.test.mjs` top-level assertion requiring `RUN_LOCAL_AUTH_VAULT_TESTS=1`, local Docker Auth/Vault and credentials. Those services were not provisioned or bypassed. A second broad run excludes only that integration fixture; final counts are recorded in the completion report.
