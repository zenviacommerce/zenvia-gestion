# Held tracking UI versus active order projection — local review

PR #279 backend is **not ready for approval** with either historical adapter path. This review is local only: no database access, no deployment, no edits to applied SQL. The active read projection and single-enqueue source trigger must remain intact.

## Reproduced blockers

| Path | Local result | Implication |
|---|---|---|
| Held original `20261022060202_shipment_tracking_ui_release.sql` on active 65250 → 70148 → 85809 | Fails `each UNION query must have the same number of columns` | Its text transform adds tracking columns inside the original fallback classifier, but the projection arm retains the old column shape. The migration must fail atomically; it cannot be deployed unchanged. |
| Historical cache-aware adapter from local commit `b37749c` | After normalized rebuild, source UPDATE to excluded Amazon `Pending`: current RPC returns **60** issue rows; normalized uncached reference returns **59** | Adapter replaces the guarded RPC with a direct cache read. Dirty groups no longer fall back, so it serves stale results. |

The requested historical integration `92a51c8c` is not a resolvable object in this local repository. The historical adapter source available locally is `b37749c`, which was previously identified as that integration's adapter. No claim is made that every other change from the unavailable commit was reviewed.

Further source inspection confirms that adapter also overwrites the refresh function without source/tracking version stamps or the group-completeness manifest, and adds a synchronous tracking trigger using blocking `pg_advisory_xact_lock`. That would undo the approved asynchronous, fail-open design. Its passing original tests covered the former synchronous projection rather than the currently applied architecture.

## Reproduction and scope

Isolated branch: `review/tracking-active-projection`, based on held tracking `84aa9248ccb8f21128f93401024ea169bdedc3a6`. The separate worktree merging main into #279 is untouched. Neither unapplied 64741 singleton fast path nor a new adapter is installed in the fixture.

The opt-in harness uses PGlite and synthetic orders. It reads exact local copies of the applied migrations as fixtures; it never connects to a database service. It is outside the default Vitest include pattern, so known failures do not break normal CI.

```bash
# Original held UI: known failure on UNION width.
APPLIED_PERF_ROOT=/path/to/checkout-containing-approved-performance-sql \
  npx vitest run --config reviews/vitest.review.config.ts

# Historical adapter: known behavioural failure, cached 60 versus reference 59.
APPLIED_PERF_ROOT=/path/to/checkout-containing-approved-performance-sql \
  REVIEW_ADAPTER=historical \
  npx vitest run --config reviews/vitest.review.config.ts
```

The fixture files are the three paths under `supabase/migrations/` with these SHA256 values:

| File | SHA256 |
|---|---|
| `20261022065250_orders_incremental_classified_projection.sql` | `c2b853d73be198f3b94515d1a4f0e8979b87d577bebb081df33ecc94f0ce6cbf` |
| `20261022070148_orders_incremental_projection_activate.sql` | `7dd2876f8f89344ee0adf4eb33c9e8d08c2607cd4ee05469ba15953b1e8b5143` |
| `20261022085809_orders_projection_single_enqueue.sql` | `66ddbc2e9fec23d03dfb43b7d8ac76c061c748ddb72a09fd3d1192940069e7a1` |

The harness first verifies normalized exception rows after upgrade, then compares an actual cached RPC with a reference cloned from the normalized backup definition following a source update. Additional invariants in the harness require the eligibility gate, source-version stamps, the single-enqueue trigger, and normalized fallback with maintenance paused. The known failures stop execution before those later checks; they are **not** reported as passing.

## Minimum recommended change, for review before implementation

Leave applied 65250, 70148 and 85809 byte-for-byte unchanged. Replace the unapplied UI migration's direct RPC text transform with an explicit projection-aware dispatch, coordinated with a new additive compatibility migration in the held #279 release. Do not ship the old adapter first and repair it later; the release must be valid at every committed boundary.

1. Guard all targeted live RPC definitions against their existing optimized backup hashes. Build the normalized uncached definitions from preserved `original_definition`, not by searching inside the currently nested guarded RPC body. Preserve signatures, security attributes, grants, public MFA wrappers and manifest entries.
2. Add the normalized tracking columns to the derived projection. Use one explicit canonical column-name/type/order mapping for **both** UNION arms and refresh INSERT/UPSERT. Physical ALTER TABLE column order is different from the classifier's new column order; `SELECT *` and the historical positional mapping are unsafe here.
3. Add a classifier generation marker to group metadata and the required generation to classifier state. Update usability to reject any tenant group still on the old generation, including excluded groups with no derived row. Keep the existing source `xmin+ctid` comparisons, missing/extra-row checks, dirty check, both switches and exception-to-fallback behaviour.
4. Extend refresh while retaining its source stamps captured before classification, group-completeness manifest, and add tracking stamps captured before classification in the same conservative order. A successful rebuilt group marks the new generation only after all derived data/metadata writes succeed. Queue existing groups for bounded rebuilding; avoid a source-table lock held across a full synchronous rebuild. Retain the independent scheduled PII cleanup.
5. Add an **enqueue-only**, single-group tracking dependency trigger with the existing 25 ms function-scoped auxiliary lock budget and nested failure handlers. Never introduce a group advisory lock or classifier refresh on provider/source business writes. Extend both usability and bounded repair discovery to tracking INSERT/UPDATE/DELETE, account/identity changes and missing tracking records.
6. Regenerate the 70148-style guarded RPC prefix using the normalized source fallback and explicit identical column shapes. Update backups to normalized originals and new optimized hashes so a later read rollback preserves UI semantics. Preserve the operator's existing switch values; do not silently re-enable disabled reads/maintenance. Old-generation groups must safely fall back until their bounded rebuild succeeds.

This is a proposed design, **not an implemented or deployment-ready migration**. The held UI's grants, policies and normalization helper must still run exactly once. Its legacy path without a projection should remain supported and tested. The new migration must fail closed on unexpected classifier/hash/schema shape rather than guessing how to rewrite it.

## Required verification before #279 backend approval

| Area | Required evidence |
|---|---|
| Install ordering | Existing active async projection → new UI, legacy UI-only path, and shadow-only projection; no 64741 dependency. |
| Full RPC parity | Same-snapshot full JSON against normalized uncached references for page/pickup: all/pending/issues/returned/cancelled, search, pagination, selection subsets/all, dates, REC membership/sort, facets and KPIs. Exercise fresh-cache and fallback paths explicitly. |
| Normalized dependencies | Tracking insert/update/delete changes classification after reconciliation, and immediately through fallback before reconciliation; validate matching account/identity, mismatched identity exclusion, and provider-time fields. |
| Fail-open | Forced projection error; queue error; simultaneous ledger error; business UPDATE still commits and safe fallback remains; missed queue can be repaired. Source and tracking triggers remain enqueue-only. |
| MVCC/completeness | Repeated updates in the same transaction detect `xmin+ctid`; old-generation groups, missing/extra cache rows, excluded Amazon groups, regrouping and tenant moves reject stale/incomplete cache. |
| Privacy/access | Foreign tenant, missing orders permission, MFA rejection, no direct authenticated stale-cache reads; purge/delete/duplicate-member removal while maintenance/read switches are off; independent physical cleanup remains active. |
| Rollback/ACL | Hash-guarded read rollback restores normalized source semantics, wrappers/manifest and restricted grants remain valid, no source DML by migration/rebuild. |
| Real PostgreSQL | Multi-session provider writes versus source writes versus worker, nonblocking worker contention, auxiliary relation lock budget, cron transaction separation, migration DDL lock/time budget and warmed activated-RPC plans. PGlite alone cannot establish these. |

Risks requiring explicit review are migration lock duration, fallback latency while generations rebuild, additional tracking-token scan cost per tenant, bounded rebuild/cleanup backlog, and the semantic changes of normalized cancellation/returned states. This review does not authorize UI publication, backend migration, production measurements, or a change to the 24-hour statistics observation window.
