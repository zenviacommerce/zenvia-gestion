# Tracking coverage and Orders actions — 22 October 2026

## Step 1: verified diagnosis

The Shopify importer explicitly submitted `shipping_integration_account_id: null` on every channel snapshot. MRW label creation correctly saved its carrier account. The existing local tracking trigger preserved carrier status but omitted the carrier account, so later Shopify imports erased it. Tracking correctly refused an accountless shipment; there is no channel exclusion in the worker.

Reviewed 45-day coverage: Shopify/MRW 8 missing (7 READY_TO_SEND, 1 delivered). All eight have a single enabled, connected MRW account belonging to the same owner, created before all eight labels. Amazon missing: Sendcloud 64 delivered (labels 16–30 September); Envia 11 delivered + 1 delivered at origin; provider null 8 delivered. These 84 terminal shipments will not be polled.

Fix: omit the carrier association from Shopify channel writes entirely, avoiding a stale-read race; add a narrowly scoped database guard for older importer versions while shipment identity remains unchanged. Never infer accounts in the normal tracking worker or weaken owner/account matching.

Tests: regression initially failed with the explicit NULL write; isolated PostgreSQL tests cover Shopify direct MRW label → refresh → seed → claim, the pre-PDF interval, intentional account replacement, owner mismatch, cancellation and relabelling. Targeted 40 tests passed.

## Production change preparation

Exact bounded repair: [repair.sql](repair.sql). Expected: 8 carrier associations, only 7 tracking candidates; abort if counts change or account selection is ambiguous. A private, access-restricted snapshot precedes the UPDATE in the same transaction. No customer data or actual tracking identifiers in this public repository.

Edge rollback: original deployed `shopify-orders` v14 and its complete file set captured privately. Deployment will change only the single NULL assignment; existing deployed shared auth/MFA files will be retained byte-for-byte because some differ from the repository. JWT verification remains false, with existing handler authorization unchanged.

Database guard rollback: drop `fulfillment_preserve_shopify_carrier_account` trigger and `private.preserve_shopify_carrier_account()` only. Data rollback must use the private snapshot and verify no subsequent shipment identity changes; do not blindly undo carrier results or erase audit history.

UI rollback baseline: production commit c570c47dd688ece8d00e2c83c03653f45e00d9e4, deployment dpl_7vBQnPC6hWVntVa7B8aNfh4AVHhc. Latest user explicitly authorized deployment after screenshots, interaction checks and green CI.

## Step 1 production execution

Applied guard migration `20261022133958`; deployed Shopify importer v15 with only the NULL assignment removed from v14's exact deployed bundle, preserving all deployed shared dependencies and MFA. Applied bounded repair `20261022134014` with private snapshot + audit in the same transaction. Automatic worker runs every five minutes; only the seven seeded non-terminal shipments are newly eligible. Post-repair receipt to follow after carrier responses.

Worker receipt (22 October 13:45 UTC): all seven queried successfully; five `delivered` (MRW 00, Entregado), two `out_for_delivery` (MRW 16, Envío en reparto, movements on 22 October). Zero failures. Carrier truth retained; no inferred or forced delivery status. The eighth pre-existing terminal order remains excluded.

## Step 2: mobile menu

Reproduced against the published product revision: the native details element opens, but later shared UI CSS `.page .dsPageHeaderActions` overrides the equally specific Orders rule and applies `overflow-x:auto; overflow-y:hidden`. The menu is clipped. The old locator interaction could auto-scroll clipped elements into view and therefore falsely pass. The new test enables real touch support, taps More at 390px, checks `elementFromPoint` at option centers, then taps through tariffs and verifies the destination panel. Both options fail hit-testing before the CSS fix. Scoped `.ordersPage.ordersWorkbench .dsPageHeaderActions` now wins without changing global UI styles.

## Step 3: intentional direct-print retirement

Removed the header button, printer selector/bar, printer detection/local HTTP clients, printer preference type/default/serialization and legacy storage migration, and the standalone Print Agent source/installers. Existing persisted printer keys are silently discarded on read; no bulk preference UPDATE is needed. Removed obsolete printer-bar CSS selectors. Updated action tests to document this intentional removal; all other action/column/drawer inventory remains mandatory.

Kept `Formato del PDF` in More: A6/A4/A5/10×15/Original feed `prepareLabelPdf` for generated and downloaded labels, not just the retired agent. Normal PDF download and browser PDF printing remain available. Historic printed/downloaded state is retained. No actual labels, invoices or pickup documents were issued during tests; browser review uses synthetic fixtures with all external network blocked.

## Local verification and review

Full Node suite: 1,281 passed, zero failures. Full Vitest suite: 98 files / 526 tests passed. Production build and design contract passed. Review independently found no important blockers; its minor retired-preference warning finding was corrected with an executable backwards-compatibility regression.

Before/after captures: Pending and Issues at 390/1280/1440, plus opened More menu at all three widths. [Gallery](gallery.html), [action/column inventory](comparison.json), [touch interaction receipt](after-interactions.json). Before is immutable production c570c47; all fixtures synthetic and external network blocked. Only intentionally removed action is Impresión directa. Other header and drawer actions and table columns reconcile. At 390 the menu overflow changes from `auto hidden` to `visible`; both option centers receive real touch targeting. No page errors or write/purchase/send calls.
