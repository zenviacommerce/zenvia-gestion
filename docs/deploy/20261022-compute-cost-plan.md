# PRIORIDAD ALTA — consumo y margen por workspace

Orden autorizado: catálogo publicado → reducción de consumo (intercalada con correcciones de revisión) → publicación pendiente del seguimiento. El sondeo nuevo debe cumplir ya estos criterios. Proyecto Gestión: sjkxxbedkkmgmqnvaqjh. No aumentar compute como sustituto de corregir la carga.

## Evidencia de partida

Ventana aportada por el propietario: aproximadamente 2,8 días, desde 2026-10-19 10:28 UTC. Estos tiempos de pg_stat_statements son tiempo acumulado de ejecución, NO una medición de CPU pura; no convierten directamente a tamaño de compute.

| Operación | Llamadas | Media | Total aproximado |
|---|---:|---:|---:|
| orders_dashboard_pickup_v1 | 12.964 | 1.079 ms | 13.990 s |
| WAL / postgres_changes | 355.116 | 13 ms | 4.679 s |
| orders_dashboard_page_v1 | 3.616 | 900 ms | 3.252 s |
| fulfillment_orders por sendcloud_id | 24.544 | 89 ms | 2.185 s |
| amazon_order_items por asin/seller_sku | 9.440 | 49 ms | 463 s |
| baseline de periodos | 1 | 88,7 s | 88,7 s |
| shopify_analytics_summary | 43 | 2,4 s | 103 s |

Hallazgos de código: watchFulfillmentOrders añadía un fallback cada 15 s sin visibilidad, además del temporizador de cada pantalla. Suscripción sin filtro owner_id. Dashboard ejecutaba sincronización Sendcloud en navegador. Corrección local incluida en la rama: un temporizador de lectura por pantalla, >=60 s, solo visible, sin sincronización periódica externa; eventos agrupados, lecturas serializadas, filtro por workspace, desconexión al ocultar y rechazo de callbacks de workspace anterior. No está publicada.

Inspección de índices de producción (solo lectura): YA existe fulfillment_orders_owner_id_sendcloud_id_key UNIQUE (owner_id, sendcloud_id). También existen amazon_order_items_asin_idx (owner_id, marketplace_id, asin) y amazon_order_items_sku_idx (owner_id, marketplace_id, seller_sku). No crear duplicados: comprobar predicados reales, uso de marketplace y selectividad/RLS. Índices de orders por propietario/fecha/canal ya presentes.

## Ejecución y aceptación

1. **Baseline reproducible sin perder evidencia.** Exportar pg_stat_statements + stats_reset + hora UTC, planes, índices, cron, volumen por tenant y CPU/memoria/conexiones/IO de la misma ventana. Distinguir versión desplegada y consultas anteriores a la optimización Shopify. Consultar EXPLAIN (ANALYZE, BUFFERS, SETTINGS) de SELECT representativos con tenant y rol/MFA reales, timeout y límites; no ejecutar a ciegas el baseline de 88,7 s. Si un RPC tiene efectos laterales, inspeccionarlo antes de ANALYZE. No hacer reset antes de preservar el baseline.
2. **RPC de Pedidos <50 ms.** Examinar implementaciones privadas además del wrapper público MFA. Medir combinación normal, filtros Incidencias, búsqueda, paginación y selección masiva sin degradar aislamiento. Evitar recalcular facetas/KPI de todo el histórico en cada página. Elegir contadores/agregados por workspace y dimensiones estables mantenidos incrementalmente por trigger/cola; cron solo para reconciliación acotada. No cachear resultados entre tenants. Conservar exactitud con inserts, updates, borrados, etiquetas anuladas y purga PII. EXPLAIN antes/después y medir media/p95/p99 en RPC reales; objetivo <50 ms en casos representativos, sin esconder búsquedas lentas en la media.
3. **Lecturas e índices.** Rastrear SELECT por sendcloud_id y comprobar owner_id explícito; corregir acceso antes de duplicar índice existente. Revisar consulta OR asin/seller_sku y prefijo marketplace de índices existentes con planes reales. Identificar baseline 88,7 s y comprobar si shopify_analytics_summary actual sigue lento mediante deltas nuevos, sin confundir histórico con regresión. Cada índice propuesto debe justificarse por EXPLAIN y coste de escritura.
4. **Invalidación ligera.** Sustituir postgres_changes de Pedidos/analítica por Broadcast privado por workspace, con RLS sobre realtime.messages, payload mínimo (tipo/revisión, sin pedidos/PII), eventos de commit y agrupación de ráfagas. Clientes invalidan datos persistidos con una lectura compartida y serializada; pestañas ocultas sin suscripción ni sondeo. Evitar N consultas por N eventos, incluir varias pestañas en la medición. Si no es viable Broadcast inmediato, reducir tablas/suscripciones y documentar límite temporal. La corrección local visible/60 s no equivale a completar esta sustitución.
5. **Cron y salidas vacías.** Revisar shopify-order-freshness, platform-shadow-source y amazon-sync-worker cada minuto; amazon-orders-five-minutes y zenvia-shipment-tracking-shadow cada 5 min. Comprobar trabajo vencido con índice antes de llamadas de red/escaneos amplios, lease atómico y SKIP LOCKED, evitar solapamiento por cuenta, backoff/jitter, métricas agregadas. Ajustar frecuencia por SLA, no por uniformidad. El worker de seguimiento ya limita activos, excluye terminales, pausa cuentas sin credenciales 6 h, respeta Retry-After, rota cuentas y no depende del navegador. Auditar también coste de seeding/heartbeat cuando no hay trabajo; una llamada vacía no debe recorrer todo el histórico ni generar logs por pedido.
6. **Observabilidad por workspace.** pg_stat_statements agrupa consultas normalizadas y NO permite atribuir llamadas a tenant por sí solo. Instrumentar duración/resultado en el límite RPC y trabajadores usando workspace verificado en servidor, nombre de operación permitido y buckets horarios; no almacenar argumentos/PII ni aceptar tenant declarado por cliente. Agregación por workspace/RPC/hora con llamadas, total_ms, errores y p95 por histograma/muestreo acotado. Acceso administrativo; RLS y pruebas de aislamiento. Vigilar coste de la propia instrumentación, retención y fallos sin bloquear pedidos. Vista de consumo sobre esos agregados, unida a volumen de pedidos/envíos y sesiones visibles. CPU/memoria son métricas del proyecto; atribución por tenant será estimación de carga, etiquetada como tal.
7. **Ventana posterior y reset controlado.** Tras baseline guardado y despliegue identificado, hacer un único reset fechado de pg_stat_statements como frontera de la ventana. Medir 24–72 h comparables con llamadas/hora, total_ms/hora, latencia, CPU media/p95, memoria, cache hit, IO/conexiones y cola cron; no reiniciar estadísticas repetidamente. Las capturas del frontend deben verificar varias pestañas visibles/ocultas y filtros, con contador de requests y sin duplicados. No declarar alcanzado el objetivo de 50 ms hasta obtener estas mediciones.
8. **Capacidad a 10, 50 y 200 clientes.** Generar carga representativa con distribución de tamaños, pedidos/día, envíos activos, pestañas visibles y ráfagas; no multiplicar simplemente el consumo actual de un cliente. Separar coste fijo del proyecto/cron y marginal por cliente. Para cada N, publicar carga medida, CPU/memoria/IO/p95, backlog y compute mínimo que conserva holgura (objetivo CPU sostenida <=60%, sin crecimiento de cola). Estimación por escenarios bajo/normal/alto y margen sobre cuota por plan. Consultar especificaciones/precios actuales antes de presupuestar. SMALL/MEDIUM/etc quedan sin asignar hasta medir; inventar ahora un tamaño ocultaría la incertidumbre.

## Entregables y límites de publicación

- PR independiente de rendimiento con planes antes/después, migraciones completas revisables y rollback; sin DROP ni borrado de datos para optimizar.
- Revisión previa de toda migración marcada destructiva: SQL completo en conversación y GitHub, tablas y recuento de cada DELETE/UPDATE/DROP; no reenviar la migración de privacidad denegada sin aprobación explícita.
- Capturas antes/después; UI de seguimiento retenida hasta aprobación del propietario. Backend solo en sombra por ahora.
- El reproceso de activos presenta primero recuento de cambios y excluye entregados. No usar el reproceso como benchmark de escritura sobre clientes.

## Estado

Plan añadido con prioridad alta; primera reducción de frontend implementada localmente y probada. Falta medir planes/CPU/memoria, implementar el resto de optimización y estimar capacidad con evidencia. No se ha hecho reset de estadísticas ni cambio de compute, no se ha publicado esta UI y no se ha reintentado la migración denegada.
