Generic shipment tracking validation

The UI preserves recorded carrier deep links. For provider links or missing links it calls the authenticated tracking resolver. The backend reads shipment metadata, follows provider redirects, returns the carrier destination unchanged, and caches the result against tracking number with tenant and concurrent-sync guards. No per-carrier URL mappings remain.

Verification: 22 cost/tracking tests passed, frontend production build passed, new Edge Function code passed TypeScript checking with runtime declarations. Full suite: ℹ tests 698, ℹ pass 671, ℹ fail 27

The remaining failures also exist in the pre-change baseline.

Limitations: not deployed; requires deployment of frontend plus order-logistics-state, envia-shipping and sendcloud-orders and the shared module. Live MRW/Correos Express shipments were not queried. This does not manufacture a carrier URL when neither provider metadata nor a forwarding URL supplies it; those shipments show an explicit unavailable message. Native MRW label responses currently lack a carrier tracking URL, so native shipments without a previously recorded forwarding or carrier URL remain unavailable.

Existing failures:

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
- tenant-local ZENVIA agent authenticates the user and runs without paid model APIs
- transport tariff parser can use AI but safely falls back without auto-activation

## Tracking regression correction (2026-10-02)

- Deployed order-logistics-state version 11 to Gestión with JWT verification enabled; verified deployed source contains resolve_tracking_link and its shared dependency.
- Preserved existing Sendcloud carrier forwarding URLs, including MRW, when server-side resolution is unavailable. No carrier URL templates were added.
- Drawer hides unavailable/error text and displays available stored tracking links immediately.
- All 24 focused tracking and shipping-cost tests passed; frontend build and edge TypeScript check passed. Full-suite baseline failures recorded above remain outside this correction.
- A carrier link still requires a recorded URL or metadata/redirect supplied by the integration.
