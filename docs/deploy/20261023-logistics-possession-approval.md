# Regla corregida: nueva propuesta, sin ejecutar

La propuesta anterior de diez pedidos fue rechazada y queda invalidada. No se ha migrado ni publicado. Se conserva la aprobación de las dos mejoras de uso del repartidor.

## Resultado de solo lectura

1.008 pedidos canónicos: cinco pasarían a Etiquetados (cuatro Amazon y uno Shopify),938 conservan Enviados,64 Cancelados y uno Pendiente nuevo. Se conservan577 históricos canónicos. El pedido pendiente adicional es cambio de los datos vivos; no lo crea ni modifica esta migración.

| Canal | Pedido | Tracking |
| --- | --- | --- |
| Amazon | 171-1931838-4192365 | 01009F045767 |
| Amazon | 405-8653611-5071509 | 01009F045768 |
| Amazon | 406-5011260-4807511 | 01009F045766 |
| Amazon | 406-9615891-5475566 | 01009F045774 |
| Shopify | #1026 | 01009F045775 |

Todos READY_TO_SEND/pre_transit, etiqueta del23/10, sin firma efectiva ni movimiento físico en la identidad actual. [Consulta exacta](20261023-logistics-affected-orders.sql) y [UUIDs/resultados](20261023-logistics-affected-orders.json).

Los cuatro casos rechazados permanecen Enviados: DELIVERY_FAILED, AWAITING_CUSTOMER_PICKUP, MRW DELIVERED sin normalized y RETURNED_TO_SENDER con label_created_at nulo. También se conserva407-3816282-3253169, devuelto. Se añaden regresiones con datos sintéticos, sin copiar clientes ni direcciones.

## Regla

- Posesión acreditada con in_transit/out_for_delivery/delivered/exception/returned de la identidad actual; pre_transit no acredita. Eventos anteriores también cuentan, aunque el estado actual haya retrocedido.
- Normalized null: se usa primero raw_code del estado actual con su fecha, y después tracking_status_code de fulfillment_orders; misma regla en triggers y backfill. DELIVERED/RETURNED_TO_SENDER/DELIVERY_FAILED/AWAITING_CUSTOMER_PICKUP/DRIVER_ON_ROUTE son evidencias. SHIPPED genérico exige un evento real del transportista posterior a la etiqueta; una fecha de importación posterior por sí sola no basta.
- Los estados legacy de fulfillment usan tracking_updated_at como observación, nunca como fecha de movimiento. Si el transportista no da fecha del movimiento, también se registra como observación identificada por basis *_observed; la UI avisa que la fecha real no está disponible. No se fabrica una fecha de recogida.
- Para el corte2026-10-23T12:00Z, se conservan como históricos sin evidencia los completados anteriores con etiqueta de más de7d y sin datos de seguimiento. Es un snapshot por identidad, no una transición automática al cumplir7d. Reetiquetar/cancelar cambia la identidad y no hereda el snapshot ni pruebas antiguas.
- Insertar evidencia o histórico invalida la proyección antes de servir contadores/listas; tests de caché limpia y evento aislado.

## SQL y rollback exactos

[Transacción atómica completa](20261023-logistics-atomic-release.sql): guard de los cinco pedidos y sus etiquetas antes de instalar, esquema y [backfill](../../supabase/backfill/20261023_logistics_apply_after_approval.sql) en la misma transacción. Guard del backfill953 candidatos:362 evidencias distintas y591 históricos por owner/order. Huellaa97d5e1170f91c358cda01e4327a2f46; guard de los cinco cambios2bf159987fcade696a4dfdaa77c94ede. Ante cualquier diferencia, aborta y se repite revisión. No UPDATE de fulfillment_orders/source_status ni confirmaciones comerciales.

[Rollback completo](../../supabase/rollback/20261023_internal_logistics_state.sql): conserva hechos e históricos, revoca acciones nuevas y deshabilita triggers, fuerza fallback y restaura prepare/complete y clasificadores originales. Revertir frontend al main anterior y drenar operaciones antes del SQL. No habilitar caché hasta reconstrucción/paridad. No DROP/DELETE de hechos.

734/734 en suite completa más regresión adicional de rollback tardío;18 pruebas de posesión,20 SQL y4 de estado, build/TypeScript y contratos6/6. Revisión independiente: drifts detectados y corregidos con pruebas de paridad. Capturas24 de presentación antes/después a390/1440/2560, claro/oscuro; fuente y límites documentados en la galería. CI del código9f4b648eb18396f8183ef94f6818a133cf573585:6/6 workflows verdes,735/735 pruebas completas, integración real11/11 sin omisiones y Vercel correcto. [Recibo de CI y último preflight](20261023-logistics-possession-ci-receipt.json).

Pendiente revisión del propietario del SQL y lista corregidos. No hay autorización para ejecutar ni publicar.

Integridad de ficheros revisados (SHA256):

- docs/deploy/20261023-logistics-atomic-release.sql: `03c1c2d513b9d9f4b914ac9d909315d77596a53641e263d97f21cfadefb88c2d`.
- supabase/backfill/20261023_logistics_apply_after_approval.sql: `b7235b5e5b935f567b44489f1ea5496845de85833f306455798e2c029829839b`.
- supabase/rollback/20261023_internal_logistics_state.sql: `ecf59286d8c90c58749f2281357e7b519ad3549c9e7926a9f38dc5dd8a2964f1`.
