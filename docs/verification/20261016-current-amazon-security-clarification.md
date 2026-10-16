# Current deployed Amazon code: precise security answers

Read again from Supabase get_edge_function on 2026-10-16: amazon-sync-inventory v9, amazon-sync-finances v14, amazon-sync-manual v15, amazon-confirm-shipment v14 and amazon-sync-worker v34. These are live bundle contents, not assumptions from main. Source references below point to each bundle's production-snapshot directory, after checking its source matches the live copies.

## 1. Can credentials be used across tenants today?

YES, conditionally in the old dedicated internal endpoints inventory v9 / finances v14.

Both call `loadAmazonSpApiCredentials(admin,{amazonAccountId:job.amazon_account_id})`, without job.owner_id. Their embedded config.ts loads amazon_accounts by id, loads integration_accounts by id/provider and does not check owner_id. Inventory/finance persistence derives owner from job.owner_id. A trusted internal request with a malformed job {owner_id:A, amazon_account_id:B} can therefore read seller B and persist under an inconsistent A/B scope. The endpoints require requireInternalSecret (service-level apikey); this is not evidence that an ordinary authenticated frontend user can invoke them successfully.

There is a second independent case: normalize() falls back from an absent per-integration refresh token to env.refreshToken regardless of credential_source. If tenant A lacks its own refresh token and the global environment holds seller B's token, that fallback can select seller B's authorization even with a nominally coherent A job. With no integration account at all, the helper also falls back to global credentials. These cases are conditional on configured environment secrets; we did not read secret values or demonstrate that this is happening now.

The running v34 worker is different: its embedded inventory.ts and finances.ts pass `{amazonAccountId:job.amazon_account_id,ownerId:job.owner_id}`; config.ts filters both account and integration by owner, and seller environment fallback is restricted to credential_source='environment'. Do not generalize the legacy endpoint flaw to the normal v34 worker path.

DB evidence: amazon_sync_jobs has separate single-column FKs to owner_id and amazon_account_id, not a compound ownership FK. Current count of jobs whose owner differs from their account owner is 0. This is no observed mismatch, not proof that the helper is safe for arbitrary internal input.

## 2. Can manual sync select another tenant's account?

NO, through the normal authenticated request path reviewed in amazon-sync-manual v15.

It requires authenticateAdminUser. Both a supplied integrationAccountId and the default account list are queried with `.eq('owner_id',caller.data_owner_id)`. An ID from another workspace returns 404. It calls ensureAmazonAccountAndMarketplaces(admin,caller.data_owner_id,integrationAccountId); that bundle already passes ownerId through its credential helper and scopes the integration lookup.

The missing workspace check has a different effect: authenticateUser verifies the user is active, but that embedded supabase.ts does not check workspaces.status. An active admin of a suspended workspace may still attempt sync for THEIR OWN workspace. The candidate adds active/trialing workspace status validation; it does not repair a demonstrated cross-tenant manual selector.

This answer assumes app_users has not itself been maliciously altered by a privileged database actor. The caller cannot choose data_owner_id in the HTTP body.

## 3. Is POST retry on 500 already deployed?

YES. amazon-confirm-shipment v14 and amazon-sync-worker v34 embed sp-api.ts with MAX_ATTEMPTS=4 and `transient(status)` including 500. The retry loop is not restricted to GET. shipment-confirmation.ts invokes the shipmentConfirmation POST without maxAttempts:1. A transient HTTP 500 can cause up to four POST attempts. A thrown network timeout escapes this inner HTTP-response retry loop; a later worker retry can nevertheless submit again. These are distinct retry paths, both addressed by the proposed durable design.

## Low-activity window proposal — not confirmed

Proposed next window: **2026-10-16 08:15–08:50 Europe/Madrid (06:15–06:50 UTC)**, before the observed label-generation hours. Last 14 days of imported fulfillment_orders: hour 08 has 3 orders and 0 labels; observed labels begin in hour 09. This is a historical operational proxy, not a guarantee of no new Amazon orders.

Because the legacy credential answer is yes, treat reconciliation as priority. Wait for explicit user confirmation of this window. Do not pause now. If the window is not confirmed in time, propose another confirmed slot rather than deploying late. A night fallback would be 2026-10-17 02:10–02:50 Madrid (00:10–00:50 UTC): observed hour 02 has 0 imported orders and 0 labels.

Before deployment capture exact definitions/states of cron 1 amazon-orchestrator-hourly (7 * * * *), cron 8 amazon-sync-worker (*/5 * * * *) and cron 9 amazon-orders-five-minutes (*/5 * * * *). All are currently active. Pause them and gate amazon-sync-manual before waiting for lease release: pausing cron alone does not stop manual sync from kickWorker(). A temporary backend 503/Retry-After gate may be needed; it must have its own saved original bundle and must not be deployed before the confirmed window.

Follow the approved 14-function order and per-function checks, preserving verify_jwt. At any failure restore each exact production-snapshot bundle and stop. After success restore the prior producer states and monitor lease, queue drain, zero failed and actual finance rows/pages. No producer has been paused and no Edge Function deployed in this task.

## Frontend release blocker

PR #214 remains unmerged: the user requires identifying the current production deployment first. Vercel get_project/get_deployment return 404 and list_deployments returns 403 (no deployment permission); mapped CLI fallback reports no existing credentials. GitHub reports last main 840e2f20 deployment success at https://vercel.com/sergiorojasdiaz-7097/zenvia-gestion/DzZyCo9C3ScgFLr5uwF7UwtHnDRv . This is recorded only as a candidate, not falsely asserted to be the deployment currently aliased to production. No production release or post-release login/reload/logout smoke test has happened. Reconnect appropriate Vercel access or explicitly authorize browser fallback to inspect/preserve rollback and perform the approved release.

## Offline behavioral evidence

`scripts/diagnostics/probe-amazon-credential-scopes.mjs` transpiles the exact embedded config.ts from each pinned snapshot into a VM, with synthetic tenants/tokens and a query adapter. Six assertions pass: both legacy modules select B's fixture token for a malformed job account B, both fall back to the synthetic global B token when stored A lacks one, and worker v34 rejects both unsafe situations. Zero network calls; no real secrets or database used. This reproduces credential selection, not a claim of an actual cross-tenant production write. Output: 20261016-credential-scope-probe.json.
