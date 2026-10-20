# Continuity verification — 20 October 2026

Read-only verification after the previous conversation became unavailable. No production mutations or redeployment performed.

## Published scope

GitHub main and Vercel production both resolve to 58687e42f63f0cc4a0c62fdc0582926668ed6c89. Production alias gestion.zenviacommerce.com points to READY deployment dpl_BoN1LhgBjj2yaWn1koZzbYgs9xnB, containing merged PRs #258 (weights) and #257 (product lines).

Re-read GitHub Actions for exact PR heads fa55c8b7d54b9ea85797fcd4de357d765d052549 and 1db690eabce870c4f3dc16b80c8a354c2993d30c: five completed/success workflows for each, including MFA integration and visual checks.

Supabase migration ledger includes 20261020113006 order_unit_weights and 20261020113031 amazon_restore_worker_cadence. Fresh information_schema read confirms products.unit_weight_kg numeric. Fresh Edge inventory matches all eight release versions: worker44, Amazon Orders26, Shopify Orders13, logistics17, Envia44, MRW24, Sendcloud tools36 and Orders34; all ACTIVE. Cron independently confirms producer */5 and worker every minute, both active.

Fresh selected-order read confirms _zenvia_weight kg4, quantity4, global_fallback and estimated=true for 171-8517620-7502702. The former deployment receipt, independently re-read, records manual order 402-8935535-6572312 retained at7kg and exact unchanged weight/provenance hash for891 pre-existing terminal rows. Those preservation results belong to the deployment observation, not a newly repeated terminal-set hash test. A fresh lookup of root raw_payload.weight returned null: do not mistake that unvalidated JSON location for a missing package mass.

Full rollout, dependency preservation and rollback remain in 20261020-orders-import-weight-visual.md. Frontend rollback: dpl_5rvsytgNKm5hqR3hh8TUiwcxHdab. Backend: eight saved bundles and supabase/rollback-order-unit-weights.sql; retain additive product-weight data. No evidence of a partially completed rollout requiring completion or reversal was found.

## Design review

PR #259 remains open/draft on audit/design-system-20261020 at aaf0a0a9d7ffe18ed6efeaf8af8e0ace53ad5335. Changed-file inventory checked: exclusively docs/, including61 PNGs, manifests, README and docs/design-system.md. Document and capture index read. Includes390/1280/1440 inventory, shared-component contracts, two mobile KPI columns, responsive rules, phased adoption and explicit limitations (light-theme screenshots; dark/zoom/mobile keyboard not claimed verified).

STOP for owner review. No design implementation or merge. Subsequent priority remains MFA watch/expansion, public SP-API application, then Seller Central reconciliation. The five-minute producer plus Amazon publication/cutoff still prevents a universal purchase-to-import <5-minute guarantee; the worker cadence fix removes the observed extra queue wait.
