# Seguimiento de envíos — diagnóstico de producción

Fecha de comprobación: 2026-10-21, 22:32 UTC. Proyecto sjkxxbedkkmgmqnvaqjh.
Estado: diagnóstico y diseño; ningún pedido, etiqueta ni configuración de transportista modificado.

## Evidencia

Se recuperaron las funciones desplegadas y se comparó su archivo principal íntegro con main: coincidencia exacta en los tres casos.

| Proveedor | Función desplegada | Actualización del despliegue UTC | Funcionamiento actual |
| --- | --- | --- | --- |
| MRW directo | mrw-shipping v24 | 20/10 11:58:11 | status/options/create_label/fetch_label; ninguna consulta de seguimiento. Al crear etiqueta escribe READY_TO_SEND. |
| Sendcloud | sendcloud-orders v34 | 20/10 11:58:13 | action=sync devuelve disabled:true, synced:0. El parser shipmentMeta conserva código de seguimiento, pero la ruta de sincronización no lo usa. |
| Envia | envia-shipping v44 | 20/10 11:58:02 | sync_shipments consulta guías por meses y detalle por guía. La pantalla Pedidos lo invoca mientras está visible; no hay un trabajador dedicado. |

La copia previa de Sendcloud en docs/deploy/20261020-order-weights-before/sendcloud-orders.json ya contiene la sincronización desactivada. Esta evidencia permite fechar la ausencia al menos al 20/10; no demuestra cuándo se introdujo originalmente.

`cron.job`: 13 trabajos; cero comandos que contengan tracking, sendcloud, mrw o envia. No se ha encontrado un endpoint desplegado dedicado a webhooks de seguimiento. No se ha inspeccionado la configuración externa de webhooks en las cuentas del proveedor; no afirmar que esté vacía.

Envia escribe tracking_updated_at=now() en cada consulta, sin comprobar movimiento. Amazon también puede escribir SHIPPED y fechas por el estado del marketplace. Por tanto, la última escritura del 19/10 no prueba una última consulta a MRW ni el momento en que se paró un sondeo.

La función order-logistics-state resuelve URLs; no actualiza estados de transportista. El gateway MRW actual solo permite GetPointsDB, TransmEnvio, GetEtiquetaEnvio y CancelarEnvio; no permite el servicio separado de seguimiento.

Consulta reproducible, solo lectura:

```sql
select shipping_provider, carrier_code, tracking_status_code,
       count(*) as shipments, min(label_created_at) as oldest_label,
       max(tracking_updated_at) as last_tracking_write
from public.fulfillment_orders
where label_created_at < now()-interval '3 days'
  and label_created_at >= now()-interval '45 days'
  and label_cancelled_at is null
group by shipping_provider, carrier_code, tracking_status_code
order by shipping_provider nulls first, carrier_code, tracking_status_code;
```

Resultados relevantes (ventana móvil a la hora indicada, incluye entregados como control):

| Proveedor / transportista | Código | Cantidad | Etiqueta más antigua | Última escritura |
| --- | --- | ---: | --- | --- |
| Sendcloud / MRW | SHIPPED | 36 | 24/09 | 19/10 12:30 UTC |
| MRW directo | SHIPPED | 29 | 05/10 | 19/10 05:30 UTC |
| MRW directo | READY_TO_SEND | 4 | 12/10 | 15/10 08:03 UTC |
| Sendcloud / MRW | AWAITING_CUSTOMER_PICKUP | 2 | 22/09 | 02/10 |
| Sendcloud / MRW | DELIVERY_DATE_CHANGED | 1 | 24/09 | 25/09 |
| Sendcloud / MRW | DELIVERY_FAILED | 1 | 22/09 | 24/09 |
| Envia / Correos Express | Information | 1 | 14/10 | 21/10 16:41 UTC |
| Envia / Correos Express | null | 1 | 14/10 | null |
| Envia / Correos Express | Delivered at Origin | 1 | 02/10 | 21/10 16:42 UTC |

Hay además filas antiguas con shipping_provider=null: nueve MRW (7 DELIVERED, 1 DELIVERY_DATE_CHANGED, 1 DRIVER_ON_ROUTE) y una CTT delivered. No asignar proveedor por el nombre del transportista sin una relación verificable con la cuenta.

Existe una cuenta habilitada de cada proveedor. last_success_at no es un heartbeat fiable de seguimiento: Envia 30/09, MRW 01/10 y Sendcloud null pese a escrituras posteriores.

## Errores de presentación reproducibles en código

src/pages/Orders.tsx combina código y mensaje, y busca subcadenas. `Delivered at Origin` cae en Entregado; un texto que mencione cancelación puede acabar en Cancelado aunque el código no lo indique. DRIVER_ON_ROUTE tampoco coincide con `driver en route` sin un mensaje alternativo. DELIVERY_FAILED depende del texto porque el parser busca otras frases. No basta con mejorar traducciones: hace falta un estado de máquina normalizado.

## Contratos oficiales consultados

- MRW: https://seguimiento.mrw.es/swc/wssgmntnvs.asmx?op=SeguimientoNumeroEnvioMRWNacional — SOAP distinto de SAGEC; requiere Franquicia, Cliente, Password, NumeroMRW, Referencia y Agrupado; respuesta con Estado/EstadoDescripcion. No se ha probado la autorización de la cuenta existente ni el catálogo completo de códigos. Configuración ya tiene trackingPassword opcional; no se ha leído su valor.
- Sendcloud actual v3: https://sendcloud.dev/docs/parcel-tracking/retrieve-tracking-info — GET /api/v3/parcels/tracking/{tracking_number}, eventos del más reciente al más antiguo; phase/exception/sub_status. No tiene parent_status de v2. delivery_forced no confirma entrega por el transportista. Event Subscriptions está en beta.
- Envia: https://docs.envia.com/reference/track-shipments — POST /ship/generaltrack/ con trackingNumbers; catálogo de estados. ID 13 Delivered at Origin significa devolución al origen; ID 3 Delivered es entrega al destinatario.
- Envia webhooks: https://docs.envia.com/reference/webhooks — existen variantes con autenticación y formatos diferentes; verificar el contrato elegido antes de activarlo.

## Límites y siguiente paso

La causa actual queda demostrada: MRW no se consulta; Sendcloud no sincroniza; Envia depende de la pantalla y sus fechas mezclan comprobación con movimiento. No está demostrada la fecha inicial del fallo ni que el transportista responda con las credenciales actuales. El diseño asociado define cómo resolverlo sin importar pedidos otra vez, emitir etiquetas ni tocar estados de marketplaces.

Estimación de implementación y verificación: 5–7 horas si el acceso MRW y la configuración de webhooks están disponibles. Despliegue y reproceso quedan sujetos a la revisión de cambios, capturas y SQL exacto que actualice datos existentes. Ningún UPDATE/DELETE/DROP ejecutado durante este diagnóstico.
