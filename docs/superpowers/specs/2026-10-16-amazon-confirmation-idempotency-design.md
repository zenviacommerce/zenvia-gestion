# Amazon shipment confirmations: proposed design

Status: DESIGN ONLY. Implement after the approved reconciliation deployment and after review of this design. No schema, Edge code, producer, shipping or cancellation behavior has been changed for this proposal.

## Intent and success criteria

A genuine FBM shipment can be confirmed, but an uncertain response must never cause a blind repeated confirmation. Applies to the direct endpoint, worker retries, force/retry_pending and tracking overrides. Keep tenant/account isolation, existing cancellation exclusion and permission checks. No invented shipment is sent to Amazon in testing.

The attainable guarantee is one POST per explicitly authorized submission attempt, with durable reconciliation of uncertainty. We cannot promise Amazon exactly-once processing based solely on an HTTP response or a lease. If absence is not authoritative, stop automatic resubmission and request review instead of guessing.

## Approaches and recommendation

1. Only maxAttempts:1: small transport change, but a worker crash or failed local success write still causes later duplicate submissions. Insufficient.
2. Durable confirmation ledger + one POST + reconcile-before-resubmit: recommended. Makes uncertainty survive crashes/lease expiry and unifies all entry points.
3. An entirely new external queue/workflow platform: possible but unnecessary for this scoped flow; retain Supabase and bounded worker processing.

## Durable operation and tenant boundary

Add an RLS-protected confirmation ledger, writable only by service_role through internal RPCs. Revoke PUBLIC/anon/authenticated execution on any new privileged RPC. Expose only scoped status through the existing authorized Edge endpoint, never direct unrestricted ledger access.

Each operation stores local fulfillment_order_id, owner_id, amazon_account_id, integration account, Amazon order ID, marketplace, stable packageReferenceId, revision, immutable payload snapshot and hash, state, submission attempt ID, holder/fence, timestamps, next verification time, sanitized error, HTTP outcome and Amazon request ID where present. Store only fields required for confirmation; no tokens/addresses.

Validate in DB that the local order, account and integration all belong to owner_id; do not trust a supplied owner/account pair. Use constraints/unique keys plus runtime validation. A logical package has one current operation; a changed payload while pending returns 409. A new tracking revision after confirmed requires an explicit authorized action, keeps the same existing package reference where appropriate and records history. It cannot silently bypass an uncertain operation by changing the hash.

State is not keyed solely by payload_hash: otherwise changed payloads could create competing operations for the same shipment. Keep separate attempt history for observability.

## State and submission protocol

States: prepared → pending_verification → confirmed; definitive rejection → rejected; unresolved/mismatched remote evidence → needs_review.

1. Resolve tenant/account and real order/items; validate shipping eligibility/cancellation; inspect existing remote packages and choose a stable package reference. An existing matching confirmation finalizes locally without POST.
2. In a short DB transaction, lock fulfillment order then its confirmation operation (consistent lock order), acquire the existing shipping exclusion and a fence, and freeze payload + attempt ID. Commit **pending_verification BEFORE issuing the POST**, with submission_started_at and active submission lease.
3. Execute exactly one POST. Explicitly set maxAttempts:1 and enforce the no-retry rule for this mutation path in the transport so an accidental caller default cannot restore four attempts. Read-only GET retries remain bounded. Disable nested worker retry paths that would submit again.
4. On a valid success, atomically finalize the operation and the tenant-scoped fulfillment row using the holder/fence and expected payload hash. Set amazon_tracking_synced_at only with verified acceptance/success evidence.
5. On HTTP 500/502/503/504, timeout, lost response or unparseable/uncertain success, leave pending_verification. Do not call the POST again in catch/finally. Return 202 with pending status, not a false confirmed result.
6. If success persistence fails or Postgres is unavailable, the pre-send pending state is already durable. When DB recovers the verifier can finish; no catch handler has to succeed in order to prevent a second POST. Lease cleanup failure does not change that rule.
7. If the process crashes after persisting pending but before sending, the operation is conservatively uncertain. This may require review, but does not permit duplicate submission.

A normal expired lease never rearms submission. It only allows a verification worker to take over. force=true, another browser tab and automatic retry_pending cannot bypass this invariant. A late previous holder cannot update/finalize after losing its fence.

Definitive validation/auth 4xx are rejected and require fixing the cause before another authorized attempt; 429 or an outcome whose semantics are uncertain is handled conservatively. No automatic POST retry occurs even for throttling.

## Reconciliation

Use the existing authenticated GET Orders path with includedData PACKAGES, using the operation's own account credentials. Match stable package reference, tracking, carrier and item/quantity information where the response exposes it. Order status shipped alone is not proof that this exact intent succeeded.

- Exact match: atomically mark confirmed and finalize local tracking state. Zero further POSTs.
- GET timeout/5xx/incomplete data: remain pending; bounded GET backoff and retry_after. No POST.
- Package/tracking mismatch or insufficient proof: needs_review; no automatic overwrite.
- No package found: Amazon reads may lag. A single empty GET, repeated empty reads or elapsed time alone does not prove the previous POST was rejected. Recheck with bounded backoff, then needs_review unless the API provides authoritative negative evidence. An operator can request another authorized attempt only after reconciliation and review; record that decision. Never silently resubmit on TTL expiry.

Process verifications first with a bounded batch/time budget, avoiding full-table polling. Index state/next_verification_at and owner/account. Every pending endpoint call triggers/returns verification status rather than sending. Expose a clear “verificando confirmación en Amazon” UI state separately from failed/rejected.

## Concurrency, shipping and cancellation

Keep the existing order shipping/cancellation exclusion and extend its DB predicates to pending confirmation intents. All relevant claim paths lock order first and confirmation second. Cancellation must not race a possibly accepted confirmation; require reconciliation before allowing a conflicting cancellation/shipment action. Verify the currently production-only order-cancellation bundle and integrate its source before changing that claim path. This is an explicit dependency of the implementation, not an assumed behavior of today's code.

A new attempt is never authorized by lease expiry alone. At most one current submission can exist for a logical package. Read-only verifiers also use a scoped lease/fence so multiple workers do not finalize inconsistently.

## Tests before release

Use real Postgres with two independent connections/barriers for races; controlled clocks and deny-by-default intercepted HTTP for the Amazon side. No real Amazon order is modified.

| Scenario | Required assertion |
|---|---|
| Two concurrent submissions (endpoint + worker) | One DB winner, one POST; other request returns pending/confirmed status. |
| Amazon accepts but response is lost | One POST total; next invocation only GETs matching package and finalizes. |
| HTTP 500 after possible acceptance | No immediate POST retry; pending survives; matching GET resolves it. |
| Success response then local finalization fails | Pre-send pending remains; verifier repairs local success without another POST. |
| Crash after pending commit before POST | No automatic resend; conservative verification/review. |
| Lease expires while original request is in flight | Second holder only verifies; stale holder cannot finalize; no second POST. |
| GET initially empty, later matching | Remains pending until match; no POST in between. |
| GET permanently empty/ambiguous | Bounded verification then needs_review; no guessed resubmission. |
| Already confirmed, same payload | Return confirmed; zero POSTs. |
| Tracking override while uncertain | 409; cannot create a new competing operation/hash. |
| Cancellation races confirmation | Shared DB exclusion; no conflicting mutation sneaks through a five-minute lease expiry. |
| Tenant A with account/order of B | Denied before credentials or POST; no ledger/business writes to B. |
| Definite 400 / rejected request | No automatic retries; rejected state with sanitized cause. |
| Worker retry_pending/force | Cannot bypass pending; GET-only until resolution. |
| POST aborted at timeout | Pending durable, no retry; GET path has its own bounded read retries. |

Include an offline handler-level test that counts all outgoing requests by method/path so hidden nested retries cannot pass unnoticed.

## Rollout and rollback

After reconciliation is deployed and verified, implement additive ledger/RPC migration with exact rollback snapshots and a separate reviewed code change. Seed legacy unsynced rows with prior attempts into verification-required state before enabling the new retry path; do not treat them as safe new sends. Do not guess an old package reference of 1 when remote context is unresolved.

Pause affected producers/entry points, wait for leases, deploy compatible confirmation/worker/cancellation claim paths, run isolated regression checks and restore producers. Observe one genuine authorized shipment only after release approval. Do not create a synthetic production confirmation for a smoke test.

Rollback must preserve the no-blind-retry safety invariant. Do not restore legacy auto-POST code over pending ledger rows. If reverting application code, keep confirmations gated/paused until uncertainty is resolved or a compatible safe previous implementation exists. Retain ledger/audit data; do not drop it while pending operations exist. This proposal does not authorize implementation or any deployment yet.
