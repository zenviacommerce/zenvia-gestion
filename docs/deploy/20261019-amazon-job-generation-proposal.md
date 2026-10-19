# Proposal only — account/region Orders jobs

No producer, frequency, queue or SQL change is applied by this proposal.

Observed prior 24h: orders2745, finances216,inventory216 (3177 total), one account/nine marketplaces. The every-five-minute Orders producer and hourly full producer overlap; theoretical orders are 9*(288+24)=2808/day. Retries reuse the same row and are not additional creation. Exact observed windows and throttling explain differences; do not label the completed3168 count as created.

Recommended: one incremental Orders job per owner/account/SP-API region every five minutes, containing the active marketplaceIds list (nine current). Exclude Orders from the hourly full producer; keep hourly finances/inventory. searchOrders supports up to50 marketplace IDs and100 results/page. API order.salesChannel.marketplaceId remains the authoritative scope; missing/unexpected marketplaces must fail/quarantine without silently assigning the first ID.

Steady-state: Orders288/day (versus observed2745, -89.5%); total720/day with the other432 unchanged (-77.3%). This estimates rows/jobs, not an identical API-request reduction: all pagination pages still need fetching. First-page overhead could drop roughly9x in low volume. Preserve five-minute scheduling cadence; worker wakeup must follow enqueue or self-drain so same-minute cron race does not add an extra cycle. API default rate0.0056/s (~20/hour) per account/application, not per marketplace: fewer duplicated search calls reduces429 pressure. Actual x-amzn-RateLimit-Limit may differ.

Migration design: retain per-marketplace checkpoints until an entire grouped page sequence succeeds; group from the minimum completed watermark with bounded overlap. Do not advance on a page failure. Stable regional/account window keys deduplicate hourly/manual requests, bounded resumable pagination fits Edge lifetime, and one failing region/account cannot hold another. Historical backfills remain separate and low priority. Keep old producer behind a kill switch for immediate rollback; no concurrent old/new producer.

Alternative: adaptive per-marketplace cadence (active5min, quiet30min). If four active and five quiet:1392 Orders jobs/day (4*288+5*48), versus2745 -49.3%, and quiet marketplaces can wait up to30minutes for new activity unless notifications/manual refresh reactivates them. Simpler checkpoints but weaker freshness and less reduction. Recommend grouping first; adaptive account cadence only later with explicit UX latency budget.

Current activity snapshot12:26UTC: nine marketplaces; changed orders in24h83/75/69/27/7/4/3/2/0. Low volume supports grouping. Must cover all observed orders, totals, statuses, PII rules, owner isolation; replay failure/retry with unchanged checkpoints and measure429/calls/latency before rollout.

Sources verified2026-10-19: https://developer-docs.amazon/sp-api/lang-en_us/reference/searchorders and https://developer-docs.amazon/sp-api/lang-us/docs/orders-api-rate-limits . Repo enqueueHourlySync / syncOrdersJob.
