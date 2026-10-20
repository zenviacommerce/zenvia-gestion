# Hotfix fase 1: aviso de Pendientes y vistas previas completas

## Alcance y autorización

El propietario autoriza corrección y publicación tras CI verde. Rama `fix/design-phase1-semantics-previews-20261020`, base main `aa8677ddf09a4b64be74a80ff8df26fe762405bc`. Fase 2 permanece aislada, sin incluir sus cabeceras, filtros ni tabs. Sin cambios SQL, Edge, Auth, datos, importaciones ni cohort MFA.

## Diagnóstico con evidencia

- Antes de fase 1 Pedidos usaba `overduePending>0` en JSX, y `PendingOrdersKpiHighlight` corregía el aviso a `pending>0` buscando `.ordersStats .stat`. KpiGrid retiró `.ordersStats`: el efecto dejó de encontrar la tarjeta, quedando solo la condición de retraso. Resumen ya usaba `pendingOrders>0`.
- Comparación de las tarjetas de Resumen/Pedidos con `f214974`: Pendientes era la única variante semántica existente; no había variantes de éxito/error en las otras tarjetas. Se conservan cifras, descripciones y acciones.
- Configuración: caja de logo/sello de 180×80, `overflow:hidden`; el porcentaje `max-height:100%` del hijo en grid no impedía su desbordamiento. Prueba con sello sintético 600×900: caja de imagen 238×357 en móvil, fuera de su padre. Editor de logo tenía otra altura fija y max-height porcentual.

## Corrección

- `StatCard variant="warning"` reutiliza exactamente el aviso dorado de Resumen, incluido oscuro y reducción de movimiento. Ambas pantallas declaran `pending>0`, cero neutro. Se retira el montaje del observador DOM obsoleto; React conserva el estado semántico durante render/actualización.
- Logo/sello y editor de logo: alto automático, máximo de imagen 240 px, max-width 100 %, centrado y contain. Se aplica contain a los propietarios de miniaturas de productos/Pedidos y adjuntos; se conservan sus cajas compactas. Las imágenes decorativas no son vistas previas.
- Contrato actualizado en `docs/design-system.md`. Cierre de fase 1 anotado según comprobación del propietario (bundle `index-DqEFHKNh.js`).

## Pruebas y capturas

- Test de variante rojo antes (esperaba aviso, recibía neutro), verde después, incluyendo tarjeta accionable y retirada del aviso a cero. Suite completa: 42 ficheros, 233 tests verdes. Build local correcto (avisos habituales de tamaño de bundle).
- Harness de pantallas reales y cascada completa: pendientes positivos, retrasados cero; exige clase de aviso Y degradado calculado en Resumen y Pedidos a 390/1280/1440. Conserva comparación de cifras/controles, selección y acciones; oscuro móvil. Evidencia `hotfix-kpi-review-20261020/`.
- Harness de vistas previas: JSX extraído de los dos previews reales de Configuración, editor de logo y ProductIdentity; imágenes sintéticas, no datos del cliente. Prueba roja con CSS anterior por recorte del sello. Después: todos los previews dentro del contenedor, contain y proporción sin distorsión; 390/1280/1440. Las miniaturas cuadradas mantienen contain (su caja no tiene por qué tener la proporción original). Evidencia `hotfix-preview-review-20261020/`.
- CI añade esta comprobación de geometría al job de capturas; artefacto `image-preview-review`.
- Estas capturas son fixtures aisladas con red bloqueada; la validación del sello real corresponde a la comprobación del propietario en producción. No se ha cambiado ni reprocesado el archivo de sello.

## Rollback preparado antes de publicar

Restaurar producción de Gestión al deployment `dpl_FXFkLqauYMkr7aiJBiRRpP4HhXMA`, commit `aa8677ddf09a4b64be74a80ff8df26fe762405bc`, bundle `index-DqEFHKNh.js`. Conserva Shopify y fase 1. Alternativa: revertir exclusivamente el merge de este hotfix en main. No hay migraciones ni rollback de datos. Una reversión de Vercel suspende la asignación automática; restablecerla con promoción explícita de una versión válida antes de otra publicación.

## Publicación

Pendiente de CI remoto, merge autorizado y verificación de deployment. Registrar recibo posterior en rama solo docs para evitar otro despliegue por documentación.

## Ajuste de cobertura detectado por CI

El primer CI falló en `invoice-number-edit-pending-kpi.test.mjs`: exigía por texto montar el observador DOM, sin comprobar que su selector encontrara la tarjeta. Se sustituye esa aserción obsoleta por renderizado real de StatCard (aviso en tarjeta/botón y neutro predeterminado); el harness comprueba la condición de las dos pantallas. Capturas e imágenes del primer CI ya pasaron. Se ejecuta también la suite completa de scripts Node, además de Vitest. No se omite ni desactiva ningún check.
