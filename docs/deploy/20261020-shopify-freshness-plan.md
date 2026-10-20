# Shopify freshness implementation plan

Goal: Shopify orders appear in operational Orders and analytics/cards/products under2min via authenticated Shopify webhooks, with a server-side fallback under5min and visible-page refresh without manual sync.
Architecture: retain existing operational/finance importers; an HMAC-verified durable receipt and internal dispatcher coordinates both. Use per-store leases, retryable receipts and one-minute dispatcher; fallback per2min, with incremental overlap and no advancement on incomplete/failed stores. No designs from #260, Auth/MFA changes, purchases or test business orders.

## Evidence / incident

#1025 Shopify created_at12:53:27Z, processedAt12:53:22Z, updatedAt12:53:29Z. fulfillment_orders.created_at13:15:02.621656Z:21m35.62s. Corresponding13:15:02.788Z HTTP200 shopify-orders came from browser, not cron. Analytics manual request completed13:16:42.537Z; cron ran13:18Z. Analytics.updated_at is upstream updatedAt (12:53:29Z), not ingestion time: previous schema has no local ingestion timestamp, so exact first analytics insert cannot be reconstructed honestly. Numeric analytic order_id13342455038284 exists after manual sync. Only scheduled Shopify job is analytics at18,48; operational sync was browser-driven. No Shopify webhook endpoint in deployed inventory/source. Registry will be inspected through account-scoped Admin API before subscribing; unrelated subscriptions will not be altered.

## Tasks / review focus

1. Tests then importer corrections: internal secret caller constrained to active workspace/account, operational per-store window/cursor and explicit pagination failure, optional targeted order query; analytics targeted snapshots retain store checkpoint and never replace catalog. Track ingestion separately from upstream timestamps. Tests failure/partial pages, earlier update guard, shared logistics/manual-weight preservation.
2. Tests then durable service-only event/lease schema and dispatcher: raw-body HMAC, known account/shop, delivery idempotence, no PII payload persistence, active workspace checks, bounded retry, both destinations required before success. Snapshot previous Edge bundles and SQL/cron rollback before deployment. Registry inspect/register create-only exact callback for ORDERS_CREATE/ORDERS_UPDATED, no unrelated deletion. Per-store lease prevents cron/webhook competition; durable queued receipts survive failed background execution.
3. Frontend delegated separately: captured scoped active client, events and visible-only20–30s reads, cache invalidation, cleanup and no same-query flicker/state loss; tests mounted page/cards/watcher tenant race.
4. Full local tests/build, independent review, PR CI allgreen. Deploy migration and backend preserving live dependencies/JWT auth; verify HMAC rejection, internal auth, duplicate receipts, no tenant crossover and actual automatic fallback. Then merge authorized incident PR for frontend Vercel; #260 stays draft. Record every phase in docs/deploy.
5. Verify next genuine new order using trace timestamps and scheduled conditional follow-up; do not invent a real Shopify order or claim target latency before observing one.
