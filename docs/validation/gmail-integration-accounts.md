# Gmail account management validation

Accounts are managed in Integrations and consumed by the expense importer. The importer uses the registered default, stores each new candidate with its integration account ID, and renews only the selected mailbox. Expense users can list/use Gmail accounts; only admins can connect, renew, configure or disconnect them.

## Verification

- Production build: passed (existing bundle size warning).
- Gmail focused tests: 17 passed.
- Full suite: 785 tests, 759 passed, 26 failed. All 26 failures also reproduce on the previous main commit `1d11744ba63a420596bcc1b53620a3644e2f33d3`. No new failures.
- Existing deployed integration-accounts source was compared with the repository before deployment; it matched apart from the trailing newline. Its existing authentication and transport behavior are preserved.
- Browser check reached the sign-in page. No authenticated Google consent or invoice import was performed.

## Persistent Google authorization

The server implements code exchange, encrypted refresh-token storage through the existing integration Vault RPCs, renewal and revocation. The frontend never receives a refresh token or client secret. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Supabase Edge Function secrets for the application's Google OAuth client. Optionally set `GMAIL_ALLOWED_ORIGINS` to a comma-separated allowlist; defaults are the two production origins. Renew an existing Gmail account from Integrations to migrate its session authorization. Until configured, normal Google login remains available with session authorization. The existing Gmail account was verified as session-based. Live server secret configuration has not been independently verified.

## Pre-existing failures

- Envia quotes sanitize state values and quote one carrier per request
- MRW connection validation supports both AuthInfo and legacy AuthInfoSWGE contracts
- MRW connection validation uses read-only SOAP operations and never exposes raw HTML runtime pages
- MRW preflight blocks label creation when parcel dimensions are missing
- Orders auto-sync uses a stable in-flight guard instead of depending on syncing state
- Orders exposes bulk label generation and configurable post-create downloads
- Orders keeps refreshing direct Amazon state with no logistics aggregator enabled
- Pedidos and Envíos settings expose operational controls
- Sendcloud V3 shipping-options request includes route fields so quotes can be calculated
- all static settings-specific layout classes used by SettingsPage have a CSS definition
- contracted tariffs are scoped to exactly one shipping provider
- expense duplicate detection uses shared supplier identity matching
- expense imports require human review when the AI verifier is unavailable
- generic tariff fallback never interprets VAT percentage as fuel surcharge
- integration UI shows provider logos and models Shopify honestly as a Sendcloud channel
- label creation revalidates against the carrier actually selected
- live quote comparison shows source, carrier, service, contracted tariff and delta
- native Amazon orders can be edited locally without a Sendcloud remote order
- native routing survives migration of existing Sendcloud-backed Amazon rows
- orders runtime consumes refresh tracking label and shipping settings
- orders use searchable selects for growing catalogs and SelectField for tracking enum
- shipping rules persist and preserve Baleares Correos plus mainland MRW defaults
- single expense upload blocks bundled PDFs and redirects to the normalized bulk flow
- tariff parser is generic and preserves document table structure
- tariff parser spends AI only when local extraction is insufficient and sends original PDF when needed
- transport tariff parser can use AI but safely falls back without auto-activation
