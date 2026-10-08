# Shopify connection

## Own installed app

In Settings → Integrations → Shopify, choose **App propia instalada (ID y secreto)**. Enter the permanent `myshopify.com` domain, the Client ID and Client secret from the Shopify Dev Dashboard. Install the app on that store and grant `read_orders` first. The store and app must belong to the same Shopify organization.

Zenvia obtains a token on the server, checks the shop identity and stores the credentials in Supabase Vault. Both connection tests and order synchronization use the same renewal adapter; tokens are renewed five minutes before expiry. Editing an existing Sendcloud-derived account upgrades that account to a direct connection without replacing its ID.

## Common Zenvia app / OAuth

Set `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` and `SHOPIFY_ALLOWED_ORIGINS` on each tenant's Supabase project. The last variable is a comma-separated allowlist of exact application origins. The default production callback URI is `https://gestion.zenviacommerce.com/`; register it in the Shopify app's allowed redirect URLs. A custom tenant domain requires its own allowed origin and redirect URI.

**Autorizar con Shopify** is the default flow. If environment credentials are unavailable, an administrator can configure the app once in the initial setup card. Those credentials are stored in Vault under a tenant-scoped name; subsequent connections require only the shop domain. Register the exact callback URI displayed in the setup card in Shopify and publish the app version before authorizing. A central Zenvia deployment can instead provision the shared environment credentials for its customers.

The browser stores a random state in session storage. The server binds its hash to the tenant, store, initiating user and a ten-minute expiry, and atomically claims it once. The callback requires a signed Shopify HMAC, the initiating user's authenticated Zenvia session and matching state. Tokens and refresh tokens never return to the browser. OAuth requests expiring offline tokens and renews them server-side.

Shopify distribution settings must allow installation on the intended stores. Installing the current own-store app does not by itself make it available to unrelated customers; public distribution and protected customer data requirements must be completed with Shopify before general customer rollout.

## Compatibility and verification

Legacy Admin API tokens remain supported under **Token de una app antigua**. Client secrets must never be entered as access tokens. Pending authorization uses the existing account and Vault. Apply the `shopify_credential_renewal` migration before deploying: service-only RPCs coordinate renewals across edge functions and reject stale writes after disconnect or credential replacement.

Run `node --test scripts/*.test.mjs`, `npm run build` and `npx deno check supabase/functions/integration-accounts/index.ts supabase/functions/shopify-orders/index.ts`. Deploy both functions with their relative shared dependencies. They validate user sessions internally; keep their current JWT gateway settings. A real connection requires the merchant to enter their app secret or approve the OAuth prompt.

## Confirmación de envíos
Al crear una etiqueta, la automatización «Comunicar al marketplace» también confirma Shopify directamente. Requiere `read_orders`, `read_merchant_managed_fulfillment_orders` y `write_merchant_managed_fulfillment_orders`; añadir los permisos en Shopify, publicar y volver a conectar las cuentas existentes. Usa las cantidades restantes por ubicación y comunica transportista, número y URL de seguimiento. No envía correos al cliente (`notifyCustomer:false`). Los reintentos usan un bloqueo por pedido y comprueban los fulfillments remotos antes de crear nuevos. Si Shopify falla, la etiqueta se conserva y se registra la incidencia; se reintenta al refrescar Pedidos cuando está habilitado. No ejecuta confirmaciones nuevas si guardar seguimiento o comunicar al marketplace están desactivados.


## Cancelaciones desde Pedidos

En el detalle de un pedido, «Anular etiqueta» conserva el pedido y solicita la anulación al transportista asociado. «Cancelar pedido» solicita la cancelación en Amazon FBM o Shopify y, si existe etiqueta, presenta su anulación por separado. Amazon requiere un pedido MFN en estado Unshipped: se consulta el estado remoto y se envía un POST_ORDER_ACKNOWLEDGEMENT_DATA, con seguimiento del informe. Shopify requiere write_orders; las cuentas existentes deben actualizar los permisos de la app y volver a autorizar. Por defecto no hay reembolso ni aviso al cliente; se puede seleccionar reembolso y reposición de inventario antes de la confirmación.

Las solicitudes pendientes se comprueban con «Comprobar cancelación» y mientras está abierto el detalle. Una respuesta incierta no se reenvía automáticamente. Un rechazo definitivo admite un nuevo intento explícito y conserva los anteriores en el registro. La anulación confirmada elimina la etiqueta activa y permite crear otra; no garantiza un abono del transportista. El reemplazo actualiza el tracking de los fulfillments Shopify correspondientes, incluso en varias ubicaciones, sin duplicarlos. Amazon solo actualiza un paquete cuando puede identificarlo de forma segura.
