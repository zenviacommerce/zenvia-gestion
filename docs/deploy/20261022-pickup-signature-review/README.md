# Firma e informes por transportista — revisión

Sin publicar. Componentes reales con datos sintéticos y red bloqueada; cero correos reales. Baseline local A: 2659cc4.

## Antes y después

| Pantalla | Ancho | Tema | Antes | Después |
|---|---:|---|---|---|
| create | 390 | light | [Ver](before-create-390-light.png) | [Ver](after-create-390-light.png) |
| create | 390 | dark | [Ver](before-create-390-dark.png) | [Ver](after-create-390-dark.png) |
| create | 1280 | light | [Ver](before-create-1280-light.png) | [Ver](after-create-1280-light.png) |
| create | 1280 | dark | [Ver](before-create-1280-dark.png) | [Ver](after-create-1280-dark.png) |
| create | 1440 | light | [Ver](before-create-1440-light.png) | [Ver](after-create-1440-light.png) |
| create | 1440 | dark | [Ver](before-create-1440-dark.png) | [Ver](after-create-1440-dark.png) |
| history | 390 | light | [Ver](before-history-390-light.png) | [Ver](after-history-390-light.png) |
| history | 390 | dark | [Ver](before-history-390-dark.png) | [Ver](after-history-390-dark.png) |
| history | 1280 | light | [Ver](before-history-1280-light.png) | [Ver](after-history-1280-light.png) |
| history | 1280 | dark | [Ver](before-history-1280-dark.png) | [Ver](after-history-1280-dark.png) |
| history | 1440 | light | [Ver](before-history-1440-light.png) | [Ver](after-history-1440-light.png) |
| history | 1440 | dark | [Ver](before-history-1440-dark.png) | [Ver](after-history-1440-dark.png) |
| orders | 390 | light | [Ver](before-orders-390-light.png) | [Ver](after-orders-390-light.png) |
| orders | 390 | dark | [Ver](before-orders-390-dark.png) | [Ver](after-orders-390-dark.png) |
| orders | 1280 | light | [Ver](before-orders-1280-light.png) | [Ver](after-orders-1280-light.png) |
| orders | 1280 | dark | [Ver](before-orders-1280-dark.png) | [Ver](after-orders-1280-dark.png) |
| orders | 1440 | light | [Ver](before-orders-1440-light.png) | [Ver](after-orders-1440-light.png) |
| orders | 1440 | dark | [Ver](before-orders-1440-dark.png) | [Ver](after-orders-1440-dark.png) |

## Flujo nuevo

| Estado | 390 claro | 1440 claro | 1440 oscuro |
|---|---|---|---|
| created | [Ver](after-created-390-light.png) | [Ver](after-created-1440-light.png) | [Ver](after-created-1440-dark.png) |
| pending | [Ver](after-pending-390-light.png) | [Ver](after-pending-1440-light.png) | [Ver](after-pending-1440-dark.png) |
| signature | [Ver](after-signature-390-light.png) | [Ver](after-signature-1440-light.png) | [Ver](after-signature-1440-dark.png) |
| signed | [Ver](after-signed-390-light.png) | [Ver](after-signed-1440-light.png) | [Ver](after-signed-1440-dark.png) |
| email | [Ver](after-email-390-light.png) | [Ver](after-email-1440-light.png) | [Ver](after-email-1440-dark.png) |
| void | [Ver](after-void-390-light.png) | [Ver](after-void-1440-light.png) | [Ver](after-void-1440-dark.png) |
| orders-filter | [Ver](after-orders-filter-390-light.png) | [Ver](after-orders-filter-1440-light.png) | [Ver](after-orders-filter-1440-dark.png) |

Firma con dedo, eventos táctiles nativos de Chromium: [claro](after-finger-390-light.png), [oscuro](after-finger-390-dark.png). DPR 3 y scroll sin cambios comprobados en manifest.json.

## PDF sintético

[Firmado](signed-synthetic.pdf) · [Vista](signed-pdf.png) · [Tras retención](retained-synthetic.pdf) · [Vista](retained-pdf.png). El segundo conserva el informe y retira solo DNI/matrícula e imagen de firma. Revisados texto y render MuPDF; el Poppler del entorno sustituye Base14, por eso los PNG finales usan MuPDF.

## Inventario de acciones

- Conservadas: revisión de selección completa, bultos por pedido, aviso/confirmación de pertenencia, reintento idempotente, cancelar/cerrar, descarga y reimpresión del snapshot, búsqueda y filtro por transportista, consulta desde pedido.
- Decisión del propietario: con varios transportistas, la creación devuelve varios informes con acceso/PDF propios; no descarga únicamente el primero. Con uno se mantiene descarga automática y queda acceso a firma/correo.
- Añadidas: firma en app, Borrar, fecha/hora es-ES Madrid, firma definitiva, anular con motivo y nueva creación, correo con CC opcional y registro, filtros de estado. No hay edición de firmas.
- “Sin informe” y “En informe” pasan a “Sin informe activo” y “En informe activo”; los anulados siguen visibles y no bloquean otro informe. Históricos mixtos conservan número y partes.
- Retención: 365 días configurables en private.pickup_document_config; se fija vencimiento al firmar. Purga desactivada y sin cron. Antes de activarla se necesita recuento y autorización; este cambio no la activa.

80 capturas de aplicación (62 del flujo + 18 de Pedidos), tres anchos y dos temas; dos PDF y sus renders. Hashes y pruebas táctiles en manifest.json / orders manifests.
