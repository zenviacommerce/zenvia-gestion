# Lote A — cierre de sombra, 21 octubre 2026

Estado comprobado a las 09:55–09:56 UTC (11:55–11:56 Europe/Madrid). Gestión sjkxxbedkkmgmqnvaqjh; Platform ucokhtztxozxcikrmidv. Sombra compartida activa. Lecturas de UI y camino dedicado desactivados. No se fusionan PR ni se despliega frontend.

## Comparación autoritativa frente a sombra

Consultas SQL con los mismos filtros de los handlers actuales; no es comprobación visual ni invocación autenticada del navegador.

| Dato | Actual | Sombra | Diferencia |
|---|---:|---:|---:|
| Workspaces | 2 | 2 | 0 |
| Suscripciones | 2 | 2 | 0 |
| Planes activos | 4 | 4 | 0 |
| Tickets abiertos | 0 | 0 | 0 |
| Tickets esperando respuesta | 0 | 0 | 0 |
| Lista completa de tickets | 0 | 0 | 0 |
| ZENVIA: usuarios activos / Amazon / pedidos mes | 5 / 1 / 165 | 5 / 1 / 165 | 0 |
| DEMO: usuarios activos / Amazon / pedidos mes | 1 / 0 / 0 | 1 / 0 / 0 | 0 |

Digest de tickets idéntico: d751713988987e9331980363e24189ce. Los contadores generales conservan su fuente central existente. No hay tickets reales actualmente: la igualdad de la lista vacía no demuestra por sí sola el comportamiento con carga. La prueba aislada con 500 workspaces y 5.000 tickets recorrió exactamente 5.000 tickets con páginas acotadas; no se crearon tickets sintéticos en producción. Los 165 pedidos son el valor autoritativo actual, frente a la lectura histórica de 164.

## Seguridad aplicada

Migración correctora aplicada antes de activar. Captura AFTER con subtransacción y EXCEPTION WHEN OTHERS: fallo recuperable revierte solo la captura y retorna NULL. Registro sanitizado de tabla, operación y SQLSTATE; el logger tiene su propio manejo de excepciones y fallback LOG sin SQLERRM, contexto ni valores de filas. Pruebas fuerzan fallo de captura y del logger y comprueban UPDATE y COMMIT de fulfillment_orders. No se promete supervivencia a una caída del servidor, fallo del almacenamiento del propio negocio o cancelación explícita.

Listas blancas explícitas por tabla; eliminada la conversión de filas de negocio completas. Pedidos solo owner_id y order_created_at; usuarios workspace_id y active; Amazon owner_id y status; tickets solo identificadores y metadatos de estado, prioridad, asignación y fechas. Sin compradores, dirección, email, teléfono, raw_payload, asunto ni cuerpo del ticket. El receptor rechaza claves extra y objetos/arrays anidados bajo campos escalares antes de guardar recibos. Las pruebas con sentinelas PII y claves extra pasan. Las antiguas conversiones completas eran variables locales, no payload persistido; antes de la corrección el outbox y los recibos estaban vacíos.

## Rendimiento

Medición PostgreSQL real con tabla TEMP representativa, función real y rollback completo; sin UPDATE de pedido real. 3.000 muestras sin cambio de métricas: media desactivado 258,39 µs; activo 371,78 µs: incremento medio **0,11339 ms** (mediana +0,08 ms). 500 escrituras que cambian métricas y encolan: mediana **4,98 ms**, media 5,49 ms, p95 10,23 ms. Son costes medidos, no garantía universal de ausencia de impacto. No se confunde duración del despacho cron con duración completa de un sync.

## Operación y observabilidad

39 ciclos completos HTTP 200 desde la corrección del cursor, 0 fallidos en esa ventana. Últimos ciclos 09:53:02.734721Z y 09:55:02.209814Z, cada uno completed=1/failed=0. Outbox: 58 entregados, 0 pendientes, 0 failed. Fallos de captura: 0. Campos fuera de allowlist: 0. Cobertura fresca 2/2; último reconcile con antigüedad 35,40 s al consultar; alerta inactiva. Última reparación completa 09:53:02.734722Z, cubre hasta su inicio 09:53:01.990892Z.

Cron cada minuto; reparación completa cada 10 minutos y solapamiento incremental 5 minutos. Observabilidad registra cola/retraso, failed, último reconcile, fallos de captura sin reparar y cobertura. Cota/alerta 900 segundos; concurrencia 3; dedicado desactivado. La cota corresponde al camino compartido actual, no garantiza 500 proyectos dedicados con esa concurrencia: 167 tandas de 45 s serían 125,25 minutos antes de costes adicionales. Ese camino permanece desactivado.

Snapshots y hashes confirman funciones MFA, triggers de negocio preexistentes y cron preexistente sin cambios en ambos proyectos. read_model_enabled=false; no cambios a platform-admin, platform-bridge ni frontend.

## CI, desviaciones y rollback

Gestión #269, commit 59196e6926036df03b62ae18ca8a17540c7c8324: CI completa verde, incluido Auth/Vault real y capturas. Platform #78, commit 865280071bafb829ffbd1ad4da420d98aaff813d: CI completa verde. Ambos PR abiertos, sin fusionar. Pruebas incluyen outbox transaccional, aislamiento, reintentos congelados, borrados, allowlist y cursor; Deno typecheck de las tres Edge correcto. Vitest 257 correctos tras repetir con 2 workers un timeout local previo.

Desviaciones resueltas: orden de versiones de migraciones corregido tras fallo de dependencia en CI disposable; un SOURCE_FAILED inicial se resolvió tras recargar schema (sin atribuir causalidad definitiva); evento de inspección reencolado y entregado. El primer incremental truncaba microsegundos de upper al pasar por Date: test reprodujo el fallo, se preservó el literal, CI verde y source Edge v2 desplegada. Los 39 ciclos reportados son posteriores a esta corrección.

Snapshots previos y posteriores, SQL aplicado y rollback-source.sql / rollback-central.sql quedan junto a este informe. Rollback preparado: desactivar únicamente configuración y cron propios de sombra, conservar evidencias/tablas y mantener UI actual; no reinstalar captura insegura. Rollback no ejecutado. La migración inicialmente denegada fue revisada y aprobada por el propietario: objetos nuevos aditivos y retención limitada a tablas nuevas.

**DETENCIÓN: comparación completada; no cambiar las lecturas de la UI sin revisión del propietario.**

