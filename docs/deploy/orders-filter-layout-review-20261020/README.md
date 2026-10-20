# Orders filter layout review — 2026-10-20

The offline harness renders the actual Orders component and production styles, with synthetic orders and all network requests blocked. No authenticated data, provider quotes, or purchases are involved.

At 1280px before the fix, Transportista grew to 58px while its peers stayed at 42px, shifting its label and control upward by 16px. The shared select text rule allowed wrapping. At 390px the shared responsive rule produced 48px controls. The scoped Orders grid now uses equal desktop columns, a three/two/one-column responsive layout, zero minimum widths, 42px controls, and single-line ellipsis.

| Viewport | Before | After |
| --- | --- | --- |
| 1280 × 1050 | Carrier 58px; other controls 42px; label/control misalignment | Five aligned 42px controls; carrier text visibly truncates |
| 1440 × 1050 | 42px controls, wrapping allowed | Five aligned 42px controls; single-line text |
| 390 × 1000 | 48px controls | Stacked 42px controls; no document overflow |

`before-*` evidence was captured from baseline `af62a9f591be0132df012a4941e4fbeb5ed8b064` before the CSS or header edits. `after-*` uses the working tree. Filter screenshots show the filter controls; report-column screenshots show the horizontally scrolled desktop table and mobile report membership cards.

Run after verification from the repository root:

```sh
SHIPPING_CHROMIUM_PACKAGE=1 node scripts/orders-filter-layout-screenshots.mjs after
```

The script also checks the desktop report header has a title-case sort button and icon. It exits unsuccessfully for unequal heights or desktop widths, desktop label/control misalignment, text missing nowrap/ellipsis, page overflow, or browser errors. The JSON manifests record measured coordinates, dimensions, truncation, and failures for each viewport.

To reproduce the failing filter layout in the current checkout, run:

```sh
SHIPPING_CHROMIUM_PACKAGE=1 node scripts/orders-filter-layout-screenshots.mjs before --assert
```

The `before` mode loads the baseline Orders stylesheet from the revision above and preserves failure measurements and screenshots; `--assert` also exits unsuccessfully. Without the packaged Chromium fallback, install Playwright Chromium and omit the environment variable.
