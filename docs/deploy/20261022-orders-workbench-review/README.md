# Orders workbench review · 22 October 2026

Open [gallery.html](gallery.html) for paired before/after views. There are 42 full-page screenshots: six Orders contexts plus Dashboard at 390, 1280 and 1440 px. Six additional 1000px viewport previews cover Pending at 390/1440 and Dashboard at 1440; gallery previews link to the complete captures.

Before product sources and shared UI modules/CSS come from immutable baseline `21622348044745dd54978f69ac80f39321f39533`. After uses the working tree. Both mount the actual React components, app CSS, Sidebar, dialogs and production tariff access with the same deterministic 43-order synthetic fixture. No provider, database or live customer data is used; all browser network requests are blocked.

| Context | 390 | 1280 | 1440 |
| --- | --- | --- | --- |
| Pendientes | 1786 → 569 px | 1450 → 667 px | 1375 → 626 px |
| Etiquetados | 1786 → 551 px | 1450 → 594 px | 1375 → 594 px |
| Enviados | 1786 → 730 px | 1450 → 743 px | 1375 → 743 px |
| Incidencias | 1786 → 551 px | 1450 → 545 px | 1358 → 545 px |
| Cancelados | 1786 → 730 px | 1450 → 694 px | 1375 → 694 px |
| Informes de recogida | Modal → inline history | Modal → inline history | Modal → inline history |
| Resumen | — | — | — |

Values show the first order row top before → after. Document horizontal overflow is zero at every captured width; table and tab scrolling remain internal. Original table columns and sticky-cell computed styles are recorded in the manifests.

The fixture has 15 pending (including a September order), 10 labelled (including a September order), 14 shipped and 4 source-cancelled orders. Issues includes the normalized exception and active shipment with old movement despite a fresh tracking check; a terminal delivered shipment with old movement is excluded. Sales aggregate 39 non-cancelled orders with destination VAT rates. The shipping aggregate includes all 28 labelled shipments, matching the existing RPC cost scope. The Dashboard financial request returns one visible order while retaining all aggregate totals and off-page shipping candidates.

- [before-manifest.json](before-manifest.json): geometry, source/CSS hashes, row columns, sticky styles, controls and fixture truth.
- [after-manifest.json](after-manifest.json): the same evidence, six tab states, full-scope finance request and response evidence.
- [after-interactions.json](after-interactions.json): read-only action and selection checks.
- [comparison.json](comparison.json): original header action reachability and unchanged row-column checks.

Interaction checks cover selection across tabs, server pages, search and all three sort states; tariff access; manual order and pickup-report open/cancel; inline report history and isolated saved-PDF reprint; and mobile More actions. No label purchase, order creation, report creation or message send is executed.

Reproduce from the repository root:

```sh
node scripts/orders-workbench-review.mjs before
node scripts/orders-workbench-review.mjs after
```

The script uses the primary runtime Playwright and the existing local Chromium fallback. `UI_CAPTURE_SOURCE` can select another immutable source revision; `DESIGN_REVIEW_OUTPUT` can select an output directory. Nothing is published.

Action inventory (before → after)

| Function | Before | After | Evidence |
| --- | --- | --- | --- |
| Transport tariffs | Header enhancement | Desktop header; mobile Más acciones | Real production hook; open/close at both widths |
| Direct printing | Header | Desktop header; mobile Más acciones | Reachable control preserved; no print job sent |
| Quick label format | Header | Desktop header; mobile Más acciones | Options open and Escape without changing settings |
| Manual order | Header | Header | Open and cancel |
| Refresh orders | Header | Header | Reachable control inventory; no provider sync executed |
| Selected / pending labels | Header and bulk toolbar | Contextual Pending toolbar | Selection preserved; no purchase executed |
| Pickup report preparation | Bulk toolbar | Labelled / Shipped toolbar | Preview and cancel; no report created |
| Pickup report history | Header modal | Inline Reports tab with search/carrier filter | Saved report mock reprint |
| Manual Shopify invoicing | Order toolbar / drawer | Desktop header; mobile Más acciones; drawer | All five matching pending Shopify candidates open; cancel |
| Status view | Five status buttons | Six workbench tabs; All via advanced filter | Captured context and tab inventories |
| Channel, destination, carrier, report, tracking | Always-visible filters | Añadir filtro and removable chips where relevant | Original service scope retained |
| Period | Global Orders panel | Shipped / Cancelled panels; Dashboard financial period | Older pending/labelled fixture orders retained |
| Selection | Page/all-matching select, view, clear | Bulk toolbar | Three IDs survive page/tab/search/sort |
| Row details and shipment actions | Drawer | Drawer | Before/after button/link inventories; open/close only |
| Order financial cards | Orders | Dashboard, all five cards | One-row server page retains full sales/cost aggregate |

Preserved table column inventory

| Position | Before | After |
| --- | --- | --- |
| 1 | Selection | Selection |
| 2 | Canal | Canal |
| 3 | Pedido | Pedido |
| 4 | Cliente | Cliente |
| 5 | Productos | Productos |
| 6 | Destino | Destino |
| 7 | Transportista | Transportista |
| 8 | Envío | Envío |
| 9 | Peso | Peso |
| 10 | Unidades | Unidades |
| 11 | Total | Total |
| 12 | Estado | Estado |
| 13 | Seguimiento | Seguimiento |
| 14 | Fecha pedido | Fecha pedido |
| 15 | Fecha etiqueta | Fecha etiqueta |
| 16 | Impresión | Impresión |
| 17 | Informe de recogida | Informe de recogida |
| 18 | Row actions | Row actions |

Dark smoke: [manifest](dark-smoke-manifest.json) covers 390px Pending with the action menu and filter dialog open, plus 1440px Dashboard. Three additional viewport captures verify dark rendering, zero document overflow and zero JavaScript/console errors. Offline flag assets are local synthetic stand-ins.

Full protection ledger: [functional inventory](FUNCTIONAL_INVENTORY.md). Local tests and pending deployment protocol: [validation](VALIDATION.md).
