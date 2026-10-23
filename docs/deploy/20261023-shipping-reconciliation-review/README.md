# Reconciliación de creaciones · revisión antes de publicar

Estado: NO PUBLICADO, sin migración instalada ni worker/cron activados. Base de producto: #297, main ca8a595c6558356e766168fd51dd0ef78ef3ae66, comprobada por el propietario. Capturas previas desde el código local equivalente de Pedidos c12d090; solo difieren infraestructura/documentación ajenas. Componentes reales OrderDrawer, ShipmentCreationRecovery y @zenvia/ui; servicios y datos sintéticos, red bloqueada (bandera local), sin crear/firmar/enviar documentos, facturas o expediciones reales.

Ejecutar: `node scripts/shipping-reconciliation-review.mjs`. Manifiesto con hash de fuente y acciones por captura. 36 imágenes:390/1440, claro/oscuro. Acción de recuperación al principio del detalle, antes de Entrega; sin overflow horizontal. Inventario anterior conservado para pedido normal y etiquetado; se retiran explícitamente Preparar etiqueta/Registrar envío externo mientras exista creación pendiente. Durante la comprobación el botón se bloquea; esta acción consulta y nunca crea otra expedición.

| Caso | Móvil claro | Escritorio claro |
|---|---|---|
| Antes, intento MRW pendiente | [390](before-pending-mrw-light-390.png) | [1440](before-pending-mrw-light-1440.png) |
| Comprobar con MRW | [390](after-pending-mrw-light-390.png) | [1440](after-pending-mrw-light-1440.png) |
| Respuesta aún pendiente | [390](after-pending-light-390.png) | [1440](after-pending-light-1440.png) |
| Error sin liberar | [390](after-error-light-390.png) | [1440](after-error-light-1440.png) |
| Expedición recuperada | [390](after-recovered-light-390.png) | [1440](after-recovered-light-1440.png) |
| Acciones de etiqueta recuperada | [390](after-recovered-actions-light-390.png) | [1440](after-recovered-actions-light-1440.png) |
| Ausencia confirmada | [390](after-released-light-390.png) | [1440](after-released-light-1440.png) |
| Sendcloud | [390](after-sendcloud-light-390.png) | [1440](after-sendcloud-light-1440.png) |
| Envia | [390](after-envia-light-390.png) | [1440](after-envia-light-1440.png) |

Las respuestas de los proveedores se verifican por separado en tests/shipping-reference-lookup.test.ts, autorización en handlers reales y PostgreSQL con fixture desechable. Recuperar una identidad no confirma el marketplace ni acredita por sí solo salida física: respeta Etiquetados de #297; el seguimiento normalizado posterior aporta la evidencia de posesión cuando existe. Ausencia solo libera intentos durables con antigüedad>=10min; legacy sin hora original permanece protegido. HTTP200 con error, paginación incompleta, varias coincidencias, cuenta/entorno cambiado, XML incompleto o identidad cancelada conservan el bloqueo.

Fuentes consultadas: [Sendcloud Retrieve shipments](https://sendcloud.dev/api/v3/shipments/retrieve-shipments) (filtro exacto, Link/cursor), [Envia mensual](https://docs.envia.com/reference/shipments-by-month-year) y [detalle](https://docs.envia.com/reference/shipment-by-tracking). Envia sin referencia o fecha verificable falla cerrado; no se presupone correlación por proximidad. Contrato MRW existente: TrackingService GetEnvios tipoFiltro1, referencia exacta y fechas Madrid.

Scripts de programación/activación en docs/deploy/20261023-shipping-reconciliation-{schedule,activate}.sql; requieren recuento y revisión antes de ejecutar. Rollback supabase/rollback/20261023_shipping_creation_reconciliation.sql; no borra operaciones y rechaza degradar handlers con operaciones pendientes.
