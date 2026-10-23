# Production rollback and staged performance releases — 2026-10-19
- Live domain gestion.zenviacommerce.com is pinned by Vercel Instant Rollback to deployment dpl_3W2T4KqMQYqspkCT6FAupXTH2jba (commit 07505dda4eb489c5016fcc218992efbaba10e96a, pre-PR #222). Confirmed READY.
- GitHub main contains later MFA frontend code. Never merge a PR to main while that would automatically redeploy MFA startup dependency without tested recovery for disabled MFA state and an approved release gate.
- MFA pilot is disabled; do not modify cohort.
- Step (c) PR #238 branch perf/amazon-sync-jobs-retention-20261019: 14-day terminal job retention; preserve queued/running/failed, 500 per batch, kill switch default OFF, receipts, cron 03:25 UTC. SQL passed BEGIN/ROLLBACK on production. Counts at inspection: 49,780 success, 853 superseded, 9 queued; 12,753 14-day eligible.
- Production release gate: CI all green, snapshot/rollback, supervised bounded batches, worker check. Do not merge to main until frontend MFA startup resilience is proven. Retention row deletion needs backup for reversible rollback.
- Step (b) grouped amazon-status + index separate PR; step (a) no-op Amazon sync writes separate PR; step (d) #237 open draft with CI failures; no deployment.
- Transport 10:36 UTC: sendcloud-orders HTTP 200, envia-shipping HTTP 200, direct MRW HTTP 409 at 10:36:58; tools HTTP 409 around 10:35:49. Per-order correlation unproven. Two tabs obtained disjoint options. Frontend fix: provider states, incremental results, individual retry, direct-MRW preference and no label creation in tests.
