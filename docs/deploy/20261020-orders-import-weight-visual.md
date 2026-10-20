# 20 October 2026 — Amazon import, package weights and product-line consistency

## Before production changes

Owner authorized publication of A in order import → weights → visual; B is analysis/proposal only after A. C remains MFA 48-hour watch and expansion, public SP-API developer application, then Seller Central reconciliation. Advanced stamp processing remains cancelled.

- Current Vercel production: dpl_ESrx67iYsYex7Z72asky3bMcSpyz, main 9ce099771ff73dd6f43e81bbcc85f0af3563a368, index-C6YyMSqI.js. Instant Rollback target for visible changes is this deployment.
- PR #256 head 1dd3283b38f138af9e01b68cdb7089a36045bced: worker every minute; producer still every five minutes, six-hour overlap, two-minute API cutoff, all nine marketplaces. Production Edge snapshots (worker v42 / Orders v24) and cron hashes are committed under docs/deploy/20261020-amazon-auto-before on that branch. Fresh downloads were byte-identical to snapshots.
- Exact schedule rollback: supabase/rollback/20261020_amazon_restore_worker_cadence.sql. Edge rollback: redeploy each saved bundle with its existing verify_jwt=false (own authentication unchanged).
- Before health 11:42:59 UTC: guard findings 0, 34 connections, no queued/running/failed jobs. Latest automatic queue waits include 297.25s and 322.29s; previously observed maximum 376.13s. Two FBM first inserts were automatic and preceded the later manual refresh; historical initial status was not recorded.
- Local import validation: 1148 Node tests, 28 independently repeated focused tests; rollback schedule exactness covered. All five GitHub checks must pass the current head before applying.
- PR #257 visual head 1db690eabce870c4f3dc16b80c8a354c2993d30c: all product lines match the previous first line, desktop/mobile screenshots and computed-style assertions. Local Vitest 219 passed and production build passed. No Auth or stamp changes.

## Limits

Minute worker cadence removes the demonstrated extra queue delay. A five-minute producer, mandatory now-minus-two-minute API bound and Amazon publication latency cannot guarantee every purchase is imported in under five minutes. Log actual purchase / queue / first import times and verify next real FBM orders; do not manufacture orders or labels for proof.

## Weight pre-deployment review

The owner has received the five-order current/calculated/source table. At that observation the sole eligible pending order 402-8935535-6572312 had an explicit manual 7 kg adjustment and remains 7 kg; four sampled shipped orders remain unchanged. Zero current eligible orders require modification at that observation. Refresh before any recalculation. Sources: mapped internal base-unit weights and mapping factors, Amazon catalog measurements, Shopify line weight, configured SKU/global fallback marked estimated.

## Production phases

Not applied yet. Record migration, Edge versions, two real worker cycles and subsequent frontend deployments here after each step.
