# Orders PR237 offline visual review

These captures use the actual Orders component and production CSS with synthetic service responses. All browser network requests are blocked; no labels are purchased. External country flag images therefore do not load in this offline fixture. The banner explicitly identifies synthetic data and disconnected providers.

The fixture contains 63 pending orders and a 25-row page. Desktop (1440 × 1100) and mobile (390 × 844) checks cover next/previous pagination, search (1 result), Shopify channel (31), France destination (21), and MRW carrier (31). Selecting the current page checks 25 orders and exposes “Seleccionar los 63 pedidos que coinciden con los filtros”. Clicking it selects all 63 matching orders, and changing to page 2 preserves all 63 selected IDs. Opening the quote preview fetches exactly 63 selected orders and requests exactly 63 unique mocked quotes. Changing the channel filter clears global selection. No browser page errors occurred.

`orders-*` show the initial page, `page-2-*` show the second page, and `selection-detail-*` show 25 selected with the explicit all-results link. `all-results-*` and `all-results-detail-*` show the global 63-order scope; `all-results-page-2-*` prove it survives pagination. `generate-all-results-*` show the 63-order quote preview, closed with Cancelar without clicking Generar todas. Older `generate-selected-*` captures retain the earlier page-only 25-order preview for comparison. `manifest.json` records the current browser assertions.

These are offline UI fixtures, not provider API or production database evidence. Oversize selection rejection is covered separately by the application tests, not simulated by this visual harness.

Reproduce from repository root with `SHIPPING_CHROMIUM_PACKAGE=1 node scripts/orders-visual-screenshots.mjs` when the packaged Chromium dependency is available, or omit the environment variable with a Playwright Chromium installation. The script writes fresh captures to `artifacts/orders-visual`.
