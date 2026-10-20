# Informe de recogida — revisión sin publicar

Capturas con datos sintéticos, componentes reales y red bloqueada. No se han creado informes, etiquetas ni cambios en producción.

| Flujo | Escritorio | Móvil |
|---|---|---|
| Seleccionar todos los63 filtrados | [Captura](selection-all-desktop.png) | [Captura](selection-all-mobile.png) |
| Revisión: dos transportistas y bultos | [Captura](review-mixed-desktop.png) | [Captura](review-mixed-mobile.png) |
| Histórico y reimpresión | [Captura](history-desktop.png) | [Captura](history-mobile.png) |
| Tracking ausente | [Captura](missing-tracking-desktop.png) | [Captura](missing-tracking-mobile.png) |
| Ya incluido en otro informe | [Captura](duplicate-warning-desktop.png) | [Captura](duplicate-warning-mobile.png) |
| Confirmación de repetidos | [Captura](duplicate-confirm-desktop.png) | [Captura](duplicate-confirm-mobile.png) |
| PDF: primera página | [Vista](pdf-preview-first-desktop.png) | [Vista](pdf-preview-first-mobile.png) |
| PDF: firmas del transportista | [Vista](pdf-preview-signatures-desktop.png) | [Vista](pdf-preview-signatures-mobile.png) |

[PDF generado por el flujo de63 pedidos](flow-desktop.pdf) · [PDF de paginación con48 pedidos y72 bultos](pdf-manifest-sample.pdf).

Las vistas de PDF muestran imágenes renderizadas del PDF real del flujo; son un harness de revisión, no un visor nuevo dentro de la aplicación. El PDF se descarga para imprimirlo. No lleva datos personales del comprador.

Scripts reproducibles: scripts/pickup-screenshots.mjs y scripts/pickup-pdf-preview-screenshots.mjs. Manuscrito de firma en papel; guardar una copia firmada escaneada no forma parte de esta PR. QR/código de barras opcional pendiente.


Revisión del acabado (20/10): Helvetica estándar sin espaciado manual; renders MuPDF para evitar la sustitución defectuosa de fuentes Base14 observada en las capturas Poppler anteriores. Filas con líneas fuera del texto y tracking largo ajustado a su columna. Recuadros de firma de 82/86 × 30 mm, fecha y hora de recogida en blanco. Canal Amazon/Shopify y pie Página X de Y. Creado 09:30 y generado 09:45 (Madrid), fijados en los fixtures. El logotipo mostrado en esta revisión es el REAL de General, descargado de company-assets por la sesión autenticada y normalizado a PNG; la aplicación carga el de Configuración → General al descargar/reimprimir (si no está disponible, conserva la cabecera textual y los datos guardados). No se altera el snapshot de los pedidos.

Reproducir: `node scripts/pickup-pdf-fixture.mjs`, `SHIPPING_CHROMIUM_PACKAGE=1 node scripts/pickup-screenshots.mjs`, `SHIPPING_CHROMIUM_PACKAGE=1 node scripts/pickup-pdf-preview-screenshots.mjs`. El último script usa `scripts/pickup-pdf-render.py` (PyMuPDF).


## Logo real de producción (revisión posterior a #251)

[PDF con el logo real](pdf-manifest-sample.pdf) · [Primera página](pdf-manifest-page-1.png) · [PDF sin logo](pdf-no-logo-sample.pdf) · [Captura sin logo](pdf-no-logo-page-1.png). Los pedidos, remitente y números de informe de las muestras siguen siendo sintéticos; solo el logotipo procede de producción. No se creó ningún informe en la base de datos.
