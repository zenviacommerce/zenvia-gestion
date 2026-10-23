# Pedidos RPC: objetivo <100ms

Autorizado continuar por el propietario después de preparar reconciliación #298 (sin publicar UI). Estimación3–6h. Base producción #297, ca8a595c6558356e766168fd51dd0ef78ef3ae66; caché reconstruida y verificada. Sin mezclar handlers/UI de reconciliación en este cambio.

1. Snapshot de definiciones reales, stats acumuladas y medición de llamadas reales con permisos y MFA conservados; perfil por estado y caché/fallback. No resetear pg_stat_statements ni imprimir datos/credenciales/sesiones.
2. Optimizar el trabajo demostrado caro; pruebas de paridad JSON (periodos, filtros, selección, facetas, contadores, históricos y evidencias), owner/MFA/PII y cola incompleta. Umbral verificado con varias muestras, indicar límites de observación.
3. Revisar DO metrics, lookup ASIN y cleanup por separado con EXPLAIN y recuentos previos a reconstrucciones/migraciones. Una corrección por PR cuando sea independiente.
4. Preparar rollback exacto antes de cualquier cambio de producción, CI y revisión independiente; diario por paso. No publicar cambios visibles sin autorización.

Diagnóstico inicial13:15Z: pgstats desde22/10 09:19:20Z; workbench740 llamadas a788,87ms; pickup761 a585,78ms; metrics294×903,06ms; ASIN3920×47,95ms; cleanup1676×60,55ms.1025filas físicas,1grupo sucio en muestra. La rama publicada recalcula estado/evidencia por cada fila aun cuando la proyección es usable: hipótesis a medir, no mejora afirmada. Snapshots en supabase/snapshots/20261023-orders-rpc-before.

Medición13:19Z: caché usable=true y diez llamadas reales (5 estados × workbench/pickup) entre2475 y2740ms, contadores1/5/938/1008 estables. Contexto SQL temporal a partir de sesión MFA existente verificada y prueba TOTP guardada, sin tocar sesión/configuración ni emitir tokens; resultados guardados solo como hash+recuento. Primer intento de benchmark rechazado por el guard MFA al representar AMR timestamp con decimales; corregido el formato entero del contexto de medición, sin alterar el guard. Snapshot y benchmark antes de cualquier cambio. Se medirá una consulta alternativa solo SELECT antes de instalar funciones; sin DDL experimental persistente en producción.
