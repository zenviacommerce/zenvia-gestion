# Amazon Edge reconciliation — plan only

No Edge Function has been deployed. Candidate: feature/amazon-edge-reconciliation-20261015 at 9c2ea0c1d6ddeb31d84519560417e7e5786c74c2. Rollback: sync/production-snapshot-20261015 at 09c68337c1053dba4480e3916b537a907d9a793a.

## Changes and evidence

All 14 currently deployed bundles were downloaded again through get_edge_function, including their embedded dependencies. Every index.ts is unchanged versus the candidate. Functional differences below arise from embedded shared modules. Production is heterogeneous: the same helper path has different contents in different bundles, so comparisons and rollback are per function, not against a single global _shared directory.

Every file in all 14 live bundles matches its individual production-snapshot/<function>/ copy byte-for-byte. Version/verify_jwt and file-level differences are in 20261015-edge-live-manifest.json, 20261015-edge-differences.json and 20261015-edge-snapshot-exact.json.

Preflight DB read confirms service_role can execute amazon_replace_finance_page(uuid,uuid,jsonb), integration_claim_order_shipping(uuid,uuid,uuid) and all three lease RPCs. This proves availability, not end-to-end execution of the candidate Edge code.

## Proposed deployment order and safe verification

This is one controlled maintenance batch, not an assertion of atomic deployment. Each function embeds its own dependencies. Pause automatic dispatchers and all related schedules using their saved real definitions; block manual sync and shipment confirmation entry points for the maintenance window; wait for the worker lease to be released. Do not revoke the hardened database privileges. Review and approve the exact commit and the gates below before any deployment. No pause/block has been applied now.

All positive-path tests below run on a disposable local/staging database and a transport that rejects every unexpected outbound URL. LWA, SP-API, recipient fallback and self-invoked Edge endpoints return fixtures. Database writes are fixtures only. Direct invocation of a production endpoint is not a dry-run, even where Amazon calls are read-only. Preserve the current verify_jwt setting for every function.

| Order | Function (current version; verify_jwt) | Functional change from its live bundle | Verification without real Amazon effects |
|---|---|---|---|
| 1 | amazon-backfill-finance-components (14; false) | Only supabase.ts adds active/trialing workspace validation to authenticateUser; this internal endpoint uses requireInternalSecret, so its normal execution path has no functional change. | Internal auth rejection before processing; offline fixture page normalization, replacement and limits. Never run a production backfill as a smoke test. |
| 2 | amazon-sync-fx (31; false) | Same auth-helper-only difference, unused in its internal happy path. FX logic unchanged. | Fixture ECB/FX transport, repeat a page and verify stable values; unexpected URL fails. |
| 3 | amazon-recipient-fallback (2; false) | Entire live bundle identical. Included for a coherent candidate set; no behavioral delta. | Offline recipient fixture and conditional update; no real fallback fetch or scheduler. |
| 4 | shopify-analytics-sync (5; false) | Entire live bundle identical, including Shopify dependencies. | Fixture Shopify transport, pagination and scoped lease; no real store requests. |
| 5 | amazon-status (14; false) | SP-API transport gains a 25s request deadline and configurable maxAttempts; structured error sanitization. Bootstrap may call Amazon if account is disconnected, so status is not universally read-only. | Connected/disconnected/suspended tenant fixtures, mock marketplace bootstrap and Auth; verify response and zero live calls. |
| 6 | amazon-sync-product-images (19; false) | SP-API deadline/maxAttempts and structured errors; workspace check in shared auth helper. Image-selection logic unchanged. | Fixture catalog images, existing-image case and bounded batch; no live image/catalog requests. |
| 7 | amazon-reconcile-orders (4; false) | Orders may be incorporated without recipient address; integration display_name retained; transport deadline/maxAttempts and better errors. | FBM without address creates a pending data fixture; existing recipient fields preserved, FBA excluded, own account name used. |
| 8 | amazon-sync-orders (16; false) | Same operational-order improvements and transport/errors as reconciliation. | Multi-page order fixtures; duplicate replay, tenant/account isolation, FBA exclusion and no real labels/shipments. |
| 9 | amazon-sync-inventory (9; false) | Inventory passes job.owner_id when loading credentials; account/secret scoped to owner; seller fallback from environment allowed only for configured environment accounts; transport timeout. | Cross-tenant account ID fails; secret unavailable fails; environment-account fixture works; repeat inventory page. |
| 10 | amazon-sync-finances (14; false) | Replaces upsert/delete/reinsert loop with one atomic amazon_replace_finance_page RPC per deduplicated page; preserves unchanged IDs/timestamps; owner-scoped credentials; transport timeout/errors. | Fixture duplicate transactions and late adjustments; RPC on disposable DB verifies idempotency, atomic failure and two-tenant isolation. |
| 11 | amazon-confirm-shipment (14; true) | Only http.ts structured error extraction/sanitization changes. Shipment algorithm, shipping lease, stable package selection and orderCancellation are already live and unchanged. This does not remove existing ambiguous POST retry risk. | Offline confirmation matrix below. No production positive-path invocation and no trackingOverride using invented data. |
| 12 | amazon-sync-worker (34; false) | Atomic finance page writer and structured errors; orders.ts only loses a TypeScript Map annotation (no intended runtime difference). Worker index, 202/waitUntil, lease/heartbeat, budgets and shipping confirmation code remain v34 behavior. | Disposable queue, fake SP-API and fake self-invocation; concurrent worker lease exclusion, budget, failure and tracking retry fixtures. Type-check all Edge imports. |
| 13 | amazon-sync-manual (15; true) | SP-API deadline/maxAttempts; shared auth checks workspace. sync.ts completion helpers add owner lease checks/timing but the endpoint invokes enqueueHourlySync, not those completion methods. Its existing finance overlap remains unchanged. | Admin-only and suspended-tenant fixtures; enqueue exact jobs/IDs into disposable queue, repeat request, no live execution. |
| 14 | amazon-sync-orchestrator (14; false) | Finance overlap widens to 24h (bounded by existing freshness floor), lease-aware completion helpers, transport timeout/errors and updated auth helper. Normal endpoint enqueues jobs, and may request image sync. | Multi-account fixture settings; enabled sources and financial overlap, bounded windows and mocked image function; no real net.http_post/self invocation. |

Keep all producers paused until the batch verifies; restore their exact previous states last. A function that is unchanged need not be executed to justify inclusion. If opting to skip redeploying unchanged bundles, document that as a reviewed reduction of the batch, not an unannounced change to this 14-function plan.

## Shipment confirmation: mandatory safety gate

There is no dry-run parameter in the current handler. SP_API_BASE is hardcoded to the production EU endpoint. Passing dryRun:true today would not make it safe. Both the endpoint's retry_pending action and the worker's retryPendingAmazonTracking path can send confirmations; do not test either on live orders just to exercise the code.

Preferred first level: exercise the real handler/shared code against a disposable DB and intercepted fetch, with a deny-by-default egress policy. Fixtures must cover:

1. Already-synced database row or matching Amazon package/tracking: zero POST confirmations.
2. Two simultaneous attempts: only one shipping claim; no second POST.
3. Cancellation pending/confirmed and foreign tenant: denial and zero POST.
4. Multiple ambiguous packages or invalid packageReferenceId: denial and zero POST.
5. One valid FBM shipment fixture: inspect the body, tenant/account, tracking, item IDs/quantities, packageReferenceId and shipDate; one intercepted POST, no real Amazon call.
6. POST accepted remotely but response lost / HTTP 500 / DB markSuccess fails: simulate all three. A subsequent attempt must reconcile GET PACKAGES before any new POST and reuse the same package reference. Replays must not create a second package.

BLOCKER: spApiRequest currently retries transient HTTP responses for all methods, including shipmentConfirmation POST, up to its default four attempts. shipment-confirmation.ts does not set maxAttempts:1. An HTTP 500 after acceptance can therefore cause an automatic duplicate request before reconciliation. Existing package matching and the DB lease do not prove exactly-once behavior across a network failure. Before enabling this path in a release, propose a separate reviewed change to cap the mutation attempt and reconcile ambiguous outcomes before retrying, then pass the tests above. No such change has been implemented here because this task requests the plan only. The same gate applies to the worker, which also confirms tracking.

Optional second level: Amazon's static sandbox can validate supported documented request examples at https://sandbox.sellingpartnerapi-eu.amazon.com. It is an API endpoint, not proof of a stateful sandbox seller account or of exactly-once behavior. First verify supported sandbox examples for both the Orders 2026 GET PACKAGES path and v0 confirmShipment path; the present hardcoded production client cannot be used unchanged. Use isolated test credentials/client and endpoint allowlisting; never redirect production credentials/calls by an unreviewed global setting.

Official references: https://developer-docs.amazon/sp-api/docs/sp-api-sandbox and https://developer-docs.amazon/sp-api/lang-en_en/reference/confirmshipment .

Final production evidence, only after release approval and the safety gate: wait for one genuine shipment already authorized by normal operations, monitor its natural confirmation (do not invent a shipment or force a replay), verify one intended package/tracking in Amazon and amazon_tracking_synced_at locally. If the outcome is ambiguous, inspect/reconcile; do not force retry. This is monitoring a real event, not a no-effects synthetic test.

## Deviations and limits

- Candidate has no shipping algorithm change, but an existing unsafe retry assumption must not be called a successful duplication test.
- Two bundles are byte-identical and three auth-helper changes are not called by their internal endpoints; avoid overstating their functional impact.
- Shared sources are embedded per bundle; do not roll back by copying one global helper directory over all functions.
- Production snapshot also contains functions absent from the candidate source tree (e.g. order-cancellation and shopify-confirm-shipment). Leave their existing deployed bundles untouched in this batch and inventory them before any broader deployment.
- No Edge positive-path test, dry-run, sandbox call, cron change or deployment has been executed in this planning task.

## Rollback

1. Keep producers/manual entry points blocked; wait for in-flight workers/leases. Save failed release logs/checkpoints and do not delete jobs or high-water marks.
2. From the pinned snapshot commit, for EACH of the 14 functions stage `production-snapshot/<slug>/` as its own source root: it contains `<slug>/index.ts` and that bundle's exact `_shared` dependencies. Do not use the snapshot branch's global supabase/functions directory as a substitute.
3. Redeploy each original bundle with its recorded verify_jwt flag. Restore worker v34 behavior before allowing producers to resume. Deployment version numbers will increase; rollback restores code/config, not the old numeric version label.
4. Verify downloaded source hashes against the snapshot again, internal auth, lease acquisition/release and queue progress; keep the new security database guards/RLS/ACLs and existing compatible RPCs.
5. Restore only the cron jobs/entry-point availability that were active before the window, from saved definitions; observe one cycle, queue age/failures and Auth 5xx.
6. Rollback does not undo a shipment confirmation already accepted by Amazon, nor automatically reverse new business data/high-water marks. Reconcile those outcomes separately without false cancellations/confirmations. The atomic finance RPC is additive and can remain when old Edge code is restored.
