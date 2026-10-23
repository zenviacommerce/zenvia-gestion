# 2b — historial persistente y publicación autorizada

Propietario confirma A/B en producción y aprueba 2b con transportista, tracking y fecha de cancelación anteriores visibles tras reetiquetar. Estimación inicial45–60min.

## Evidencia y decisiones

Producción previa main64a09358, MRW25/Envia45/Sendcloud-orders35/tools37. Cero operaciones de cancelación y cero pedidos con label_cancelled_at. Sin backfill ni reprocesado; no se actualizan los1023pedidos existentes. Nueva tabla separada de Platform shadow, con RLS workspace/permiso pedidos/MFA, escritura cliente denegada, limpieza al purgar PII del pedido.

Se prueban captura anterior→limpieza→nueva etiqueta→sincronización, deduplicado, siguiente ciclo y permisos/PII. Rojo observado por migración ausente, verde posterior. Componente: permanece tras cambio de etiqueta, ausencia explícita de datos antiguos, ocultación con PII.

Revisión independiente detecta único P2: valores NULL podían interpretarse como cancelación. Dos regresiones rojas lo reproducen y pasan al usar coalesce(boolean,false). Sin otros hallazgos. Pruebas focales finales8/8. Se cualifica explícitamente order_shipment_history.order_id en RLS; fixture incluye el order_id text real del pedido.

[Galería](20261023-relabel-history-review/README.md): cancelada y nueva etiqueta a390/1280/1440 claro/oscuro. Se conserva el inventario completo de acciones; inspección visual móvil después de reetiquetar correcta. No se inventan datos de referencias antiguas perdidas.

Los cuatro bundles de despliegue se construyen desde las dependencias frescas de producción, sustituyendo solo los cuatro entrypoints de2b y el helper de elegibilidad. Se comprueba igualdad byte a byte del entrypoint previo con la base revisada y se conserva MFA de producción. Deno2.9.6 verifica los cuatro bundles reales. Build correcto.

## Rollback

Snapshots completos: supabase/snapshots/20261023-relabel-before-publication. Restaurar los cuatro bundles con verify_jwt=true y frontendB dpl_9K2RvEJdTVrnMUKhA2u3t7Qv9GNw. Conservar tabla/trigger de historial para no perder evidencia ni detener su purga PII; no hace falta DROP, DELETE ni UPDATE de rollback. B permanece como lector de informes firmados.

No se invocan operaciones comerciales reales en pruebas. No se cambia MFA, PayPal, suscripciones ni informes existentes. La purga de informes sigue desactivada.
