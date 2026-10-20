# Hotfix: acceso a Tarifas de transporte desde Pedidos

## Alcance y diagnóstico

Publicación aislada autorizada por el propietario tras CI verde. Base `f287ff5ee90f22d3d8899bdc40b6a990e5141dd3`, producción `dpl_BmTNRNtFRo6Q6fMyhcHYTkUNusge`, bundle `index-DURYFMtN.js`. No incluir fase2 ni fusionar su PR263.

El botón no estaba escrito dentro de Orders: `OrderLabelDefaults` lo añadía con un efecto global buscando `.ordersPage .pageHead .actions`. PageHeader cambió esa fila por `.dsPageHeaderActions`; el efecto dejó de encontrar el destino y ocultó el acceso. El gestor TransportTariffsPanel seguía montado y sin cambios. El harness anterior tampoco montaba OrderLabelDefaults: por ello su comparación incompleta no veía la acción inyectada.

Se corrige únicamente el selector de destino, primero la fila nueva y después la antigua. Se conservan el botón original, handler, prevención de duplicados, cierre y todo el gestor de importación/revisión/edición/activación de tarifas. No cambios SQL, Edge, Auth, tarifas ni archivos del propietario.

## Auditoría de acciones anteriores

Fuente inmediatamente anterior a fase1: `f214974c2ef044fef8c84fd64d114406869dc3e1`. El análisis de AST compara todos los elementos JSX button/a y elementos con onClick/href, incluidos handlers y disabled: Resumen 3→3; Pedidos 55→55; ninguna firma eliminada ni añadida. Es auditoría estática, no una afirmación de haber ejecutado todos los estados de modales. Detalle en `header-actions-review-20261020/source-audit.json`.

La comparación renderizada usa la revisión de las capturas before de fase1 (`58687e42`), ahora incluyendo el enhancer real de esa revisión. Capturas a390/1280/1440 en `header-actions-review-20261020/`.

| Pantalla | Acción anterior | Estado tras hotfix |
|---|---|---|
| Resumen, cabecera | + Factura de gasto | Conservada |
| Resumen, KPI | Pendientes → Pedidos | Conservada |
| Resumen, control de costes | Ver productos, condicional | Firma conservada en fuente |
| Pedidos | Tarifas de transporte | Restaurada, abre el mismo gestor |
| Pedidos | Informes de recogida | Conservada |
| Pedidos | Impresión directa | Conservada |
| Pedidos | Formato de etiqueta | Conservado |
| Pedidos | Nuevo pedido | Conservada |
| Pedidos | Generar etiquetas seleccionadas/pendientes | Conservada, mismo alcance y condiciones |
| Pedidos | Actualizar pedidos | Conservada |

No se ha encontrado otra acción eliminada por la migración. Los botones/enlaces restantes de Pedidos conservan sus handlers, href y disabled en la auditoría de fuente.

## Pruebas

- Vitest reprodujo el fallo antes: no encontraba Abrir tarifas de transporte con PageHeader real. Después abre y cierra TransportTariffsPanel real, conserva el control de archivo, una única entrada y el alcance exclusivo de Pedidos. Solo la lectura de tarifas se simula en este test.
- `assertHeaderActionsPreserved` compara las acciones renderizadas con el inventario anterior y falla nombrando la acción perdida; tests incluyen la desaparición de Tarifas y multiplicidad. Se usa en el harness de fase1 y se incorporará al de fase2 antes de su revisión final.
- Harness de fase1 monta el OrderLabelDefaults histórico/actual correspondiente, incluye estilos del panel, compara botones y enlaces de cabecera (también el botón suelto anterior de Resumen), y abre/cierra el gestor a390/1280/1440 con red bloqueada. Capturas de datos sintéticos; no se sube, edita, activa ni elimina ninguna tarifa.
- Suite local: 235 Vitest en43 ficheros;1223 tests Node; build correcto. Capturas y guard de contrato sin errores. Revisión independiente sin Critical/Important.

## Rollback preparado

Restaurar Gestión a `dpl_BmTNRNtFRo6Q6fMyhcHYTkUNusge`, commit `f287ff5ee90f22d3d8899bdc40b6a990e5141dd3`, bundle `index-DURYFMtN.js`. Conserva Shopify, fase1 y hotfix de aviso/previews. Alternativa: revertir exclusivamente el merge de este hotfix. No hay migraciones ni rollback de datos. La vuelta por rollback de Vercel requiere restaurar después la asignación automática mediante promoción de la versión autorizada.

## Estado

Pendiente de CI remoto, merge autorizado y verificación del botón y apertura del gestor real en producción. El recibo posterior se guardará separado para evitar otro despliegue de producción por documentación. PR263 permanece borrador y sin publicar.
