# Pedidos: evidencia y candidato de rendimiento — 23/10/2026

Estado: **WIP, no aplicado; objetivo <100 ms sin cerrar**. Estimación inicial del paso: 3–6 h. No se ha cambiado una función persistente ni la configuración de producción durante este paso. La publicación #297 sigue activa.

## Evidencia

Medición real de las dos RPC públicas, con validación de contexto MFA existente y sin modificar sesiones/factores/cohorte: 10 llamadas, cinco estados, cache usable=true, aproximadamente 2.475–2.740 ms. Las versiones posteriores a #297 recalculan la clasificación y dos veces la evidencia para cada una de las 1.008 filas, pese a la proyección vigente. Estadísticas históricas acumuladas no son el tiempo actual de la RPC.

Antes: [muestras](20261023-orders-rpc-before-benchmark.json). Candidato: [30 muestras](20261023-orders-rpc-candidate-benchmark.json), funciones temporales de sesión que reproducen el cuerpo propuesto sin reemplazar endpoints. No confundir este perfil con una mejora publicada. Hay muestras por debajo de 100 ms pero también >150 ms. El objetivo exige cerrar las restantes, medir las RPC públicas tras un corte reversible y validar p50/p95, filtros y carga representativa; ninguna muestra aislada acredita el objetivo.

## Cambios del candidato

Se reutilizan estado y fecha de la proyección. Los grupos sucios se reconstruyen con todos sus hermanos canónicos, y solo ellos; no se invalida todo el workspace por un grupo pendiente. Se comparan versiones de origen y tracking, claves antiguas/nuevas, presencia, generación y evidencias físicas/históricas. Cambios de propietario, borrado, PII, etiquetas y hechos de salida deben coincidir exactamente con fallback. Se conserva el interruptor para fallback completo, wrappers/OIDs/ACL, permisos y puertas MFA.

La revisión independiente encontró una carrera relevante: un ID de invalidación reservado, no visible al refresh, puede confirmar antes del DELETE id<=last_id del worker anterior. Sin defensa adicional un hecho de salida podía dejar contadores obsoletos. Dos pruebas rojas reproducen pérdida de invalidación de evidencia e histórico sin cambiar pedido/tracking. Se añadió una comparación por conjuntos de identidad, estado y fecha de esos hechos, independiente de la cola. Ambas pasan. No se ha cambiado el worker de producción.

La página devuelve evidencia con un JSON mínimo de identidad y el estado ya validado; evita serializar cuatro veces el payload completo por fila. El guard de evidencia usa columnas estrechas, no materializa payloads operativos para comparar hechos. Pruebas de paridad incluyen respuesta JSON completa, filtros, selección, fecha, workspace/MFA, PII y rollback.

Verificación final del candidato: **15/15 pruebas focales, 751/751 Vitest en 128 archivos**. La suite final completa duró 111,68 s. Se ensayó el SQL de rollback en la fixture. Revisión previa sin otros bloqueos comunicados; las mejoras de lectura posteriores están cubiertas por estas pruebas. La CI remota debe confirmar la rama exacta antes de considerar despliegue.

## Otros consumidores solicitados

- El bloque DO $metrics$ (294 llamadas, media histórica 903,06 ms) pertenecía a la medición temporal de 24 h: su SQL se auto-desprograma al 23/10/2026 09:45 UTC. La lista actual de cron no contiene orders-projection-resources-24h. No hay que reducir ahora la frecuencia de un job ya terminado, ni resetear estadísticas para ocultar ese coste histórico.
- El lookup ASIN real no filtra por marketplace: filtra owner+amazon_account_id, asin/seller_sku no nulos, orden created_at DESC,id DESC y paginación. Hay 23.857 filas; el índice actual owner+marketplace+asin no sirve ese orden. Preparar un índice parcial owner+cuenta+created_at DESC,id DESC INCLUDE(asin,seller_sku), con EXPLAIN antes/después y sin activar migraciones no verificadas.
- Cleanup conserva comprobaciones por grupo/origen/PII y cuesta ~60 ms históricos. Su función exacta se ha capturado. Reescribir por conjuntos solo con paridad y pérdida de avisos cubierta; no eliminar su protección de privacidad para conseguir una cifra.

## Experimentos descartados y continuación concreta

Solo temporales de sesión: variantes de JSON, estrechar payloads y precomputar fragmentos/identidad/tarifas en copia temporal. No dieron una mejora consistente suficiente y **no están en el producto**. No se añadieron columnas, índices o tablas persistentes para estas pruebas, no se recalcularon pedidos ni se enviaron datos a transportistas. Se guardaron solo tiempos, totales y hashes, sin direcciones ni payloads.

Siguiente corte de rendimiento: reducir la copia/serialización del scope y del JSON de tarifas/página con contrato idéntico, revisar el plan con casos comunes y grupos sucios, cerrar <100 ms de forma consistente y después hacer preflight/rollback/CI y medición real del endpoint. Este paso queda explícitamente abierto; la entrega del diseño fiscal no lo convierte en completado.

## Medición de la implementación y revisión adicional

A las 16:04:36 UTC se ensayó la implementación local en una transacción REPEATABLE READ con auxiliares temporales y ROLLBACK; no se reemplazaron endpoints. Contexto MFA existente validado, 1.008 fragmentos, cero grupos sucios. Workbench actual: 2.875,125 ms para all. Candidato: 30 muestras, p50 78,215 ms, p95 97,084 ms; primera consulta 120,027 ms. Hash JSON completo de all idéntico dentro de la misma transacción. [Recibo](20261023-orders-rpc-implemented-workbench-benchmark.json). No acredita aún el objetivo completo: faltan pickup, grupos sucios y filtros/paginación; la consulta fría supera 100 ms. Un ensayo previo con seis llamadas al endpoint antiguo alcanzó statement_timeout de 25 s y se revirtió; se limitó la comparación real a una llamada all por ensayo.

La revisión independiente encontró una diferencia de contrato cuando la zona horaria del escritor del fragmento difiere de la del lector. Una prueba nueva la reproduce en rojo (UTC frente a Europe/Madrid, fechas y MD5 de identidad). La implementación incorpora serialization_timezone en las dos comprobaciones de validez; si difiere, calcula el JSON y la identidad vivos. Las 20/20 pruebas focales pasan después del ajuste, incluido el rollback que deshabilita el writer auxiliar. Sin cambios persistentes en producción.

Pickup a las 16:09:50 UTC: endpoint actual all 3.081,835 ms; candidata 30 muestras, p50 72,594 ms, p95 94,474 ms y primera consulta 109,970 ms. Cero grupos pendientes; 1.008 fragmentos. Hash completo de all coincide. [Recibo](20261023-orders-rpc-implemented-pickup-benchmark.json).

Ensayo adicional 16:10:45–16:10:54 UTC con copia temporal de la cola y 0/1/3 grupos forzados a fallback de hermanos completos. Ningún grupo ni pedido persistente se alteró. Todos los hashes de all coincidieron con su endpoint actual en la misma transacción. [Recibo](20261023-orders-rpc-dirty-session-benchmark.json). Hay muestras entre 163 y 472 ms, incluso >100 ms con cero grupos forzados; los endpoints actuales también subieron a 5,8 s. Esto no permite atribuir el aumento exclusivamente a los grupos pendientes ni afirmar que el objetivo esté cerrado. Falta perfilar esta variación y validar filtros/paginación con carga representativa. Se mantiene WIP sin aplicar.

## Verificación del checkpoint retomado

756/756 pruebas Vitest en 128 archivos; 20/20 focales; build correcto; contratos compartidos de inventario de acciones, buscadores/filtros y Tabs: 8/8. El barrido Node registró 1.292 pruebas correctas y un fallo de precondición de scripts/mfa-real-integration.test.mjs, que exige RUN_LOCAL_AUTH_VAULT_TESTS=1 y GoTrue/Vault de Docker local; no llegó a crear clientes ni usuarios. Ese caso pertenece al workflow aislado de CI, no se habilitó contra producción. No confundir esta comprobación local con CI remota ya confirmada del nuevo head. La #301 publicada sí conserva su CI 6/6 y el registro original permanece failed/EDGE_CPU_LIMIT, nunca sending. La candidata #299 continúa draft, sin migración aplicada y sin objetivo <100 ms cerrado.

## Rollback y límites

[Rollback exacto](../../supabase/rollback/20261023_orders_cached_logistics_read.sql): restaura las dos definiciones privadas anteriores dentro de transacción con lock_timeout=3s; no borra hechos ni cambia datos/MFA. Los nuevos helpers privados pueden quedarse revocados e inactivos. Las definiciones previas y guardias se conservan en supabase/snapshots/20261023-orders-rpc-before/. Antes de aplicar: comparar hashes/firmas, conteos y cola, confirmar que no se ha desplegado otra versión, capturar advisors y ejecutar comparación de respuesta por owner. Sin cambio UI no se fabrican capturas; #298 conserva su aprobación visual pendiente.

Un intento de generar fichero con la CLI fue rechazado automáticamente por telemetría externa no autorizada. No se repitió ni se eludió; edición local y conector Supabase se usaron como alternativa. Ningún certificado, contraseña o valor de secreto aparece en estas evidencias.

## Retomado después del hotfix #301 (15:20–15:32 UTC)

Hotfix de correo publicado en main5db28e2; no modifica las dos RPC de Pedidos. Sus hashes continúan de9f2c2f531ac1d6ead3323792b54f3b / ada5a85ba7cc2ed7e78fc0e27fe09f00. Recuento a15:20:53UTC: 1025 pedidos físicos,1010 filas de proyección y3 grupos pendientes. Sin reconstrucción ni backfill.

Nuevos experimentos de sesión, secuenciales y con rollback, sin alterar endpoints ni datos de negocio. [Muestras y hashes](20261023-orders-rpc-resumed-experiments.json). SQL frente a PL/pgSQL no mejora lo suficiente; quitar claves JSON de una vez ahorra parte del coste. Estrechar CTE añade trabajo y NOT MATERIALIZED repite lecturas (hasta457ms), descartado. json_agg no mejora consistentemente.

EXPLAIN real: sin lecturas físicas ni spill temporal; helper de grupos desactualizados20–34ms, serialización de página~24ms y aggregate de candidatos de tarifa~35ms. Las materializaciones muestran tiempos inclusivos y no se suman como tiempos independientes. Planificación de la consulta desplegada fuera de función33ms en la muestra: no confundir con latencia exclusiva de cada función.

Precálculo temporal de JSON de página y tarifas, excluyendo grupos desactualizados, conserva hashes completos para pending/shipped/all (1/938/1008). Rango76–126ms, media104ms en15 muestras. Todavía no acredita <100ms. No se han creado columnas, índices o cachés persistentes. El primer intento abortó al detectar un grupo pendiente (PERF_STALE); la variante siguiente excluye sus fragmentos y usa cálculo normal, manteniendo paridad. Continúa el análisis antes de proponer una migración.

## Implementación local del siguiente candidato

19/19 pruebas focales correctas. La prueba nueva antes del cambio registraba3 llamadas de reconstrucción JSON de evidencia para3 filas y fallaba al exigir0; ahora usa JOIN por lotes y pasa con idéntico JSON. Tabla auxiliar privada por owner+grupo, con FK a la proyección y token xmin+ctid/formato; un AFTER refresh la actualiza en la misma transacción. No se cachean las anotaciones de recogida ni la evidencia logística. Se mantienen todas las comparaciones independientes de fuente/tracking/hechos; solo se reutiliza la identidad ya calculada cuando el token de proyección coincide. Falta medir esta implementación concreta y revisión independiente; no está publicada. El rollback conserva los fragmentos pero detiene su writer tras restaurar las dos RPC.
