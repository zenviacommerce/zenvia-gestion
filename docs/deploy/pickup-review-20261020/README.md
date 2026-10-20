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
