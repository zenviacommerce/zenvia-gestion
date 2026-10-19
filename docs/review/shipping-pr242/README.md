# PR 242 visual review

Captured from local commit `bab7a830` plus the one-rate singular-copy correction (`fix/shipping-route-applicability-20261019`) in an isolated worktree. No deployment, merge, carrier requests, or label creation occurred.

- `route-exclusions-and-timeout-desktop.png`: actual modal at 1440 px browser width.
- `route-exclusions-and-timeout-mobile.png`: actual modal at 390 px browser width.
- Captures include the complete modal by expanding viewport height after layout; the mobile image therefore demonstrates the narrow layout, not a single 844 px screen.
- Actual `LabelModal`, `ShippingProviderStatus`, `collectProviderQuotes`, and production CSS are bundled. Other Orders page dependencies are stubbed solely to isolate the modal.
- Synthetic Sendcloud reply contains a successful Correos Express rate (€5.90). Synthetic Envia.com reply contains DHL (Madrid origin without coverage) and Cainiao (China-only origin) diagnostics. MRW never resolves and reaches the actual collector's 100 ms fixture deadline.
- Playwright asserts exactly one Retry button, belonging to MRW; Envia.com has no Retry, the successful Correos Express option remains visible, and the one-rate count reads `1 opción con precio`. Browser page errors fail capture. All browser network requests are aborted. Label creation handler throws if invoked.
- Both PNGs were visually inspected: route reasons are readable, Retry appears only for timeout, retained rate and modal actions are visible, and narrow layout has no clipping.

Reproduce with existing dependencies (Playwright and @sparticuz/chromium):

```sh
SHIPPING_CHROMIUM_PACKAGE=1 node scripts/shipping-pr242-screenshots.mjs
```

The diagnostic text and rate are fixtures for display review, not evidence of live carrier coverage or pricing.
