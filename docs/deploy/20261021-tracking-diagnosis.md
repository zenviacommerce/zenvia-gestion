# Diagnóstico de seguimiento ZENVIA Gestión — 21 octubre 2026

Investigación de sólo lectura en Supabase `sjkxxbedkkmgmqnvaqjh`, con evidencia consultada aproximadamente hasta 14:20 UTC / 16:20 Europe/Madrid. No se ejecutaron sincronizaciones, llamadas autenticadas a carriers, creación/reimpresión de etiquetas, documentos, cambios de cron, secretos, MFA ni despliegues. No se recogieron datos personales. Este informe es material interno de diagnóstico para incorporar al backlog.

## Conclusión

No hay evidencia de una caída global de MRW el 19 de octubre. Hay una carencia estructural de adquisición de estados de transportista, combinada con la retirada de un eco de Amazon que aparentaba actualización:

1. **Sendcloud**: el `sync` desplegado es un no-op que responde HTTP 200 con `disabled:true`, `synced:0`, `enriched:0`. La antigua consulta/enriquecimiento de shipments ya no se llama. No existe cron de seguimiento ni webhook específico desplegado.
2. **MRW directo**: la función desplegada sólo consulta configuración/opciones, transmite el envío y descarga etiquetas. No implementa operación de seguimiento ni webhook. Crear una etiqueta escribe READY_TO_SEND y la fecha local; no implica que MRW haya informado de movimiento.
3. **Amazon**: hasta el 19 de octubre, su importador podía escribir SHIPPED y fecha local. El cambio del 19 de octubre protege el tracking de etiquetas del proveedor local contra el eco de Amazon. Tras ello ya no aparece esa actualización de aparente seguimiento. Proteger el dato local es correcto; falta un proceso que lo alimente desde el transportista.
4. **Envia** sí consulta guías y escribe estados hoy, pero depende del navegador/página Pedidos, no de un cron autónomo. Además, el trigger de conservación de tracking Shopify bloquea actualizaciones de estado que tengan la misma identidad de etiqueta, incluyendo las de Envia.
5. La clasificación por texto contiene falsos positivos/negativos: Delivered at Origin se presenta como entregado al destinatario; DRIVER_ON_ROUTE, DELIVERY_DATE_CHANGED y DELIVERY_FAILED no están cubiertos de forma fiable por sus códigos canónicos.

## Evidencia de producción por proveedor

Se comprobó código **desplegado**, no sólo el checkout: `get_edge_function` para sendcloud-orders v34, mrw-shipping v24 y envia-shipping v44, actualizadas el 20 octubre aproximadamente 11:58 UTC; amazon-reconcile-orders v12, actualizada el 19 octubre 15:02 UTC. Se inspeccionaron únicamente patrones y líneas relevantes, sin emitir credenciales.

| Proveedor | Adquisición real actual | Automatización independiente | Resultado |
|---|---|---|---|
| Sendcloud | `action=sync` retorna inmediatamente sin consultar shipments | Ningún cron de tracking encontrado; ninguna Edge Function webhook Sendcloud desplegada | Seguimiento carrier no se refresca por esta vía |
| MRW directo | SOAP `TransmEnvio`, `GetEtiquetaEnvio`; no operación de estado | Ningún cron ni webhook MRW desplegado | No hay cobertura de seguimiento directo |
| Envia | `sync_shipments` lista `/guide/{month}/{year}` y consulta `/guide/{tracking}`; usa estado recibido | Se invoca desde `Orders.tsx` al sincronizar; ningún cron Envia | Funciona hoy para Amazon; Shopify puede quedar congelado por trigger |
| Amazon / Shopify | Importadores del canal y confirmación de expedición | Hay cron de canales | Confirmación de expedición y estado marketplace no sustituyen tracking carrier |

Fuentes de código en `/workspace/scratch/209f463fbd52/ui-extraction` (HEAD leído `95891f9816313bfe11b7b910593689e267e200c5`):

- `supabase/functions/sendcloud-orders/index.ts:184-189,217,335`: fetchShipments/shipmentMeta conservadas pero sin llamada en sync; no-op; READY_TO_SEND al crear etiqueta.
- `supabase/functions/mrw-shipping/index.ts:155-236`: acciones status/options/create_label/fetch_label; operaciones SOAP citadas; READY_TO_SEND en línea 213.
- `supabase/functions/envia-shipping/index.ts:449-579,616-624`: listado/detalle por guía, matching, patch de estado/fecha y sync_shipments. `tracking_updated_at` se escribe con `new Date()`: representa la consulta local y no necesariamente el instante del evento carrier.
- `src/pages/Orders.tsx:522-545`: sincroniza Envia si enabled/configured; Shopify y Amazon por sus vías; no adquisición MRW/Sendcloud de estado.
- `supabase/functions/order-logistics-state/index.ts:107-149`: resolve_tracking_link obtiene/cachea una URL; no actualiza estado ni fecha del tracking. Abrir el enlace no resuelve el problema de estado.
- `supabase/functions/_shared/amazon/orders.ts:151-158,169-182`: preserva tracking del proveedor local; operationalStatePatch puede generar SHIPPED desde Amazon.
- `supabase/functions/_shared/shopifyShipment.ts:54-64`: preserva valores de tracking existentes de etiquetas locales durante importación Shopify.

Se consultó el hash remoto main mediante `git ls-remote`: `5e90cb6fc6e1997ca4dd3376e3c6e15e06573699`; no está en el objeto local y no se modificó el checkout para traerlo. Las conclusiones backend principales están contrastadas directamente con el despliegue activo, por lo que no dependen de asumir que ese checkout sea main actual.

## Agregados verificados

Ventana explícita de etiquetas `[2026-09-06T00:00Z,2026-10-18T00:00Z)`, excluyendo `label_cancelled_at IS NOT NULL`. Es una ventana fija aproximada 3–45 días, no un cálculo exacto de edad a la hora de consulta. Toda la tabla/proyecto; no se eligió ni mostró un propietario. Consultas acotadas con transacción READ ONLY y statement_timeout 5s.

| Proveedor / canal / carrier | Código | Cantidad | Primera etiqueta UTC | Última actualización tracking UTC |
|---|---|---:|---|---|
| Sendcloud / Amazon / MRW | SHIPPED | 36 | 24Sep 09:06 | 19Oct 12:30:28.561 |
| MRW directo / Amazon / MRW | SHIPPED | 29 | 5Oct 08:55 | 19Oct 05:30:20.240 |
| MRW directo / Shopify / MRW | READY_TO_SEND | 4 | 12Oct 19:26 | 15Oct 08:03:02.965 |
| MRW directo / Shopify / MRW | DELIVERED | 1 | 8Oct 08:53 | 13Oct 08:27 |
| Sendcloud / Amazon / MRW | DELIVERED | 64 | 16Sep | 1Oct 12:54 |
| Sendcloud / Amazon / MRW | AWAITING_CUSTOMER_PICKUP | 2 | 22Sep | 2Oct 11:45 |
| Sendcloud / Amazon / MRW | DELIVERY_DATE_CHANGED | 1 | 24Sep | 25Sep 12:48 |
| Sendcloud / Amazon / MRW | DELIVERY_FAILED | 1 | 22Sep | 24Sep 10:43 |
| Sendcloud legado, provider NULL y parcel id presente / Amazon / MRW | DELIVERED | 7 | 30Sep | 2Oct 16:13 |
| Sendcloud legado / Amazon / MRW | DELIVERY_DATE_CHANGED | 1 | 30Sep | 2Oct 11:43 |
| Sendcloud legado / Amazon / MRW | DRIVER_ON_ROUTE | 1 | 1Oct | 5Oct 08:05 |
| Envia / Amazon / CorreosExpress | Delivered | 8 | 2Oct | 21Oct 14:14:51.567 |
| Envia / Amazon / CorreosExpress | Delivered at Origin | 1 | 2Oct | 21Oct 14:14:52.036 |
| Envia / Amazon / CorreosExpress | Information | 1 | 14Oct | 21Oct 14:14:47.353 |
| Envia / Shopify / CorreosExpress | NULL | 1 | 14Oct | NULL |

Los conteos 36/29/4 aportados por el usuario quedan verificados para esta ventana. La evidencia no prueba que las 36+29 estén físicamente sin entregar: su estado local es obsoleto y no se consultó el carrier.

La afirmación «ningún tracking MRW desde el 19» requiere precisar **seguimiento de envíos ya existentes**: sí hay tracking_updated_at posterior, pero todos los hallados corresponden a nuevas etiquetas READY_TO_SEND: 17 MRW directo del 20/21 de octubre (15 Amazon, 2 Shopify) y 1 Sendcloud Amazon del 21. Esto sólo muestra escritura al crear etiqueta, no progreso carrier.

La única etiqueta Envia Shopify tiene tracking_number y label_created_at presentes, last_synced_at `2026-10-21 14:14:48.813Z`, tracking_updated_at NULL. Esto demuestra refresco de fila sin refresco de estado; encaja con el trigger descrito abajo.

## Cron y logs recientes

`cron.job` se leyó seleccionando exclusivamente jobid, jobname, schedule, active y extracción del nombre de endpoint; **nunca command bruto ni tokens**. No hay jobs Sendcloud, MRW, Envia o tracking. El único job Shopify de frescura relevante es `shopify-order-freshness`, `* * * * *`, activo, endpoint `shopify-order-events`. Otros jobs activos son de Amazon, mantenimiento, purga y shadow Platform. El job analytics Shopify está desactivado; no es tracking.

`cron.job_run_details`: shopify-order-freshness tiene 1469 ejecuciones succeeded desde 20Oct13:49Z hasta 21Oct14:17Z. Este éxito indica ejecución SQL/encolado, **no certifica respuesta HTTP ni actualización carrier**.

Logs agregados `function_edge_logs`, ventana 20Oct12:00Z–21Oct12:00Z:

| Endpoint | HTTP | Solicitudes |
|---|---:|---:|
| envia-shipping | 200 | 1188 |
| mrw-shipping | 200 | 43 |
| order-logistics-state | 200 | 61 |
| sendcloud-order-tools | 200 | 24 |
| sendcloud-orders | 200 | 3965 |

El número de respuestas 200 no prueba seguimiento; los logs no incluyen body.action y Sendcloud sync responde 200 sin trabajo. No se vio fallo HTTP de estos endpoints en esa ventana. En function_logs 20Oct14:20Z–21Oct14:20Z no aparecen nivel error para los tres proveedores; aparecen warnings 38 Envia / 9 MRW. Se clasificaron sin emitir mensajes potencialmente sensibles; ninguno coincidió con `Envia shipment detail fallback` ni `ENVIA_OPERATION_FAILED`. Su causa no quedó determinada y no se les atribuye el problema.

## Cronología y causas

- MRW directo aparece implementado desde 1Oct (commit `70669663`), pero las acciones actuales no incluyen seguimiento.
- `5e111f3e` — 5Oct10:44 CEST: la importación Sendcloud excluye Amazon, de modo que esa vía dejó de enriquecer sus pedidos.
- `25e8d75e` — 5Oct10:56 CEST: sustituye todo sync Sendcloud por no-op. Eliminó también el enriquecimiento por shipments junto con la importación de pedidos. El código desplegado actual mantiene ese no-op. Fecha de cambio fuente verificada; sin logs históricos suficientes para afirmar el segundo exacto de despliegue original.
- `2fbacb81` — 19Oct16:46 CEST: amplía protección de identidad carrier a tracking/estado/fecha/costes de etiquetas locales dentro del importador Amazon. Antes Amazon podía escribir SHIPPED y fecha actual; después queda preservado el estado local. Coincide temporalmente con las últimas fechas SHIPPED el 19Oct. Esta es la explicación más sólida del corte aparente, no una prueba de caída de API MRW.
- Envia tiene implementación de sincronización, datos refrescados hoy y respuestas 200; no se puede afirmar salud de todos los carriers ni de todos los envíos.

## Trigger Shopify: bloqueo confirmado en código de producción

La definición activa de `public.integration_preserve_shopify_local_tracking()` contiene:

- old.source_channel=shopify, old.tracking_number presente, old.label_created_at presente (o MRW con remote id);
- new.last_synced_at o new.raw_payload distintos;
- shipping_provider / shipping_remote_id / sendcloud_parcel_id / label_cancelled_at sin cambio;
- restaura tracking_number/url, carrier_name, **tracking_status_code/message/updated_at**, fulfilled_at desde OLD.

Envia sync actualiza last_synced_at/raw y mantiene identidad. Por tanto este trigger también restaura el tracking de una consulta carrier legítima en pedidos Shopify. La única fila Envia Shopify con last_sync hoy y tracking NULL es evidencia consistente con esa interferencia. Sin ejecutar una mutación no se probó un payload concreto, pero la ruta de código y condiciones son explícitas. Un futuro worker carrier deberá evitar este bloqueo de forma intencional y acotada; no basta crear cron.

## Normalización

`src/pages/Orders.tsx:164-179` y SQL de dashboard `supabase/migrations/20261019143018_orders_dashboard_tariff_kpi_parity.sql:109-123` usan texto concatenado code+message, minúsculas y guiones/underscore convertidos a espacios:

| Entrada | Comportamiento actual | Problema |
|---|---|---|
| DELIVERED / Delivered / delivered | Entregado | Correcto sólo si es entrega al destinatario según proveedor |
| Delivered at Origin | Entregado por substring delivered | Puede ser devolución/entrega en origen; necesita estado distinto según semántica documentada |
| DRIVER_ON_ROUTE | driver on route no coincide driver en route | Puede caer en none salvo mensaje compensatorio |
| DELIVERY_FAILED | delivery failed no coincide attempt failed/unable to deliver | Puede caer en none; trackingDetail sí tiene traducción pero sólo se muestra como incidencia si antes fue clasificado issue |
| DELIVERY_DATE_CHANGED | Sin regla de código específica | Sin clasificación consistente; decidir warning/reprogramado según proveedor |
| AWAITING_CUSTOMER_PICKUP | Pickup | Reconocido |
| SHIPPED | Transit/Enviado | Sólo expedición; no demuestra movimiento MRW ni entrega |
| Information / NULL | None o mensaje literal | No debe inferirse entregado ni progreso carrier |

Los casos DRIVER_ON_ROUTE/DELIVERY_FAILED dependen también del mensaje guardado; son huecos confirmados del clasificador de código, no afirmación de cómo se ve cada fila concreta con su mensaje. No se emitieron mensajes de filas para evitar PII.

## Backlog propuesto (sin implementar)

1. Crear adquisición carrier independiente de importación de pedidos: worker acotado con leases/reintentos/backoff, identidad por workspace+proveedor+cuenta+shipment, eventos idempotentes, estado terminal y timestamps separados de consulta/evento.
2. Sendcloud: recuperar actualización de shipments **sin restaurar importación de pedidos**. Cubrir provider NULL + parcel/shipment id legado y resolver por id real, no order_number ambiguo. Webhook firmado y poll de reconciliación si API lo permite; verificar docs antes de implementar.
3. MRW directo: diseñar adaptador de seguimiento con el servicio admitido por contrato/cuenta y gateway de IP existente cuando aplique. Confirmar servicio/API y semántica documental; no se invocó ni asumió una operación SOAP inexistente.
4. Envia: extraer sync carrier de dependencia del navegador; paginación, timeout y procesamiento incremental; separar last_checked_at de carrier_event_at. Corregir protección Shopify para distinguir importador canal de actualizador carrier confiable.
5. Centralizar normalización por proveedor+código con tabla explícita de estados y paridad TS/SQL. Cubrir Delivered at Origin, DRIVER_ON_ROUTE, DELIVERY_FAILED, DELIVERY_DATE_CHANGED, Information, NULL, ready y cancelled con tests.
6. Observabilidad: última ejecución/éxito/error por proveedor, cola pendiente/edad, fallos de webhook, métricas de cambios reales y UI «última consulta/último evento». Evitar éxito engañoso de sync disabled.
7. Recuperación de backlog cuando corresponda tras finalizar Platform, conforme al encargo del propietario: simulación/dry-run agregada, lote pequeño verificado, luego reconciliar envíos abiertos existentes. No reenviar etiquetas ni confirmaciones de envío.

## Consultas reproducibles y límites

Consultas de datos se ejecutaron con `BEGIN READ ONLY; SET LOCAL statement_timeout='5000ms'; ...; ROLLBACK;`. Ejemplo principal:

```sql
select coalesce(shipping_provider,
 case when sendcloud_parcel_id is not null then 'sendcloud_legacy' else 'unknown' end) provider,
 lower(coalesce(carrier_code,'')) carrier,source_channel,
 coalesce(tracking_status_code,'<null>') code,count(*) n,
 min(label_created_at) first_label,max(label_created_at) last_label,
 max(tracking_updated_at) last_tracking
from public.fulfillment_orders
where label_created_at >= '2026-09-06T00:00:00Z'
 and label_created_at < '2026-10-18T00:00:00Z'
 and label_cancelled_at is null
group by 1,2,3,4 order by 1,2,3,4;
```

```sql
select jobid,jobname,schedule,active,
 substring(command from '/functions/v1/([a-zA-Z0-9_-]+)') endpoint
from cron.job order by jobid;
```

ClickHouse logs, ventana explícita arriba:

```sql
select log_attributes['request.pathname'] endpoint,
 log_attributes['response.status_code'] status,count() n,
 min(timestamp) first,max(timestamp) last
from logs where source='function_edge_logs'
 and (log_attributes['request.pathname'] like '%sendcloud%'
 or log_attributes['request.pathname'] like '%mrw%'
 or log_attributes['request.pathname'] like '%envia%'
 or log_attributes['request.pathname'] like '%order-logistics%')
group by endpoint,status order by endpoint,status;
```

No se consultaron carriers externos ni estados físicos de entregas. No se localizaron logs históricos de la fecha de desactivación 5Oct; la atribución temporal usa historial git y código desplegado. Las actualizaciones de fecha pueden venir de creación de etiqueta o consulta local, por lo que no constituyen evidencia de evento físico. El diagnóstico identifica mecanismos y huecos con evidencia, sin afirmar entregas reales que no se han comprobado.
