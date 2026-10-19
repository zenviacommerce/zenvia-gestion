# Shopify performance implementation plan

Goal: preserve every KPI and permission while removing repeated timezone catalogue scans and reducing four period RPCs to one bounded batch.

1. Capture production definitions, authenticated EXPLAIN BUFFERS and internal query plans; preserve exact rollback. No JSON parsing or full-list client aggregation found. Existing owner/date/store indexes already support ranges.
2. Test parity on real PostgreSQL/PGlite with normalized order/refund/catalog fixtures, DST boundaries, missing costs/FX, shop and owner scope, MFA denial, batch bounds and invalid periods. Assert timezone lookup once per batch.
3. Add private period core accepting already authorized owner and resolved timezone; retain public MFA wrappers and metadata. Resolve timezone once in products. Materialize shipping calculation to avoid repeated scalar evaluation. Batch max8 period ranges, same transaction, returns per-period data/errors. No shared Amazon helper changes.
4. Service/cards call batch once; products use independent request capacity. Preserve presentation and current scope. Test loading/error and tenant invalidation.
5. Full tests/build, PR and CI. Transactional production rehearsal must demonstrate exact parity and rollback. Backend deploy only with green CI and snapshot; screenshots desktop/mobile; STOP before frontend merge/publication.
