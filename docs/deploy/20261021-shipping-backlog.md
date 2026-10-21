# Registro del propietario y backlog — 21 octubre 2026

Solo documentación. NO implementar ahora. Orden: terminar lote A y lo acordado Platform → MFA → Amazon; después diseñar estas mejoras.

## Corrección manual ya realizada por el propietario

Pedido Amazon `407-0024766-5208363`, fulfillment_orders.id `87872d37-5b80-4982-a643-6faf631243b6`. Etiqueta Envia/CTT Express `0048150011299700011804` cancelada en Envia.com. El propietario generó una etiqueta MRW en Sendcloud fuera de Zenvia.

Según informa el propietario, se actualizó por SQL: carrier MRW; shipping_provider sendcloud; tracking y shipping_remote_id `01009F045746`; tracking_status_code READY_TO_SEND; label_created_at now(); coste NULL (estimación por tarifa 5,15 €). No se tocó amazon_tracking_synced_at porque el propietario ya actualizó Amazon. Este registro no ejecuta ni repite esa corrección ni afirma verificación independiente.

## Pendientes: diseño primero

1. Registrar envío externo en el detalle: transportista, servicio, seguimiento y coste opcional, auditado. No reenviar tracking a Amazon salvo indicación explícita.
2. Permitir reetiquetar tras cancelación local o comunicada por transportista; hoy el pedido puede quedar bloqueado.
3. Cancelar envío desde Zenvia para Envia, Sendcloud y MRW directo, con estado correcto y posibilidad de reetiquetar.
4. Seguimiento: derivar estado visible del código normalizado; no interpretar la palabra «cancelado» en texto libre cuando el código indica otro estado.
5. Eliminar pedidos mediante papelera lógica, motivo y auditoría, restaurable durante un plazo por definir. Bloqueo o advertencia fuerte para Amazon/Shopify vivos (reimportación por sync), etiquetas activas, informes de recogida y facturas. Nunca borrado físico desde UI.
