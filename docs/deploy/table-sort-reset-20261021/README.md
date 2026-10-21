# Hotfix: ordenación reversible — 21/10/2026

Cambio aislado posterior al hotfix de facturación #270. Base de producción: main `946d932b7e0f705953f7ea228b7ff374f7cb876a`, despliegue `dpl_22J1RTb1BF39etPX5Kcmkf5MtPQo`, bundle `index-DMsvERAZ.js`. @zenvia/ui continúa pausado.

## Comportamiento

Ascendente → descendente → orden predeterminado de cada lista. Flecha y aria-sort muestran el orden real. Botón «Restablecer orden» cuando difiere del predeterminado, accesible también en móvil. Se elimina la preferencia de localStorage; al cambiar el orden se vuelve a la primera página sin vaciar la selección por ID.

| Consumidor auditado | Orden predeterminado | Alcance existente |
| --- | --- | --- |
| Pedidos | Fecha de pedido descendente | Servidor |
| Facturación | Fecha de emisión descendente | Fuente existente |
| Gastos | Fecha descendente | Fuente existente |
| Recibos | Fecha descendente | Fuente existente |
| Productos | Producto ascendente | Cliente |
| Clientes | Cliente ascendente | Cliente |
| Proveedores | Proveedor ascendente | Cliente |
| Detalle de factura | Descripción ascendente | Líneas de la factura |
| Amazon: productos | Beneficio antes de publicidad descendente | Servidor |
| Amazon: marketplaces | Ventas descendentes | Resultado completo local |
| Amazon: pedidos | Fecha descendente | Página devuelta por servidor |
| Amazon: inventario | SKU ascendente | Página devuelta por servidor |
| Amazon: sin vincular | Pedidos descendentes | Página devuelta por servidor |
| Shopify: productos | Nombre ascendente | Servidor |

Soporte usa una lista sin cabeceras ordenables: no se añade una acción artificial. Platform adoptará el contrato en su migración al paquete compartido; esta PR no modifica Platform.

**Limitación previa conservada:** tres tablas históricas de Amazon (pedidos, inventario, sin vincular) ordenan la página recibida; sus RPC actuales no aceptan parámetros de orden. Aquí se recupera su orden original y página 1; no se declara ordenación global nueva ni se alteran firmas RPC protegidas por MFA. Amazon productos, Shopify productos y Pedidos sí envían el orden efectivo a sus servicios de paginación.

## Evidencia

- React: ciclo completo, preferencias inválidas/anteriores, aislamiento por lista, reset/remontaje y parámetros reales de servicios Amazon/Shopify.
- Tres pruebas de respuestas tardías: fallo demostrado antes de añadir guardas de revisión; tras la corrección no sobrescriben datos, caché, error ni loading de la petición vigente.
- Auditoría ligera de los 14 consumidores ordenables: falla ante un conmutador independiente o ausencia de acceso a restablecer.
- Navegador local sin red, componentes reales y fixtures sintéticos, locale es-ES. Selecciona DEMO-001 y DEMO-026 en dos páginas; el diálogo real recupera ambos IDs tras asc/desc/predeterminado y restablecimiento explícito. Pruebas JSON adjuntas. El adaptador de fixture registra los parámetros; no simula una validación de producción.
- Capturas a 390/1280/1440. Las capturas sort-active muestran el control; sort-reset el orden recuperado. El viewport móvil se espera estabilizado tras cerrar navegación y se exige que el botón esté dentro de pantalla.
- Sin escrituras de negocio, migraciones, cambios de Auth/Edge ni emisión de documentos.

## Revisión y desviaciones

Revisión independiente: corregida carrera de respuestas en tres tablas Amazon; segunda revisión sin bloqueantes. Se corrigió el harness para usar un origen sintético offline con localStorage real y esperar el cambio de viewport; no cambios de producto por esas incidencias del harness.

## Rollback preparado antes de publicar

Revertir exclusivamente esta PR o promover el despliegue anterior `dpl_22J1RTb1BF39etPX5Kcmkf5MtPQo` (main `946d932b7e0f705953f7ea228b7ff374f7cb876a`). Mantiene el hotfix de facturación #270. Sin rollback SQL ni alteración de datos. Las preferencias de orden usan la clave anterior; volver al bundle anterior es compatible.

Publicación autorizada por el propietario, condicionada a CI completa verde. Resultado de producción se registrará en rama de auditoría sin generar otro despliegue por documentación.

Validación local final: **271/271** pruebas React (52 ficheros), **1240/1240** pruebas Node/SQL y build de producción correcto. Revisión independiente sin bloqueantes después de las tres pruebas diferidas. El harness de navegador completo terminó correctamente.

### Capturas y comprobaciones

| Estado | 390 px | 1280 px | 1440 px |
| --- | --- | --- | --- |
| Antes | [Pedidos](before-orders-390.png) | [Pedidos](before-orders-1280.png) | [Pedidos](before-orders-1440.png) |
| Después, sin orden personalizado | [Pedidos](after-orders-390.png) | [Pedidos](after-orders-1280.png) | [Pedidos](after-orders-1440.png) |
| Orden activo y restablecer | [Móvil](sort-active-mobile-from-1280.png) | [Escritorio](sort-active-1280.png) | [Escritorio](sort-active-1440.png) |
| Orden recuperado, selección conservada | — | [Escritorio](sort-reset-1280.png) | [Escritorio](sort-reset-1440.png) |

[Prueba 1280](sort-reset-proof-1280.json) · [Prueba 1440](sort-reset-proof-1440.json). Capturas con datos sintéticos, sin compradores reales.

CI detectó una suposición antigua del harness de maestros: tras dos clics esperaba volver al ascendente y encontrar el primer registro en página 1. Ahora dos clics resuelven descendente y ese registro está en otra página. El harness sigue verificando la selección conservada, pulsa el restablecimiento real y después comprueba la misma selección al cambiar a móvil. No se debilita la comprobación ni se cambia el producto para satisfacer la prueba.
