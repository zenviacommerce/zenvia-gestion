# Atribución de costes al transportista real

## Causa comprobada

Pedido 402-4191875-5589160, registro 0a30e623-2948-4ad9-be50-19ee3fa5b672. Etiqueta Envia, servicio epaq_24, importe real provider_actual de 4,57 €. Durante el sync, operationalStatePatch copiaba carrier y shippingService de Amazon sobre carrier_code/carrier_name/shipping_service_name del envío local. La lectura anterior vio Correos Express y el siguiente ciclo volvió a MRW; no era una estimación mal agrupada. La corrección del KPI en #244 recuperó el total, pero la verificación anterior no sostuvo el desglose durante el siguiente ciclo: se corrige esa conclusión.

## Corrección

preservePersistedFields conserva la identidad del transportista y servicio cuando el pedido tiene proveedor local y referencia/etiqueta de envío. Se aplica al importador completo y al reconcile independiente. Amazon sigue aportando estado y datos de transportista para envíos sin propiedad logística local. Se conserva la supresión de UPDATE sin cambios.

Regresión rojo→verde: antes fallaba mrw !== correosExpress; después pasan 14 tests, con tres proveedores y ambos caminos, repetición sin UPDATE y envío externo sin propiedad local. No se modifica el estimador ni el frontend del KPI.

## Producción y rollback

Snapshot exacto por función en supabase/snapshots/20261019-carrier-attribution/: worker40, orders22 y reconcile10. Se despliega únicamente el pequeño guard sobre los bundles vivos, conservando dependencias y verify_jwt de cada función; reconcile contiene diferencias previas y no se sustituye por todo el código de main. Rollback: redesplegar los tres snapshots exactos; para el registro reparado, restaurar exclusivamente carrier_code, carrier_name y shipping_service_name desde order-before.json. Esto reintroduciría la causa y el desglose incorrecto, por lo que se reserva a incidentes de la corrección.

Backend autorizado tras CI verde. Reparación guardada del único registro afectado a Correos Express/epaq_24, sin tocar precio, seguimiento, etiqueta ni estado. Verificación posterior: desglose por cinco periodos comparado con referencia previa, y ciclo natural del worker sin pérdida del transportista real.

Frontend sin cambio funcional: el bundle actual ya calcula correctamente a partir de la identidad persistida. No se compran etiquetas ni se cambian MFA/configuración Auth.
