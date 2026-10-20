# Informes, selección fija y sello — revisión

Capturas de componentes reales y CSS de la aplicación con servicios simulados y red bloqueada. No se han creado informes ni comprado etiquetas en producción. El sello rectangular es un ejemplo sintético, no una imagen aportada por el propietario; sus datos fiscales también son de prueba.

## Pedidos
- [order-report-history-desktop](order-report-history-desktop.png)
- [order-report-history-mobile](order-report-history-mobile.png)
- [orders-reports-desktop](orders-reports-desktop.png)
- [orders-reports-mobile](orders-reports-mobile.png)
- [orders-sticky-scroll-desktop](orders-sticky-scroll-desktop.png)
- [orders-without-report-desktop](orders-without-report-desktop.png)
- [orders-without-report-mobile](orders-without-report-mobile.png)

## General y PDF
- [settings-general-desktop](settings-general-desktop.png)
- [settings-general-mobile](settings-general-mobile.png)
- [settings-stamp-desktop](settings-stamp-desktop.png)
- [settings-stamp-mobile](settings-stamp-mobile.png)
- [settings-stamp-removed-desktop](settings-stamp-removed-desktop.png)
- [settings-stamp-removed-mobile](settings-stamp-removed-mobile.png)

- [PDF con sello sintético](pickup-synthetic-stamp.pdf)
- [Página PDF renderizada](pickup-synthetic-stamp.png)
- [Escaneo con borde gris](stamp-synthetic-scanned.png)
- [Sello procesado con transparencia](stamp-synthetic-processed.png)

Reproducir: `SHIPPING_CHROMIUM_PACKAGE=1 node scripts/pickup-membership-screenshots.mjs` y `node scripts/company-stamp-review.mjs` (Playwright/Chromium del entorno de revisión). Prueba sticky adicional: `CHROMIUM_EXECUTABLE_PATH=/ruta/chromium node --test scripts/sticky-selection.browser.mjs`.
