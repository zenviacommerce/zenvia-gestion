# Capturas de layout — 20 de octubre de 2026

**Estado actual; no son diseños propuestos.** Producción autenticada, tema claro, `index-Duin0MgL.js`. 61 capturas: 42 de pantallas/estados a tres anchos, 16 de ocho modales a dos anchos y 3 detalles móviles. No se enviaron formularios ni se crearon documentos, usuarios, pedidos o etiquetas.

Viewports solicitados: 390/1280/1440 × 1000 px. Las capturas devueltas por el navegador pueden excluir parte del área de barras: las dimensiones reales de cada PNG están en [artifacts.json](artifacts.json), y las medidas de layout en [measurements.json](measurements.json). No son recreaciones ni imágenes generadas.

[Documento de propuesta](../design-system.md).

## Pantallas

| Pantalla | Móvil 390 | Escritorio 1280 | Escritorio 1440 |
|---|---|---|---|
| Resumen | [Ver](resumen-390.png) | [Ver](resumen-1280.png) | [Ver](resumen-1440.png) |
| Pedidos | [Ver](pedidos-390.png) | [Ver](pedidos-1280.png) | [Ver](pedidos-1440.png) |
| Facturación | [Ver](facturacion-390.png) | [Ver](facturacion-1280.png) | [Ver](facturacion-1440.png) |
| Recibos | [Ver](recibos-390.png) | [Ver](recibos-1280.png) | [Ver](recibos-1440.png) |
| Gastos | [Ver](gastos-390.png) | [Ver](gastos-1280.png) | [Ver](gastos-1440.png) |
| Productos | [Ver](productos-390.png) | [Ver](productos-1280.png) | [Ver](productos-1440.png) |
| Clientes | [Ver](clientes-390.png) | [Ver](clientes-1280.png) | [Ver](clientes-1440.png) |
| Proveedores | [Ver](proveedores-390.png) | [Ver](proveedores-1280.png) | [Ver](proveedores-1440.png) |
| Amazon | [Ver](amazon-390.png) | [Ver](amazon-1280.png) | [Ver](amazon-1440.png) |
| Shopify | [Ver](shopify-390.png) | [Ver](shopify-1280.png) | [Ver](shopify-1440.png) |
| Shopify: productos sin resultados | [Ver](shopify-vacio-390.png) | [Ver](shopify-vacio-1280.png) | [Ver](shopify-vacio-1440.png) |
| Soporte | [Ver](soporte-390.png) | [Ver](soporte-1280.png) | [Ver](soporte-1440.png) |
| Configuración: General | [Ver](configuracion-390.png) | [Ver](configuracion-1280.png) | [Ver](configuracion-1440.png) |
| Administración: Usuarios | [Ver](administracion-390.png) | [Ver](administracion-1280.png) | [Ver](administracion-1440.png) |

## Modales

Se abrieron y cancelaron sin guardar. En Administración no se envió ninguna invitación.

| Modal | Móvil 390 | Escritorio 1440 |
|---|---|---|
| Producto | [Ver](modal-producto-390.png) | [Ver](modal-producto-1440.png) |
| Cliente | [Ver](modal-cliente-390.png) | [Ver](modal-cliente-1440.png) |
| Proveedor | [Ver](modal-proveedor-390.png) | [Ver](modal-proveedor-1440.png) |
| Factura | [Ver](modal-factura-390.png) | [Ver](modal-factura-1440.png) |
| Recibo | [Ver](modal-recibo-390.png) | [Ver](modal-recibo-1440.png) |
| Pedido manual | [Ver](modal-pedido-390.png) | [Ver](modal-pedido-1440.png) |
| Ticket de soporte | [Ver](modal-soporte-390.png) | [Ver](modal-soporte-1440.png) |
| Usuario/permisos | [Ver](modal-administracion-390.png) | [Ver](modal-administracion-1440.png) |

## Detalles móviles

- [Pedidos: KPI de una columna](pedidos-detalle-390-kpis.png).
- [Pedidos: lista y selección](pedidos-detalle-390-lista.png).
- [Gastos: las dos columnas desbordan el contenedor](gastos-390-kpis.png).

## Límites de la muestra

- Fotografías de un estado real del día: las cifras no se usan aquí para conciliar KPI.
- Configuración se documenta visualmente en General; Administración en Usuarios. Las variantes de sus demás secciones se han revisado en el código. No se abrieron credenciales, recuperación MFA ni acciones de mantenimiento.
- Vacío real: Shopify sin productos para Hoy y Soporte sin tickets. Los errores y estados incompletos se revisan en código; no se provocaron fallos en producción para capturarlos.
- Tema oscuro, zoom de texto y teclado móvil serán controles obligatorios al implementar cada fase; no se presentan como ya comprobados visualmente en esta auditoría.
