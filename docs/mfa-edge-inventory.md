# Edge MFA enforcement inventory

Implementation scope: repository Edge sources, reviewed 2026-10-16. No production calls or deployment. Deploy the SQL migration before these functions; an absent/unavailable guard RPC denies human requests rather than bypassing enforcement.

`_shared/mfa.ts` creates a dedicated client using the received bearer token as its global Authorization header (anon API key preferred; configured service key fallback). `_shared/mfa-policy.ts` calls `security_mfa_assert({p_recent})`. The database determines current identity, privileged roles, policy activation, live session, recovery lock and admitted verified factors. Edge never accepts actor-provided AAL/roles or fabricates MFA claims. Existing endpoint role, permissions, active access, tenant and workspace checks remain necessary and unchanged.

| Human entry | Guard | Fresh challenge |
| --- | --- | --- |
| admin-users | Direct | All actions except list |
| integration-accounts | Direct | All except list, gmail_list, gmail_config, shopify_config, discover_shopify |
| app-agent, app-agent-tools | Direct | No |
| customer-billing | Direct | No |
| envia-shipping, mrw-shipping | Direct | No |
| order-logistics-state | Direct | No |
| sendcloud-orders, sendcloud-order-tools | Direct | No |
| shopify-orders | Direct | No |
| invoice-document-intelligence, transport-tariff-parser | Direct | No |
| support-notify human branch | Direct | No |
| amazon-status, amazon-confirm-shipment | Shared authenticateUser | No |
| amazon-sync-manual | Shared authenticateAdminUser → authenticateUser | No |
| amazon-recipient-fallback, amazon-reconcile-orders | Shared authenticateUser on human branch | No |
| shopify-analytics-sync | Shared authenticateUser on human branch | No |
| shared support caller helper | Direct (currently no consumers) | No |

Freshness is applied by SQL to privileged humans; normal Gmail users retain their existing authorization rules. Read-only integration actions above use the ordinary MFA check. The token endpoint, OAuth exchanges, account mutations, disconnection and tests require the fresh check for privileged callers because they access credentials or perform external operations.

## Alternate internal branches

- amazon-recipient-fallback and amazon-reconcile-orders: internal branch requires `requireInternalSecret(req)` matching the configured privileged key in `apikey`. Failure falls back to guarded human authentication and derives owner from the authenticated caller. A client-supplied owner cannot bypass that guard.
- shopify-analytics-sync: supplying ownerId selects the internal branch and requires the internal secret; no secret failure fallback. Human branch derives owner from guarded caller.
- amazon-sync-worker, amazon-sync-orchestrator, amazon-sync-orders, amazon-sync-inventory, amazon-sync-finances, amazon-sync-fx, amazon-sync-product-images, amazon-backfill-finance-components remain machine-only and require the existing internal key. They do not require interactive MFA.
- platform-bridge: validates the stored bridge-secret digest, then requires service-only `security_mfa_bridge_allowed()` to return explicit true. The database denies it when enforcement is enabled. No `actor.aal` is trusted; signed one-use control-plane delegation is not implemented.
- support-notify platform branch has the same bridge decision after validating the stored secret digest.
- platform-mailer remains a secret-authenticated machine email relay, not a human administrative delegation endpoint. website-contact remains public with its existing controls. Neither is treated as evidence of human MFA.

The shared privileged key is existing machine authority, not a scoped per-operation credential. Credential redesign is outside this change. Anyone holding that key already has service-level authority; ordinary browser anon keys do not select the internal branches successfully.

## Validation and limits

`tests/mfa-edge.test.ts` exercises original bearer forwarding, the recent flag, malformed credentials, SQL denial and missing migration, network rejection and explicit bridge authorization. Inventory checks cover every explicit `.auth.getUser(token)` source and confirm machine-only workers preserve their internal secret checks. A deliberate mutation that ignored SQL errors made the denial test fail; restoring enforcement passes. The first preimplementation test invocation could not start because dependencies were absent; dependencies were then linked from the existing workspace installation.

These tests mock the RPC boundary. They do not prove deployed JWT issuer/signature behavior, Auth MFA/session state, actual RPC grants, live RLS, cron execution, or external-provider side effects. SQL integration tests and staging browser/HTTP validation are separate release prerequisites. Inventory describes checked-in source and does not claim parity with all deployed functions.
