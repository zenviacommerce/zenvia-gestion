# Amazon confirmation safety: implementation for review

Branch: feature/amazon-confirmation-idempotency-20261016. Depends on the reconciliation branch and intended test contracts from PR #215. No merge or deployment is authorized by this report.

## Changes

- Service-only RLS ledger persists pending_verification before any POST; one consumed dispatch authorization per attempt; holder/fence blocks late writers.
- Every automatic/direct/force entry point uses the same protocol. Confirmation POST never retries automatically. Ambiguous 500/timeout/lost response/success-save failure stays pending and only GET evidence can finalize it.
- Verification matches the actual Orders v2026 carrier/packageItems schema, package reference, tracking, carrier and line quantities, with package shipping evidence. Empty reads cannot authorize a resend; five uncertain results require review.
- Cancellation and shipping lock order is fulfillment row then operation; durable uncertainty blocks cancellation beyond lease expiry.
- Reviewed revision freezes target/reference and audit record. Prepared operations are excluded from the worker; explicit confirmation submits that reviewed intent. Historical references must be evidenced, never guessed.
- Batch budget max 20s, LWA timeout 10s, shared abort through PostgREST/HTTP/backoff; worker retains 10s to finish the job.
- HTTP 202 and a verification message distinguish uncertainty from success or rejection.

## Evidence

Local Node suite: 1009 passing, zero failures/skips; frontend build and targeted Deno checks pass. 32 PostgreSQL 17/real-handler cases with independent connections and intercepted Amazon HTTP passed CI, followed by the full Node suite and build:
https://github.com/zenviacommerce/zenvia-gestion/actions/runs/38862772507

Tests include endpoint + worker concurrency, 500, timeout, response lost after acceptance, failed local success write, crash before POST, stale in-flight holder, repeated empty evidence, tracking override conflict, tenant/account crossover, cancellation race, reviewed correction/reference and elapsed budget. No synthetic shipment was sent to Amazon.

A fresh whole-change reviewer found four important gaps, all addressed in one regression fix pass. See implementation-progress for the red runs, rulings and exact scope. Two audit details (NULL reason and recursively nested history) were covered in the authorization rewrite. The worker's broader pre-existing Deno typing diagnostics are outside this targeted endpoint validation; no production-ready whole-graph type-check claim is made.

## Rollback

Exact pg_get_functiondef and original ACL of shipping/cancellation claim RPCs are in supabase/rollback/20261016_confirmation_original_claims.sql. The script blocks restoration while prepared/pending/needs_review operations remain. Preserve ledger and audit data, pause mutating entry points, reconcile uncertainty before restoring incompatible code. Never restore blind POST retries over pending rows.

The exact deployed order-cancellation v1 bundle is under supabase/rollback/edge/order-cancellation-v1 with a SHA256 manifest. The 14 reconciliation functions retain their separate rollback in sync/production-snapshot-20261015. No rollback has been necessary because nothing was deployed.
