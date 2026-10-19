# PR237 Orders pagination and server KPIs — NOT deployed

Updated on main966a41; approved shipping UI and disabled-MFA startup preserved. Removed Amazon write suppression/status RPC changes from this PR; those are separate production changes/PRs. Only proposed Orders RPC/UI and tests remain.

One invoker/RLS-protected RPC returns a bounded page (default25,max100), total, global matching KPIs and facets. No full initial download; bulk/invoicing explicitly retrieve matching pages, capped2000, and reject changed/incomplete target sets. Global sorting includes weight/units/print status; client preserves returned ordering. Purged-only pending backlog cannot initiate bulk labels.

Real PGlite/PostgreSQL test uses production column types only, synthetic records and two authenticated tenant roles. Verifies pages25/25/20, global120pending/10shipped KPIs, filtering/sorting, max100, EXECUTE privileges, owner isolation, duplicate merge of121EUR/items/address, purge propagation/redaction and incident classification. Materialized merge stages avoid repeated composite expression evaluation. UI test navigates60synthetic orders in pages25 without provider quotes. Existing real ZIP/PDF/PII regressions adapted to the new RPC boundary. Service tests load105bulk targets and reject changing counts.

Independent review caught and fixed loss of fallback duplicate data, purge-country mismatch, shipped/incident precedence, and malformed-item PII propagation. No schema/function change applied to production. Local validation and CI receipts to follow.

STOP before merge, migration application or publication. Future rollback: Vercel Instant Rollback to last accepted build; remove only the newly installed dashboard RPC if reverting a future SQL rollout (no historical Amazon functions touched). Production remains accepted index-BNSeQGme.js; Amazon worker39/reconcile10/sync-orders21 are separate backend release.

CI exposed repository-history schema gaps (tracking_status_code absent in disposable database). Extended ONLY the existing runner-only schema fixture with production column types from tests/fixtures/orders-table-schema.sql. No production migration/history/schema alteration for this fixture. Other four workflows were already green; rerun all on final SHA.


Final gate: source8151a220000951bf1fa6766be807b9a3b9638d25; all five workflows completed success. Local125Vitest/1098Node/build. Independent review findings fixed. STOP: no merge/SQL/deployment; production RPC absent, accepted frontend alias unchanged. Receipts in 20261019-followup-ci-receipts.json.
