# Tracking UI and asynchronous projection compatibility

Implemented locally on top of `a4a868b`. The unapplied UI migration dispatches to the additive adapter when a projection exists; its legacy path still installs normalization directly. The adapter was created with `supabase migration new shipment_tracking_projection_compatibility`, producing `20261022093845_shipment_tracking_projection_compatibility.sql`. Applied 65250, 70148 and 85809 are unchanged. No 64741 dependency exists.

## Upgrade behavior

The adapter verifies every activated RPC against its optimized backup hash, verifies the common preserved classifier and existing projection column names/types, and normalizes preserved originals rather than nested guarded RPCs. Its temporary classifier shape provides the explicit ordered column mapping for both UNION arms and refresh INSERT/UPSERT. New columns are restricted to the nine tracking fields; unexpected source column additions fail closed. Shadow RPCs receive normalized source definitions without activating reads. A clean installation that ran the UI migration before 65250 already has a tracking-aware projection and is left intact.

Existing projection groups start on generation 1; the required generation is 2. Usability rejects old or missing manifests, including excluded groups with no derived row. Existing derived group manifests are enqueued without source writes. The existing bounded worker rebuilds them asynchronously. Refresh captures order and tracking `xmin:ctid` before classification, writes the derived row and completeness manifest, and advances the generation only after those writes succeed. Original source enqueue, worker advisory serialization, independent cleanup and cron schedule are preserved.

Tracking dependency writes enqueue the distinct affected source group(s) only, with the same function-scoped 25 ms auxiliary lock budget and nested queue/recorder error handlers as the applied source design. Tracking I/U/D and identity/account changes are checked against snapshot tuple versions, even after a missed enqueue. Repair discovery finds tracking version mismatches, deleted tracking rows and old/missing group manifests. Neither source nor tracking triggers classify synchronously or take advisory locks.

Operator read/maintenance switches are preserved. Backups now contain normalized uncached definitions and the new guarded definition hashes. Public wrappers, signatures, MFA manifest and grants remain unchanged. The rollback `supabase/rollback/20261022_shipment_tracking_projection_reads.sql` hash-checks all optimized definitions, restores normalized source semantics and disables reads; it retains maintenance, privacy cleanup and UI semantics. It is deliberately a one-way read rollback and rejects a second invocation after definitions have changed.

## Local evidence

The original opt-in reproducer failed with `each UNION query must have the same number of columns` before the change. The historical stale-result case is now covered by comparing full JSON before and after source changes, with the guard explicitly exercised.

`tests/orders-tracking-projection-compatibility.test.ts` runs in normal CI with PGlite. Its fixtures are exact copies of the approved applied migrations, with SHA256 values recorded in the original compatibility review. `APPLIED_PERF_ROOT` can optionally select a local checkout instead; no service database is accessed. The previous opt-in entry point imports the same CI matrix.

The matrix covers legacy UI-only, shadow projection, active projection, UI-first clean-install ordering and disabled switches at upgrade. It compares page/pickup full JSON against separately cloned normalized uncached definitions, including states/tracking filters, issue rows, search, pagination, selected IDs, selection-all, date range, REC membership and numeric sort, facets and KPIs. Fresh-cache and fallback behavior are both asserted. Further checks cover source/tracking I/U/D, same-transaction tuple updates with deliberately erased queue entries, account/identity mismatches, regrouping and tenant movement, missing cache rows, excluded old-generation groups, simultaneous queue and ledger failure, MFA/tenant/permission checks, wrapper hash preservation, direct stale-cache access, cleanup with switches disabled and normalized read rollback. Migration application is also checked not to alter source JSON.

The earlier review's paused-maintenance assertion updated the already excluded Amazon Pending order but expected one delivered row. The test now updates another order, preserving its intended assertion.

## Operational limits

PGlite verifies SQL execution and snapshot-visible behavior, not PostgreSQL multi-session lock contention, cron transaction boundaries, migration relation-lock wait behavior or warmed production plans. Those remain explicit deployment verification items. No database, provider, GitHub or deployment action was performed for this implementation.

Operational risks remain the brief projection-table DDL lock (3 s lock timeout), extra per-tenant tracking-version validation, source-fallback latency during asynchronous generation rebuilding, dirty-queue/rebuild backlog and cleanup throughput. The migration enqueues existing derived groups but performs no synchronous backfill. A missing queue after an outage fails safely to source; run bounded repair discovery plus reconciliation to restore cache eligibility. Disabled maintenance intentionally keeps reads on source until the operator resumes it.

Final verification: `npm test` passed all **76 files / 374 tests**, including all five compatibility matrix scenarios (85.79 s overall). `git diff --check` passed. Fixture SHA256 values match the original review. PGlite's lack of multi-session PostgreSQL semantics remains a limitation; extra-cache-row and duplicate-member-removal behavior retain the original symmetric guard/cleanup code but do not yet have dedicated new scenario assertions here.

## MRW classification follow-up

Independent review reproduced a SQL/UI mismatch: direct MRW with no normalized observation and legacy `SHIPPED` was classified as `transit`, while the UI correctly showed unavailable tracking. Both unapplied normalization paths now suppress the legacy tracking-class fallback for `shipping_provider='mrw'`. Confirmed normalized MRW observations retain priority even when a provider access error is present. Explicit cancellation in source status still produces a cancelled order.

The regression first failed with `expected 'transit' to be 'none'`. Each installation scenario now checks the classifier directly and the transit RPC filter: unconfirmed MRW is `none` / zero transit rows; confirmed `in_transit` with an access error is `transit` / one transit row. The directed legacy test passed after the correction.

Follow-up verification on the corrected code: `npm test` passed **76 files / 374 tests** (120.54 s), including all five MRW installation scenarios. `git diff --check` passed.
