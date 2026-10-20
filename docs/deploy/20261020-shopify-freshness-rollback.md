# Shopify freshness rollback — prepared before production changes

Baseline: main `be32f5475d09bc6f09b462718fb82d5ed31eaefd`; Vercel production `dpl_D9NuoGna9wvHuvcQGmMA6mEogg1g`. Design PR #260 is excluded.

1. Pause cron `shopify-order-freshness` via `cron.alter_job(...,active:=false)`. Keep the new receiver running while unregistering.
2. Call internal receiver action `unregister` per account. It deletes only this release's recorded subscription IDs (including recovered durable creation intents); never delete unrelated subscriptions. Inspect Shopify afterward. If deregistration fails, keep receiver available to acknowledge and retain receipts until resolved.
3. Restore old `shopify-analytics-sync` cron active=true; its original schedule `18,48 * * * *` and command are retained unchanged by deployment.
4. Restore Edge bundles from `shopify-freshness-before-20261020/`: `shopify-orders` v13 with verify_jwt=true; `shopify-analytics-sync` v9 with verify_jwt=false. Restore every original file verbatim. Original live shared dependencies intentionally differ from repository HEAD.
5. Revert the Shopify freshness PR / promote the baseline Vercel deployment. Do not merge or deploy design PR #260.
6. If snapshot protection itself is implicated, drop trigger `zz_shopify_reject_stale_snapshot` on `fulfillment_orders`. Keep additive service-only receipts/trace/state and cursor RPCs for evidence. The analytics publication addition can be removed (`alter publication supabase_realtime drop table public.shopify_analytics_orders`) if implicated; existing analytics RLS is unchanged.

No order deletions, historical number rewrites or customer payload retention are needed. Re-run read-only order/analytics reconciliation and record the rollback timestamp. Restoring baseline intentionally restores its prior freshness limitations.
