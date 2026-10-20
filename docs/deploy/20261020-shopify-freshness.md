# Shopify freshness — 2026-10-20

## Incident / evidence before production writes

Order #1025 / Shopify 13342455038284 / ZENVIA account 5ae60ea5-e45c-435a-ae72-96a9043cd0c0.
Shopify created_at **12:53:27Z** (14:53:27 Madrid); updatedAt12:53:29Z; processedAt12:53:22Z.
fulfillment_orders.created_at **13:15:02.621656Z** (15:15:02 Madrid): **21m35.62s**.
shopify-orders request completed13:15:02.788Z /200 /browser Chrome, not cron. Browser-driven does not prove an explicit manual click: Orders also polls while mounted.
Manual browser analytics request completed13:16:42.537Z; old cron next ran13:18Z. Analytics upstream timestamps cannot identify its first local insertion; the previous schema did not retain ingestion time. Stored analytics shows gross29.70 /PAID after synchronization.
Only Shopify cron: job11, shopify-analytics-sync, schedule18,48 each hour. No operational server-side cron or webhook receiver in deployed inventory. Subscription registry inspection is an explicit post-deployment gate; absence in source alone is not proof of registry absence.

## Implementation and validation before release

Reuse existing financial/logistics importers. Internal calls require exact secret plus active account/workspace; human MFA path remains in place. Per-account operational cursor with6h overlap and bounded pages; partial/failed imports cannot commit it. Atomic cursor RPC preserves concurrent config changes and monotonic checkpoints. Analytics retains2-day overlap, stamps run-start only after successful full import and leaves cursor/catalog/inventory untouched on targeted webhook imports.
Raw-body HMAC, exact account/shop, durable idempotent delivery metadata, no customer payload retention. Completion requires both operational and analytics destinations; failure remains pending with backoff. Per-store leases and separate cron HTTP calls prevent one store blocking another. Pending events run before/after broad fallback; one distinct queued order per lease keeps a poison event from monopolizing dispatch. Fallback scheduler every minute; broad import gated to every2min per store. Webhook subscriptions install only if the configured app matches the installed app; otherwise retain polling with recorded reason. Durable subscription-creation intents make partial registration recoverable and rollback ownership explicit.
Frontend listens to scoped Realtime on fulfillment_orders + shopify_analytics_orders and visible-only25s fallback reads; retains current query data on refresh/error and preserves filters/tab. No Shopify API requests from fallback frontend reads. Existing analytics RLS retained; service-only trace/queue/state are not published.

Local verification: **229/229 Vitest tests**; **52/52 real-handler/security/importer Node tests**; production build passed, existing large-chunk warning only. SQL tested against PGlite: service-only ACLs, scope, idempotence, leases/throttle, first timestamps, monotonic cursor with config preservation, disabled-account refusal, stale-snapshot rejection. Independent review found four issues (poison blockage, sequential store starvation, config replacement, partial registration ownership); all corrected. Review follow-up identified poll-before-queue latency; dispatch changed to queue→poll→queue. No real-order latency claim before observing a new order.

Rollback prepared in 20261020-shopify-freshness-rollback.md and exact live Edge files in shopify-freshness-before-20261020/. Production main remains be32f547; design #260 excluded and unmerged.

## Release gates / pending evidence

CI all green before production schema/backend writes. Then inspect subscriptions, register only compatible apps, activate fan-out cron, check actual fallback/trace/invalid signatures, merge frontend and wait for Vercel READY. Observe the next genuine Shopify order (no generated business orders); record created→received→both imported and UI freshness separately. Historical backfill trace timestamps describe this release's first observation, not original historical insertion.
