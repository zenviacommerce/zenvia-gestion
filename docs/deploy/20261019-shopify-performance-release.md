# Shopify / Amazon timezone performance — 19/10/2026

## State
Implementation and transactional production rehearsal complete. Backend migration20261019170119 deployed; frontend NOT published. Five CI workflows green on b962a91914609dfdc1cd628d63a2fffd60ac197d before deployment; independent review passed. Migration filename aligned to actual Supabase ledger. No Auth configuration, MFA cohort or Edge changes.

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
PGlite test compares pre/post summary JSON for date boundaries, no-data and filtered shop, validates settings timezone, batch bounds and MFA denial; instruments one timezone lookup. Service test proves products resolves while batch remains pending. 146 Vitest and1129 Node tests passed; build passed. The environment-gated real Supabase integration test fails if invoked locally without its dedicated CI fixture; it is excluded from the normal Node command and runs in its own CI job. Final rehearsal verified mfa_activation_findings=0 after migration and after rollback; exact hashes of all restored functions matched. Final SQL times: Shopify4.957/5.156/15.920/6.756ms; Amazon19.356/341.602ms. Production verification (three SQL samples each): Shopify Today avg13.999ms max26.277; previous7.184 max7.315; month14.715 max15.824; products12.275 max21.537; batch18.730 max20.500. Amazon Today27.161 max40.462; previous330.894 max368.273. MFA findings0. Public production bundle index-DIsFGH6G.js unchanged. Exact definitions in snapshots; rollback restores functions and removes additive batch/core/catalogue/trigger. Revert frontend before removing batch if frontend ever published.

## Related #246 closure
All5 GitHub workflows succeeded for a141b9d99f80847f2d9a637bed27a508f92d3022. Reviewed diff7files only SQLhotfix/test/snapshot/rollback/audit/journal. Merged19/10 at16:48UTC as65446632a011ccb2c737a66a16ddf0121d2fee95; conditional check disabled. Hotfix had already been applied; merge changes no frontend behavior.

RLS direct count: authenticated3.549ms vs definer0.128ms. Shopify cron18,48 * * * *; baseline navigation16:32UTC did not overlap starts16:18/16:48 (cron enqueue10–13ms; not full Edge runtime).

## Real browser opening after backend deployment (old frontend)
19:02:25 Madrid: status50ms; four summaries85/87/169/213ms; products136ms; all200. Card requests start112–118ms after status starts, last card gateway response at+331ms; products at+360ms. Baseline last summary+5838ms, products+3320ms. Products queue delay shrank1656→112ms even before frontend batching. These are gateway timeline bounds, not paint timing. Browser automation click+wait took2242ms including command round trips; do not describe that as app paint time. One gateway summary213ms still narrowly exceeds200ms; all Shopify SQL samples are<27ms. Batch SQL18.73ms, HTTP batch waits for approved frontend.

## Visual review / stop
Four screenshots are on audit/production-resume-20261019 under docs/deploy/shopify-performance-20261019. Both ready and products-ready/cards-loading states at1440px and390px. Synthetic fixture only, production components/CSS, all network aborted. PR247 unmerged; do not publish frontend before owner review.

## Final closure
All five workflows succeeded on final PR247 head5c7e354ffe6a3f043928985b904a714f023774f6 (runs39290887309,39290887352,39290887335,39290887334,39290887419). Fresh checkout of exact final head:147 Vitest passed. Normal Node suite1129passed, build passed. Backend remains deployed/verified; frontend remains unmerged pending owner visual review. No deviations in deployment gate; observed limitations: one old-frontend gateway summary213ms and Amazon previous-month SQL331ms exceed200ms, and no claim is made about exact browser paint timing.
