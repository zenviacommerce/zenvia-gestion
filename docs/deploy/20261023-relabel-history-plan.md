# 2b aprobado: conservar expedición anterior

Decisión del propietario: mostrar transportista, tracking y fecha de cancelación, conservados tras reetiquetar. Publicación autorizada de 2b; 2c se prepara después y se detiene antes de publicar.

Se añade un historial separado del shadow de Platform: trigger append-only tras actualización del pedido, captura descriptor anterior cuando hay cancelación confirmada por timestamp/código y lo conserva al reemplazarlo. SELECT con RLS de workspace, permiso Pedidos y MFA; sin escritura para clientes. Se elimina junto con la PII del pedido. No se copian URLs, credenciales, direcciones ni datos del destinatario. Sin backfill: producción tiene 0 pedidos con label_cancelled_at y 0 operaciones de cancelación. Si faltan datos antiguos se indica expresamente.

1. Pruebas PostgreSQL: captura → cancelación → nueva etiqueta → importación, deduplicado, siguientes ciclos, aislamiento, denegación de escritura y PII; observar rojo y verde.
2. Componente de detalle carga solo historial del pedido, fallback explícito para datos antiguos, mantiene las acciones. Prueba de permanencia tras reetiquetar y borrado de PII. Capturas antes/después 390/1280/1440, claro/oscuro, cancelada y nueva etiqueta, datos sintéticos.
3. Suite, Node, build, revisión independiente y CI final verde. Captura fresca de producción y rollback antes de publicar. Migración aditiva primero, luego cuatro funciones de transporte con dependencias MFA vigentes, frontend; pruebas de producción de solo lectura. No enviar ni cancelar expediciones reales.
4. Rollback operativo: restaurar frontend B y cuatro bundles previos, conservar historial y trigger para no perder evidencia. La versión real de migración asignada por Supabase se documentará; no volver a ejecutarla por diferencia de prefijo.
