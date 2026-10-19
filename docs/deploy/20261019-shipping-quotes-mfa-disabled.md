# Shipping quotes and disabled-MFA startup — prepared, NOT deployed

## Scope and finding

Live `withAmazonBuyerRead` uses the exclusive `amazon_pii_claim_external_read` order lease even for MRW `options`, Sendcloud `shipping_options`, and Envia `rates`. Concurrent quote providers therefore compete for a lease and receive 409. The existing frontend waits for all providers and hides rejected results. Direct MRW exclusion previously depended on successful MRW options.

## Changes prepared

- Four shipping handlers use a read-only quote path; authenticated, owner-scoped order loading and purge checks remain in place. No quote acquires/releases a shipping lease or creates a label.
- Label creation uses one owner-scoped database lease across all providers and channels, then re-reads the order before outbound calls and rejects an existing label. MRW retries for an already persisted shipment fetch its PDF instead of transmitting again.
- Canonical migration `20261019112741_shipping_creation_lease_480_seconds.sql` extends the existing production RPC from 300 to 480 seconds (above the 400-second Edge lifetime), includes purge/cancellation checks, and preserves service_role-only execution. Migration is NOT applied.
- Carrier identity/alias registry and a single aggregator filter operate on enabled direct integration configuration for the workspace. A direct account reserves its carrier even if its quote fails or has no options. Sendcloud and Envia filter all services; stale aggregator label selections are also rejected. No implicit default Sendcloud service is allowed when direct contracts exist. Future aggregators must call the same filter; future carrier codes are added to its registry.
- Provider quotes are incremental and independently bounded to 20 seconds with AbortSignal. Failed/partial providers remain visible with actual diagnostics and individual retry. Successful options survive partial errors and overlapping retries. Closing/switching workspace invalidates stale UI responses. Existing styles and tariff pricing are reused.
- Explicit public release setting `VITE_MFA_ENFORCEMENT_ENABLED=false` in the existing `.env.production` permits startup after a valid local session without waiting for the status RPC. Enabled/unspecified settings still fail closed. Backend MFA remains authoritative; an explicit server challenge/enrollment/recovery restriction remains sticky across repeated RPC failures until a successful authoritative status clears it. Sensitive-operation rechecks never use the startup fallback. Existing production env values are preserved.

## Evidence

- Build passed locally. Complete Vitest run: 120 passed, 0 failed. Complete Node script suite: 1,096 passed, 0 failed. Auth resilience tests intentionally log synthetic fetch failures; no failed assertions.
- Regressions cover concurrent identical quotes without RPC/writes; simultaneous label attempts for Amazon/Shopify/manual; stale cross-provider existing-label rejection; workspace direct contracts independent of quote success; provider timeout/retry and overlapping completion; partial diagnostics; disabled MFA 503/hung RPC and no-session; explicit required/recovery -> failure -> failure without unlocking.
- PGlite/PostgreSQL executes the actual lease migration: competing claims return true/false, wrong owner cannot claim, TTL exceeds 400 seconds, anon/authenticated cannot execute and service_role can. This is an embedded PostgreSQL test, not a two-network-connection load test.
- Independent code review found and then verified fixes for sticky MFA restrictions, retry interleaving, partial diagnostic loss, stale existing-label creation and lease duration. No remaining important finding in the re-review.
- Local Deno executable is unavailable. Handlers run through existing transpiled request-handler regression tests; plain TypeScript check reports only missing Deno/npm runtime declarations. Do not represent this as a native Deno deployment test.
- CI status must be recorded after the PR checks finish; not inferred from local tests.

## Release gate / rollback

STOP before deployment and merge. Production remains on the emergency pre-MFA bundle. User browser review of visible changes is required before publishing.

A future authorized rollout must verify `.env.production` is not overridden by a Vercel environment setting and still matches disabled production enforcement; never enable a cohort before updating the frontend release setting. Apply and verify SQL first, reconcile its actual Supabase registry version to the repository, then deploy four Edge functions in small batches. Test provider options concurrently without buying labels and stop for the user's UI review. Do not deploy unrelated live dependency differences from main.

Exact live shipping bundles/versions are saved under `supabase/snapshots/20261019-shipping/`: mrw-shipping v22, sendcloud-order-tools v34, envia-shipping v42, sendcloud-orders v32. SQL rollback `supabase/rollback/20261019_shipping_creation_lease_before.sql` restores the captured five-minute definition and original service_role-only ACL; refresh these snapshots immediately before an actual release. Roll Edge handlers back before shortening future lease acquisitions. Frontend rollback remains the existing pinned Vercel deployment; no SQL/Edge rollback has been executed in this task.

## Production follow-up (read only)

Initial Amazon audit: `audit/production-resume-20261019`, commit `08936c0a6f711f9f5b334f753705e1575ed7e9a6`, docs/deploy/20261019-resume-audit.md. No (a) Edge deployment was present; no partial release needed completing or rollback. At 11:20 UTC worker completed 17 more jobs, released its lease and queued one `AMAZON_QUOTA_429` retry. At 11:30:30 UTC another worker cycle had an active, renewing lease, 47,402 success / 853 superseded / 12 queued / 1 running / 0 failed; this is a timed in-cycle observation, not a claim the queue stays empty. PGRST003/57014 log audit remains unverified because the connector's log backend failed twice. Current frontend HTML was independently checked for index-BkauntMi.js.

(a) write reduction and (d) PR237 paging/KPIs remain separate pending work. In particular, PR237 currently calls reconciliation and upsert in the same flow; the combined one-status-change -> one-UPDATE regression must pass before any (a) release.
