# Recibo de publicación: hotfix Tarifas #264

- PR264 fusionada tras seis checks success en head `9e91190b9717bdbf1565155d303515b58dc24c4d`: dos builds, auth-tests, screenshots, real-auth-vault y Vercel Preview Comments; estado Vercel success antes de merge.
- Main `cfa6d3da52409d98216d696285e5f7862edb8939`.
- Deployment de Gestión `dpl_5KjeeSo3VSXSqNJjCPaNV4oNCRFP` READY; proyecto `prj_L6nGgpq78QTEnZByUNtjtmF5rGkv`; alias gestion.zenviacommerce.com confirmado. Bundle observado tras recarga `index-1XUnT9OV.js`.
- El navegador mostró las siete acciones: Abrir tarifas de transporte, Informes de recogida, Impresión directa, Formato rápido de etiqueta, Nuevo pedido, Generar etiquetas pendientes y Actualizar pedidos. El contador se consulta con los datos reales y no se usa como una constante de diseño.
- Se pulsó Tarifas y abrió el gestor original. Lectura terminó sin spinner, una versión persistida cargada y cero errores del panel. Controles de proveedor, subida y actualización presentes. Se cerró y el acceso siguió visible. No se subió, editó, activó ni eliminó ninguna tarifa; no se afirma una prueba de escritura en producción.
- Cero errores de consola posteriores a la recarga durante la comprobación.
- Captura de producción limitada a cabecera/acciones del gestor, sin datos de clientes ni importes de tarifas: `header-actions-review-20261020/production-tariffs-panel.png`.
- Revisión independiente: sin Critical/Important; la mejora menor del inventario del botón suelto de Resumen se corrigió antes del commit final. Manifiestos: Resumen1 y Pedidos7 acciones de cabecera antes/después a390/1280/1440. Auditoría estática de todos los botones/enlaces/handlers:3→3 y55→55, ninguna otra firma perdida.
- Rollback del hotfix: `dpl_BmTNRNtFRo6Q6fMyhcHYTkUNusge`, main `f287ff5ee90f22d3d8899bdc40b6a990e5141dd3`, bundle `index-DURYFMtN.js`; comprobado READY antes de publicar. Conserva Shopify, fase1 y aviso/previews del hotfix262. No rollback de datos.

## Fase 2, separada y sin publicar

PR263 sigue borrador y sin merge. Se incorpora main publicado como padre y el guard compartido a su harness. Head final de revisión `cc5562aee5bd3cc870e7f696ad74a75d05ab35a4`, CI remoto de ese head pendiente en el momento de este recibo. Tests locales integrados238/44 ficheros, scripts1222 y build correctos; nueve capturas sin fallos. El despliegue READY anterior del hotfix264 es la base y rollback de una eventual fase2. El resultado remoto final se registra en el recibo de revisión de fase2 y en la propia PR.

Este recibo posterior se conserva en rama solo docs; no se fusiona main ni se provoca otro despliegue de producción por documentación.
