# Orders product lines — visual regression review

The harness bundles the actual Orders page, production styles, and five synthetic product lines with quantities 3, 4, 1, 2, and 5. All network traffic is blocked; it does not read buyer data or contact shipping providers.

Before mode loads `src/pages/Orders.tsx` through an esbuild `onLoad` override and `src/orders-products.css` from baseline commit `9ce09977`. After mode loads the current working tree. The remaining production styles are the same for both modes.

```sh
SHIPPING_CHROMIUM_PACKAGE=1 node scripts/orders-product-lines-screenshots.mjs before --assert
SHIPPING_CHROMIUM_PACKAGE=1 node scripts/orders-product-lines-screenshots.mjs after
```

The baseline command is expected to exit 1. Desktop originally rendered the first product at weight 700 / 13px while secondary products used weight 400 / 12px and a different color. Mobile originally showed only the first product and “+4 productos”, without quantities.

Checks at 1440 × 1050 and 390 × 1000 require three separate product lines, matching computed font weight/size/color across all three products and exactly matching the baseline first product per viewport, visible quantities including ×1, a “+2 más” indicator with both remaining names and quantities in its tooltip, unclipped fixture text, no document overflow, and no browser errors. The manifests store measured text and computed styles. Each viewport includes a context screenshot and a product area close-up.

| Viewport | Baseline first product | All three new product lines |
| --- | --- | --- |
| Desktop 1440px | 700 / 13px / rgb(71, 85, 105) | Exact match |
| Mobile 390px | 700 / 12px / rgb(23, 32, 51) | Exact match |
