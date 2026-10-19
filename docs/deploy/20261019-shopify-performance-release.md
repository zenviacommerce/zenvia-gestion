# Shopify / Amazon timezone performance — 19/10/2026

## State
Implementation and transactional production rehearsal complete. Migration NOT deployed; frontend NOT published. CI and independent review pending. No Auth configuration, MFA cohort or Edge changes.

## Cause and plans
Shared private.amazon_analytics_timezone joined pg_timezone_names on each call (~82ms). Shopify summary/products repeated it7/8times syntactically and per row; summary shipping expression also evaluated more than once. Existing owner/event_at/store index and item PK are used. Small sequential scans (29items,2syncstate rows) do not justify extra indexes. No JSON parsing on these reads. Public wrappers are SECURITY DEFINER; authenticated end-to-end EXPLAIN includes MFA, but inner statements execute as definer (therefore separate inner plans use definer with same claims). MFA assertion3.677ms; owner helper4.032ms. No RLS removal or grants widened.

## Changes
Timezone names copied once into private catalogue; trigger validates settings writes, migration aborts on invalid existing values. Cheap STABLE helper reads workspace setting, defaults Europe/Madrid, fixed search_path. Shopify products resolves timezone once. Summary core receives authorized owner and timezone; shipping calculated once per row (materialized), timezone passed explicitly. New batch checks MFA+Shopify permission, max8 unique period IDs, one timezone lookup, bounded period queries. Existing wrappers/hash/ACL/OIDs retained via manifest. All7 Amazon analytics implementations already resolve once in variables; shared helper improvement benefits them without rewriting business logic. Old Shopify shipping helper uses materialized timezone context.

Cards use one batch (4ranges, forecast local); products no longer waits for four card slots. Cache60s/inflight dedupe and user/workspace checks retained. No changes in styling or copy. Offline desktop/mobile screenshots use real components and synthetic fixture; no network/provider calls.

## Measured SQL before/after (same production data, authenticated, BEGIN/ROLLBACK)
| RPC | Before ms | After ms | Exact JSON parity |
|---|---:|---:|---|
| Shopify Today |973.338|4.896|yes|
| Shopify previous month |818.578|5.082|yes|
| Shopify current month |4398.403|15.522|yes|
| Shopify products Today |1077.018|7.065|yes|
| Amazon Today |191.850|108.692|yes|
| Amazon previous month |474.769|335.939|yes|
| Shopify4period batch |not present|20.271|period core identical|

These are SQL execution times, not browser end-to-end. Gateway baseline summary1628–5727ms/products1553ms; no post-deployment gateway measurement yet. Cards<1s objective remains to verify after backend deployment and approved frontend publication. Amazon previous month remains>200ms; separate existing cost, not timezone issue.

## Verification and rollback
PGlite test compares pre/post summary JSON for date boundaries, no-data and filtered shop, validates settings timezone, batch bounds and MFA denial; instruments one timezone lookup. Service test proves products resolves while batch remains pending. Full test/build evidence appended after completion. Exact definitions in snapshots; rollback restores functions and removes additive batch/core/catalogue/trigger. Revert frontend before removing batch if frontend ever published.

## Related #246 closure
All5 GitHub workflows succeeded for a141b9d99f80847f2d9a637bed27a508f92d3022. Reviewed diff7files only SQLhotfix/test/snapshot/rollback/audit/journal. Merged19/10 at16:48UTC as65446632a011ccb2c737a66a16ddf0121d2fee95; conditional check disabled. Hotfix had already been applied; merge changes no frontend behavior.
