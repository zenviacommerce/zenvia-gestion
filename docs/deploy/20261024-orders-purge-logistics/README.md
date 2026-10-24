# Incidencia urgente: Amazon PII → clasificación logística

Estado: preparado y probado; NO aplicado en producción ni publicado el frontend. Requiere aprobación del propietario para la reparación derivada.

## Evidencia y alcance previo

24-10-2026, lectura de producción: 549 fulfillment_orders purgados, 1 propietario. Proyección: 504 enviados, 36 cancelados, 9 pendientes incorrectos. Los nueve coinciden exactamente con los números indicados por el propietario; todos conservan fulfilled_at de agosto, source_status Shipped y estado MRW/Sendcloud DELIVERED o DRIVER_ON_ROUTE. Los nueve tienen un hecho de despacho previo por owner_id + order_id, aunque su identidad basada en tracking/etiqueta ya no coincide. Se recupera su fecha real guardada, no la fecha de reparación.

La causa es la identidad logística ligada a capacidades borradas. El estado no debe depender de que siga disponible el enlace o número de seguimiento. La purga borra también tracking normalizado e historial de etiquetas; la captura nueva ocurre BEFORE, mientras OLD y el estado normalizado siguen disponibles.

Cron amazon-pii-purge-daily activo a las 02:30 UTC. No se desactiva ni se reprocesa la purga.

## Cambio propuesto

- Archivo privado append-only order_logistics_retention por propietario/pedido: estado operativo, fecha de despacho si conocida, causa y base de evidencia, elegibilidad histórica para costes y período. Sin nombres, direcciones, tracking, URLs, certificados o credenciales. RLS activa; sin acceso directo de authenticated/anon.
- Trigger BEFORE captura el estado antes de la limpieza AFTER. La marca pii_purged_at fuerza archivo enviado o cancelado; nunca Pending/Labelled. Cancelación conserva prioridad. Fecha desconocida queda NULL, sin inventar entrega ni fecha de despacho.
- Clasificador, proyección, detección de caché obsoleta y tres RPC coherentes. Workbench/pickup conservan lectura de clasificación proyectada; evidencia por página visible. No se vuelve a clasificar todo el workspace en cada lectura. No cambia el wrapper MFA.
- Frontend: isProcessedOrder reconoce la marca purgada también en lecturas ligeras sin metadatos logísticos. No cambia presentación, acciones o filtros.

## SQL exacto y límites

apply.sql contiene la transacción completa: definitions.sql + repair.sql. Se crearán 549 filas derivadas no PII y se refrescarán solo 9 grupos de proyección. CERO actualizaciones a pedidos fuente, facturas o documentos. El gate aborta si no coinciden 549 filas, 1 owner y 9 objetivos. En instalaciones vacías omite la reparación. Locks máximo 3 s, sentencia máximo 15 s; advisory locks de grupo sin espera. Cualquier error aborta toda la transacción. No afirmar duración real antes de ejecutarla; repair_ms queda anotado en COMMENT de la tabla y se medirá además el total.

rollback.sql restaura exactamente las ocho funciones previas y retira el trigger nuevo; conserva los hechos derivados no PII. No recupera datos borrados. El rollback restaura también el defecto conocido de clasificación, por lo que es solo salida de emergencia. Frontend rollback: Vercel producción actual 9h5KKoGo7y7BTXcL22286d5moB3i / main0c7c202309482a90cc48cbf8169b79cee055f636.

## Impacto en documentos y métricas

La purga inspeccionada modifica pedidos y copias operativas de cancelación; no modifica tablas de facturas. Ninguno de los 549 tiene líneas pickup_report_items. impact-baseline.json conserva recuentos y huellas para comparación posterior (sin contenido de facturas). El test sintético comprueba que un pedido con documento previo conserva pickup_reports e items idénticos al purgarse.

Transportista, proveedor y costes registrados no se borran. Los 549 costes registrados ya son NULL; no se inventan importes ni ceros. Para futuras purgas se conserva exactamente la elegibilidad previa por etiqueta; para ya purgados solo se recupera elegibilidad cuando existe evidencia previa. Se conserva el período y el coste registrado si existe. Límite explícito: no es posible reconstruir estimaciones tarifarias anteriores basadas en direcciones/peso borrados; se excluyen estos candidatos de reestimación y permanecen pendientes de valorar. No se afirma conservación de una estimación nunca almacenada.

## Política Amazon

Fuente primaria consultada: https://developer-docs.amazon/sp-api/lang-en_en/docs/protecting-amazon-api-applications-data-encryption-and-recovery y controles de seguridad oficiales. PII se elimina como máximo 30 días tras entrega salvo obligación legal, y datos no PII solo durante la necesidad documentada. La documentación consultada no permite afirmar que cualquier tracking sea siempre no PII. En esta aplicación sirve para consultar un destinatario: por prudencia no se recupera ni se amplía retención de tracking/URLs. Se conservan solo estados/fechas/causas operativas necesarios para no reenviar pedidos y mantener trazabilidad logística/contable.

## Verificación previa

RED observado: pedido Shipped/fulfilled purgado pasa Pending con el clasificador previo; frontend sin metadatos también lo trataba como pendiente. GREEN: pruebas de purga antes/después del hotfix, eliminación real del estado normalizado por el trigger productivo, proyección y tres RPC, actualización posterior, cancelación, pendientes reales, costes registrados/transportista, documentos, aislamiento y caché/fallback. Suite completa 140/140 en 23 archivos, build correcto. Después se añadió y pasó una prueba específica de rollback de las ocho funciones; los tres casos de purga/reparación/rollback se reejecutaron en verde tras el último ajuste de cancelados. Revisión independiente sin blockers tras limitar la inferencia had_label al backfill. Prueba adicional del gate de recuento: rechaza reparación con población distinta sin escribir el archivo derivado.

## Verificación tras aprobación

1. Recontar inmediatamente antes; verificar snapshot de funciones sin cambios de otra sesión y registrar hora UTC.
2. Aplicar atómicamente; medir duración total, repair_ms y bloqueos/errores. Error → transacción revertida; si falla verificación posterior, rollback preparado.
3. Comparar 549 archivados, nueve enviados, cero purgados pending/labelled, stale_keys, hechos/fechas/causas. Comparar baseline de facturas, informes y campos de coste/transportista.
4. RPC como authenticated bajo contexto real del owner y timeout8s, parámetros de Pendientes y Enviados. Navegador real: contadores, filas, selección, purgados fuera de pendientes y llamadas concurrentes reales. Capturas antes/después. No afirmar recuperación por SQL aislado.
5. Frontend solo después de CI completa y aprobación de publicación. Mantener rollback Vercel preparado. Canonicalizar el timestamp real de la migración Supabase antes de integrar.

VERI*FACTU fase1 pausada hasta resolver esta urgencia. Cierre de rendimiento #303 aceptado: ../20261024-orders-303-production/README.md.
