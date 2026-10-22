# Reetiquetar tras cancelar — revisión

Datos sintéticos; componentes reales. No se crea ningún envío comercial.

Caso reproducido: Amazon conserva Shipped; la expedición está CANCELLED; no queda etiqueta activa. Antes se bloqueaba como pedido cancelado. Después se muestra Etiqueta cancelada y Preparar nueva etiqueta, que abre el flujo existente de preparación.

| Ancho | Antes claro | Después claro | Antes oscuro | Después oscuro |
|---|---|---|---|---|
| 390 | [Ver](before-cancelled-label-light-390.png) | [Ver](after-cancelled-label-light-390.png) | [Ver](before-cancelled-label-dark-390.png) | [Ver](after-cancelled-label-dark-390.png) |
| 1280 | [Ver](before-cancelled-label-light-1280.png) | [Ver](after-cancelled-label-light-1280.png) | [Ver](before-cancelled-label-dark-1280.png) | [Ver](after-cancelled-label-dark-1280.png) |
| 1440 | [Ver](before-cancelled-label-light-1440.png) | [Ver](after-cancelled-label-light-1440.png) | [Ver](before-cancelled-label-dark-1440.png) | [Ver](after-cancelled-label-dark-1440.png) |

El inventario conserva todas las acciones y disabled de pedidos pendientes y etiquetados. En el caso cancelado se sustituye el bloqueo por Editar pedido y Preparar nueva etiqueta de forma explícita (backlog 2b); no se retira una acción previa. La prueba pulsa la nueva acción y verifica que llama a prepare una sola vez.

La interfaz y las Edge mantienen bloqueados pedidos cancelados, entregados o pendientes de pago, etiquetas activas, envíos externos y datos purgados.
