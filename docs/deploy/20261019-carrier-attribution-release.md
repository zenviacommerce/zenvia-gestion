# Atribución de costes al transportista real

## Causa comprobada

Pedido 402-4191875-5589160, registro 0a30e623-2948-4ad9-be50-19ee3fa5b672. Etiqueta Envia, servicio epaq_24, importe real provider_actual de 4,57 €. Durante el sync, operationalStatePatch copiaba carrier y shippingService de Amazon sobre carrier_code/carrier_name/shipping_service_name del envío local. La lectura anterior vio Correos Express y el siguiente ciclo volvió a MRW; no era una estimación mal agrupada. La corrección del KPI en #244 recuperó el total, pero la verificación anterior no sostuvo el desglose durante el siguiente ciclo: se corrige esa conclusión.

## Corrección

preservePersistedFields conserva la identidad del transportista y servicio cuando el pedido tiene proveedor local y referencia/etiqueta de envío. Se aplica al importador completo y al reconcile independiente. Amazon sigue aportando estado y datos de transportista para envíos sin propiedad logística local. Se conserva la supresión de UPDATE sin cambios.

Regresión rojo→verde: antes fallaba mrw !== correosExpress; después pasan 15 tests, con tres proveedores y ambos caminos, repetición sin UPDATE y envío externo sin propiedad local. No se modifica el estimador ni el frontend del KPI.

## Producción y rollback

Snapshot exacto por función en supabase/snapshots/20261019-carrier-attribution/: worker40, orders22 y reconcile10. Se despliega únicamente el pequeño guard sobre los bundles vivos, conservando dependencias y verify_jwt de cada función; reconcile contiene diferencias previas y no se sustituye por todo el código de main. Rollback: redesplegar los tres snapshots exactos; el registro se capturó para evidencia, pero no se alteró manualmente y no necesita rollback de datos. Esto reintroduciría la causa y el desglose incorrecto, por lo que se reserva a incidentes de la corrección.

Backend autorizado tras CI verde. No se ejecutó reparación manual: el sync de Envia ya restauró la identidad real y el propietario corrigió el dato de Amazon. Verificación posterior: desglose por cinco periodos comparado con referencia previa, y ciclo natural del worker sin pérdida del transportista real.

Frontend sin cambio funcional: el bundle actual ya calcula correctamente a partir de la identidad persistida. No se compran etiquetas ni se cambian MFA/configuración Auth.

## Aclaración del propietario

Confirmó que la etiqueta MRW se canceló y el envío real se hizo con Correos Express; él corregirá Amazon. Tanto la referencia anterior como el KPI nuevo leen carrier_code/carrier_name persistidos en fulfillment_orders; ninguno debe usar la tarifa ni la preferencia predeterminada para sustituir al transportista real de una etiqueta. El anterior acertó cuando Envia acababa de sincronizar y el nuevo mostró MRW tras sobrescribir Amazon los mismos campos. Se protege la fuente local, sin forzar totales ni depender de que Amazon se corrija. Coste registrado válido tiene prioridad frente a tarifa (shippingPriceForOrder); sin propiedad logística local se mantiene el dato del marketplace. Prueba específica MRW cancelado → etiqueta activa Correos, coste real4,57 intacto.

## Integridad ampliada y corrección del origen

A petición del propietario, se protegen también tracking (número, enlace, estado/fecha), todos los campos de coste, referencia/proveedor/cuenta, etiqueta y fulfilled_at cuando ya hay envío local. Amazon solo actualiza su declaración separada marketplace_carrier; la columna aditiva se instala antes de las funciones. No se guarda tracking adicional de Amazon. Estado comercial source_status sigue sincronizándose. Prueba exacta usa tracking MRW-CANCELLED frente a CORREOS-ACTIVE y exige conservación del coste/provider_actual y marketplace_carrier=MRW.

El propietario corrigió Amazon a Correos Express a las16:44Madrid. La lectura de Zenvia a14:46UTC ya muestra Correos Express/epaq_24 y4,57€ tras el sync de Envia. No se ha ejecutado reparación SQL manual. El siguiente ciclo Amazon se verifica por separado. Se elimina la reparación propuesta: no es necesaria si los datos reales ya están correctos.

## Backend fase1

CincoCIverdes en2fbacb81d314147f5feac9fd53d1f822d29b827f antes de tocar producción. Migración 20261019145139 amazon_marketplace_carrier aplicada. Preflight sin drift de worker40/orders22/reconcile10. 45/45regresiones contra los tresbundles candidatos. Siguiente: orders/reconcile, luego worker, re-fetch exacto y ciclo natural. No reparaciónSQL de datos.

## Backend fase2

A14:52UTC ACTIVE sync-orders23/reconcile11 y worker41. Re-fetch exacto de todos los archivos contra cada bundle candidato; únicamente dos ediciones enorders.ts, dependencias/JWT conservados. No se modificaron datos de pedidos manualmente. Paridad real14:52:51UTC frente a referencia58badb4d, mismo snapshotRLS de990filas: cinco periodos sin diferencias a céntimos y conteos. Esperando ciclo natural14:55 y CI de alineación del nombre de migración.

## Cierre de hueco histórico Sendcloud

Revisión final detectó etiquetas Sendcloud con parcel_id pero shipping_providerNULL. Test rojo probó sobrescritura en ese caso; el predicado de envío real ahora reconoce parcel_id/shipment_id históricos y referencias de etiqueta con coste real registrado, además del proveedor explícito. No incluye importes source=tariff_estimate por sí solos como autoridad logística. Nueva verificación sobre bundles y CI antes de ampliar la publicación.

## Publicación final

53685e5916b8e329eb147887b0dbdb13f04bf2d1 con5CIgreen;16tests del helper,48sobre los tresbundles y145Vitest/1128scriptsNode. Revisión independiente sin bloqueos. Despliegue final15:01–15:02UTC sync-orders24/reconcile12/worker42, archivos exactos a los candidatos tras re-fetch. PR245merge6c5b6a42e226c79e9ba96877c240adbeeebaae1f. Solo pendiente ciclo natural15:05 y recibo Vercel/alias.

## Cierre verificado15:06UTC

Ciclo natural15:05 con worker42: jobsafa3303f y57bcb839success,240registros cadauno,4.959/4.075ms. Cola0queued/0running/0failed y lease0. Huella de transportista/servicio/proveedor/referencia/tracking/coste idéntica antes y después (b1d9acb55060e06cae4838aa05c9c915); last_synced_at del pedido no cambia desde14:55:08.08UTC. marketplace_carrier=Correos Express, carrier operativo=correosExpress, coste provider_actual4,57€. Sin reparación manual. Cinco periodos vuelven a coincidir tras esta última versión; final-five-period-parity.json.

Vercel READYdpl_4yNticX5jfyyibqMe2yChVxp6rfH, alias confirmado, HTML/JS200, index-DIsFGH6G.js. Sin cambio de interfaz. Logs15:01:50–15:05:45UTC sinPGRST003/57014/worker_lease_lost/error de columna. Recibo20261019-carrier-attribution-receipt.json. Última variante y comprobaciones cerradas; rollback exacto disponible.
