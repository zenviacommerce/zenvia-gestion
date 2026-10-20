# Order unit weights — implementation and pre-deployment audit

Read-only production audit: 20 October 2026, project `sjkxxbedkkmgmqnvaqjh`. No production rows or credentials were changed by this investigation.

## Five real orders

These are actual recent orders, excluding `DEMO-*`. The calculated fallback column is a mathematical estimate, **not a verified product/package mass**. A product title mentioning “1 kg” was never used as a weight source.

| Order | Stored kg | Quantity | Proposed kg / source | Eligible change |
| --- | ---: | --- | --- | --- |
| 171-8517620-7502702 | 1 | 4 | 4, estimated global fallback (1 kg × 4); verified catalog mass not yet available | Yes: new pending candidate |
| 402-8935535-6572312 | 7 | 3 + 4, two distinct SKUs | 7, existing manual override | No: preserve manual override |
| 407-8017670-0175504 | 1 | 1 | Unknown verified mass; fallback estimate 1 | No: shipped/labelled |
| 403-9480195-0715545 | 1 | 1 | Unknown verified mass; fallback estimate 1 | No: shipped/labelled |
| 402-4096463-2632368 | 1 | 1 | Unknown verified mass; fallback estimate 1 | No: shipped/labelled |

A fresh production read at **11:48 UTC** found new order 171-8517620-7502702 (purchased 11:40:46 UTC; first imported 11:45:08 UTC), pending with quantity 4, stored 1 kg and no manual override. There are now **two real pending orders: one protected manual override and one recalculation candidate**. Under the configured fallback the candidate would change **1 → 4 kg, explicitly estimated**; a verified upstream weight could change that result. The earlier zero-candidate observation is superseded. Demo orders are excluded. The final three table entries remain historical records and are never backfilled.

Production shipping configuration has global fallback 1 kg. `products` has no existing weight column. Amazon cache `amazon_product_images` stores names/images but no weight attributes. Shopify `shopify_analytics_catalog` stores identifiers/names/inventory but no variant grams. Thus no independent verified weight for the three shipped examples can honestly be supplied from existing stored data.

Actual mappings checked: bag SKUs BOLSAGOMINOLAS-10X20-FBM and BOLSAGOMINOLAS-15X30-FBM each have consumption factor 1; ROLLOMERCADO-1UD-FBM factor 1; OX-YEMW-60R6 factor 2. Those factors describe composition, not mass.

## Calculation and provenance

Every line contributes `ordered quantity × sold-unit kg`. Sold-unit weight resolution:

1. Sum all explicitly mapped internal components: `products.unit_weight_kg × mapping.consumption_factor`. Use the internal result only when **every** mapped component has a positive known weight. Mapping reads are scoped to owner and Amazon/Shopify account.
2. Amazon Catalog Items API package weight, then item weight; or captured Shopify line-item variant weight / grams. Convert explicit units to kg before multiplying. Do not parse titles or SKU strings.
3. Configurable `shipping.skuFallbackWeightsKg[sku]`, then existing global `shipping.fallbackWeightKg` (default 1). Fallback values are per sold unit and explicitly estimated.

The payload records `_zenvia_weight` with every line's quantity, unit kg, total kg, source and estimated flag. Verified Amazon measurements are retained on line items; internal mappings continue to take priority. Orders display `(estimado)` where fallback contributes. Product editing exposes nullable positive base-unit kg. Envíos settings exposes SKU fallback weights and the existing global fallback.

Only pending/unshipped eligible orders are calculated. Already shipped, partially shipped, fulfilled, cancelled, labelled, remote-shipment-linked, purged or manually overridden orders retain their stored weight. Legacy manual shipping-edit markers remain authoritative. Empty-item legacy orders retain an explicit existing package measurement.

## Shipping consistency and bounded work

Sendcloud, Envia and MRW quotes/label creation use the same resolver. MRW local tariff pricing uses the returned calculated package weight. Label calculations run after the shared label lease reloads the fresh order. A selected quote's `packageWeightKg` is compared with that resolved weight before purchasing a label: a changed weight returns HTTP 409 and requires new quotations, never silently using a stale quote. Successful label patches persist the exact mass/provenance sent to the carrier.

Catalog requests share an account/owner/marketplace/ASIN cache: 24-hour positive and 5-minute negative entries, capped at 512. Stored verified line measurements bypass catalog calls. Each Amazon import page has a shared maximum of 5 optional lookups / 4 seconds; provider requests have 4 lookups / 3.5 seconds. Individual waits are capped at 2.5 seconds, with a single SP-API attempt. Exhaustion/failure produces marked estimates; optional metadata cannot stall the order importer.

## Deployment and rollback

Apply `20261020113006_order_unit_weights.sql` first. It adds nullable positive product unit weight; it writes no order rows and invents no product weights. It also adjusts the existing Shopify measurement-preservation guard to allow calculated changes on eligible OLD rows, including the first transition to labelled/fulfilled/shipped, while preserving prior manual/shipped/labelled rows.

Deploy the changed Amazon sync, Shopify orders, Sendcloud, Envia, MRW and order-logistics functions with the shared resolver, then frontend. The shared module is imported by Amazon order workers/reconciliation; include it in each deployed function bundle. Existing cron/auth/MFA configuration is unchanged.

Rollback application/functions to the preceding version and run `supabase/rollback-order-unit-weights.sql` to restore the former Shopify guard. Rollback retains the additive product-weight column and any explicitly entered values. No historical shipping data is erased.

## Validation

- Executable tests cover mixed 3+4 units at 1 kg = 7 kg, Shopify grams, all 101 lines, multi-component mapping factors, marked SKU/global fallbacks, manual/terminal/purged eligibility, safe product-weight persistence during failed/slow reads, service request serialization, missing-SKU distinct-ASIN lines, real SQL guard updates including first-label transition, cached/failed/bounded catalog calls, and successful quote / failed cold-label catalog requiring requotation.
- Offline desktop/mobile screenshots and SKU settings save roundtrip: `node scripts/order-weights-screenshots.mjs`; artifacts in `artifacts/order-weights/`.
- Final verification after rebasing onto main `55eb828e`: **1,166 Node script tests passed; 221 Vitest tests across 36 files passed; production build passed; 18 weight tests and 4 product-preservation React tests passed; shared-module Deno check passed**. Desktop/mobile screenshot and SKU-settings save/overflow checks passed. Full Edge Deno dependency resolution is blocked by registry connectivity (`registry.npmjs.org` connection refused), not a demonstrated application type error.
