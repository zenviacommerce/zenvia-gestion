# Shopify connection

## Own installed app

In Settings → Integrations → Shopify, choose **App propia instalada (ID y secreto)**. Enter the permanent `myshopify.com` domain, the Client ID and Client secret from the Shopify Dev Dashboard. Install the app on that store and grant `read_orders` first. The store and app must belong to the same Shopify organization.

Zenvia obtains a token on the server, checks the shop identity and stores the credentials in Supabase Vault. Both connection tests and order synchronization use the same renewal adapter; tokens are renewed five minutes before expiry. Editing an existing Sendcloud-derived account upgrades that account to a direct connection without replacing its ID.

## Common Zenvia app / OAuth

Set `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` and `SHOPIFY_ALLOWED_ORIGINS` on each tenant's Supabase project. The last variable is a comma-separated allowlist of exact application origins. The default production callback URI is `https://gestion.zenviacommerce.com/`; register it in the Shopify app's allowed redirect URLs. A custom tenant domain requires its own allowed origin and redirect URI.

When the server has both credentials configured, **Autorizar con Shopify** becomes available. The browser stores a random state in session storage. The server binds its hash to the tenant, store, initiating user and a ten-minute expiry, and atomically claims it once. The callback requires a signed Shopify HMAC, the initiating user's authenticated Zenvia session and matching state. Tokens and refresh tokens never return to the browser. OAuth requests expiring offline tokens and renews them server-side.

Shopify distribution settings must allow installation on the intended stores. Installing the current own-store app does not by itself make it available to unrelated customers; public distribution and protected customer data requirements must be completed with Shopify before general customer rollout.

## Compatibility and verification

Legacy Admin API tokens remain supported under **Token de una app antigua**. Client secrets must never be entered as access tokens. Pending authorization uses the existing account and Vault. Apply the `shopify_credential_renewal` migration before deploying: service-only RPCs coordinate renewals across edge functions and reject stale writes after disconnect or credential replacement.

Run `node --test scripts/*.test.mjs`, `npm run build` and `npx deno check supabase/functions/integration-accounts/index.ts supabase/functions/shopify-orders/index.ts`. Deploy both functions with their relative shared dependencies. They validate user sessions internally; keep their current JWT gateway settings. A real connection requires the merchant to enter their app secret or approve the OAuth prompt.
