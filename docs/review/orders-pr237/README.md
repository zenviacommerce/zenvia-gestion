# Orders PR237 offline visual review

These captures use the actual Orders component and production CSS with synthetic service responses. All browser network requests are blocked; no labels are purchased. External country flag images therefore do not load in this offline fixture.

The fixture contains 63 pending orders and a 25-row page. Desktop (1440 × 1100) and mobile (390 × 844) checks cover next/previous pagination, search (1 result), Shopify channel (31), France destination (21), MRW carrier (31), selecting all 25 preparable orders on the current page, opening their quote preview, and clearing selection when switching pages. Quote preview requests exactly 25 mocked quotes. It is closed without confirming generation.

`orders-*` show the initial page, `page-2-*` show the second page, `selection-detail-*` show the explicit page-only selection scope, and `generate-selected-*` show the quote preview. `manifest.json` records browser assertions and page errors.

Reproduce from repository root with `SHIPPING_CHROMIUM_PACKAGE=1 node scripts/orders-visual-screenshots.mjs` when the packaged Chromium dependency is available, or omit the environment variable with a Playwright Chromium installation. The script writes fresh captures to `artifacts/orders-visual`.
