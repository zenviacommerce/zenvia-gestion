# #299 — candidato posterior a la recuperación

23/10/2026. No aplicado en producción. Objetivo de aceptación: pickup, workbench y logistics por debajo de 300 ms con las llamadas reales concurrentes del navegador del propietario. Las mediciones aisladas no acreditan este objetivo.

## Recuperación confirmada por el propietario

Pendientes: pickup 748 ms, workbench 1.029 ms, logistics 427 ms (primera carga). Enviados: 667/790/491 ms. Contadores 2/0/943/9/64, sin errores. **Verificar SIEMPRE en el navegador real con las llamadas concurrentes; nunca dar por recuperado basándose solo en consultas separadas.**

## Candidato

- RPC con proyección híbrida: un grupo inválido no obliga a reconstruir todos los grupos durante cada lectura. Se conservan comprobaciones de owner, permisos, MFA, versiones e identidad logística.
- Fragmentos JSON derivados por versión de fila, con actualización por trigger, evitando serializar filas completas repetidamente. Evidencia logística solo para la página devuelta; fallback al dato actual si falta o está obsoleto el fragmento.
- Resumen obtiene seis contadores agregados mediante orders_operational_summary_v1; no descarga todos los pedidos ni sus metadatos logísticos. AlertCenter omite la lectura logística que descartaba después. La tabla Pedidos mantiene la lectura logística de los IDs visibles.
- Una invalidación durante una petición en curso encola una segunda lectura. El rollback SQL conserva la nueva API agregada, compatible con el frontend.

## SQL exacto y coste previsto

Aplicación: `supabase/migrations/20261023132255_orders_cached_logistics_read.sql`, dentro de una transacción. Rollback: `supabase/rollback/20261023_orders_cached_logistics_read.sql`.

El SQL crea una tabla privada derivada y rellena una fila por fila de proyección. Recuento previo real: **1.011 filas, 2 owners**. Tamaño agregado de tuplas origen: 1.857.391 bytes; representación JSON sin raw_payload: 4.014.027 bytes. Esto describe el volumen de entrada, no es una medición del tamaño final, WAL o duración del backfill. No modifica pedidos, facturas ni evidencia inmutable. El coste temporal del backfill en SMALL todavía no se ha medido; statement_timeout limita cada sentencia a 15 s y lock_timeout a 3 s. Si falla, abortar la transacción, no ampliar el límite a ciegas.

Repetir inmediatamente antes de aplicar:

```sql
SELECT count(*) AS projection_rows,
       count(DISTINCT owner_id) AS owners,
       coalesce(sum(pg_column_size(p)),0) AS tuple_bytes,
       coalesce(sum(pg_column_size(to_jsonb(p)-'raw_payload')),0) AS json_without_raw_bytes
FROM private.orders_dashboard_projection p;
```

El relleno inicial está explícitamente marcado en el DO payloads de la migración; el resto prepara funciones, tabla, índice, trigger y API. No ejecutarlo sin la aprobación de este SQL y su recuento, conforme a la regla del propietario sobre reprocesados masivos.

## Validación y corte

128 pruebas locales de Pedidos (22 suites) pasan; no representan la suite completa del repositorio. Build de producción, TypeScript y verificación del icono iOS pasan. Nuevas pruebas cubren instalación después del hotfix, clasificación física, aislamiento/MFA, invalidación concurrente y compatibilidad de la API tras rollback. Revisión independiente: dos hallazgos importantes corregidos y cubiertos con fallo previo y paso posterior.

Antes de publicar frontend: CI completa, capturas antes/después y aprobación. Antes y después del SQL: comparar JSON normalizado y contadores bajo authenticated/owner real. Después del corte: navegador real, las tres llamadas simultáneas, primera carga y repeticiones, Pendientes y Enviados, demás pestañas/filtros/selección. No declarar <300 ms hasta esa medición. Si hay regresión o timeout: rollback inmediato a las dos definiciones exactas del estado recuperado; se conserva la mitigación set-based de logistics.
