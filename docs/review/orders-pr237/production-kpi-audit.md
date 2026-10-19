# Production KPI audit — final candidate

Candidate: `b4b42760ab82d9dd79acae923b895715acacc6e9`. Reference accepted main: `966a41acca9f794e97513f7735b0aea990e0c353`. Production snapshot: **2026-10-19T13:11:30.397888+00:00**, dates interpreted in **Europe/Madrid**.

The exact final migration SELECT CTE was evaluated directly without installing the RPC. The owner predicate is inside ranked base and reference input selection. Candidate results and sanitized reference inputs came from the same SQL statement/snapshot. No production writes or schema/function/policy changes.

“Current” means accepted main mapRow/dedupe/awaiting-payment/date/status/tax business logic executed independently against that production snapshot, not a previous screenshot. There were 989 owner source rows and 975 deduped/payment-filtered orders, below main’s 10000-row limit. Exact reference functions are included in `reference-main-extracted.ts` and transpiled using repository TypeScript; reference executed with `TZ=Europe/Madrid`. Contact/address values were presence markers, order numbers hashed and items reduced to nonempty markers; no row fixtures are committed.

| Period | Version | Pending | Amazon | Shopify | Manual/API | Labelled | Shipped | Cancelled | Gross EUR | Sales count | VAT EUR |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Hoy | current | 2 | 1 | 1 | 0 | 0 | 25 | 0 | 182.61 | 6 | 31.69 |
| Hoy | candidate | 2 | 1 | 1 | 0 | 0 | 25 | 0 | 182.61 | 6 | 31.69 |
| Mes actual | current | 2 | 1 | 1 | 0 | 0 | 131 | 4 | 3484.93 | 129 | 606.36 |
| Mes actual | candidate | 2 | 1 | 1 | 0 | 0 | 131 | 4 | 3484.93 | 129 | 606.36 |
| Trimestre | current | 2 | 1 | 1 | 0 | 0 | 131 | 4 | 3484.93 | 129 | 606.36 |
| Trimestre | candidate | 2 | 1 | 1 | 0 | 0 | 131 | 4 | 3484.93 | 129 | 606.36 |
| Año | current | 2 | 1 | 1 | 0 | 0 | 912 | 61 | 22205.09 | 914 | 3869.63 |
| Año | candidate | 2 | 1 | 1 | 0 | 0 | 912 | 61 | 22205.09 | 914 | 3869.63 |
| Todo | current | 2 | 1 | 1 | 0 | 0 | 912 | 61 | 22205.09 | 914 | 3869.63 |
| Todo | candidate | 2 | 1 | 1 | 0 | 0 | 912 | 61 | 22205.09 | 914 | 3869.63 |

**Result:** all seven status KPIs and sales count match exactly across all five periods. Gross and VAT match to displayed cents. Quarter exactly meets expected pending 2 (Amazon 1, Shopify 1), shipped 131, cancelled 4, gross 3484.93, count 129, VAT 606.36. Residual unrounded differences are JavaScript floating-point arithmetic versus PostgreSQL numeric arithmetic/sum order (less than 0.000000001 EUR).

Inclusive periods: Hoy 2026-10-19; Mes actual 2026-10-01–2026-10-31; Trimestre 2026-10-01–2026-12-31; Año 2026-01-01–2026-12-31; Todo unbounded (main still requires a valid date key). Pending/labelled queues ignore period; sales/cancelled use created date; shipped uses fulfilled/tracking-updated/label-created/order-updated/order-created fallback.

Final candidate includes weight +4 and mapped sendcloud_remote_id completeness fixes. This snapshot agreement is not a proof for hypothetical data: main performs pairwise sequential dedupe and first-on-tie behavior, whereas SQL globally ranks with an id tie-break; SQL purge masks additional operational fields. These differences did not change any compared displayed KPI here. Actual authenticated RPC invocation, RLS, pagination, search/filter/facet parity, and transport estimates are outside this audit.

Reproduction: execute `production-kpi-audit.sql` read-only on the specified project; retain its aggregate output and sanitized `reference_rows` locally as an audit JSON object; execute `node reference-main-runner.cjs INPUT_JSON REPO_ROOT` with `TZ=Europe/Madrid` to produce the independent reference and comparison. The SQL contains only SELECT CTEs, not RPC DDL or data writes. Retest after production data changes to get a new point-in-time comparison.
