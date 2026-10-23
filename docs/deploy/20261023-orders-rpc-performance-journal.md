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

## Rollback y límites

[Rollback exacto](../../supabase/rollback/20261023_orders_cached_logistics_read.sql): restaura las dos definiciones privadas anteriores dentro de transacción con lock_timeout=3s; no borra hechos ni cambia datos/MFA. Los nuevos helpers privados pueden quedarse revocados e inactivos. Las definiciones previas y guardias se conservan en supabase/snapshots/20261023-orders-rpc-before/. Antes de aplicar: comparar hashes/firmas, conteos y cola, confirmar que no se ha desplegado otra versión, capturar advisors y ejecutar comparación de respuesta por owner. Sin cambio UI no se fabrican capturas; #298 conserva su aprobación visual pendiente.

Un intento de generar fichero con la CLI fue rechazado automáticamente por telemetría externa no autorizada. No se repitió ni se eludió; edición local y conector Supabase se usaron como alternativa. Ningún certificado, contraseña o valor de secreto aparece en estas evidencias.
