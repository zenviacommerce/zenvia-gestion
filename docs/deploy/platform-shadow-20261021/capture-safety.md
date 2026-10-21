# Captura de sombra: aislamiento y minimización

La captura original serializaba OLD/NEW completos en variables locales para comparar; no los persistía en la cola, que recibía version_id. Aun así se sustituye por listas explícitas, para no materializar datos innecesarios. Antes de esta corrección la captura nunca se activó: fuente0eventos y central0recibos, sin transferencia de compradores.

Columnas de captura: fulfillment_orders(owner_id,order_created_at); app_users(workspace_id,active); amazon_accounts(owner_id,status); support_tickets(id,owner_id,ticket_number,type,status,priority,assigned_to,last_author_role,created_at,updated_at,last_activity_at). Solo métricas agregadas o metadatos de tickets salen en los eventos; sin asunto, cuerpo, nombres, emails, teléfonos, direcciones ni raw_payload. assigned_to es UUID interno, no nombre/email. Es minimización de datos; los identificadores internos siguen protegidos con acceso solo servidor.

El receptor rechaza campos adicionales del sobre o payload ANTES de guardar el recibo. El asunto/título de un ticket no se indexa en Platform: un futuro detalle lo obtendrá desde su instancia, autorizado y bajo demanda. La UI actual no cambia.

Captura AFTER con bloque de excepción: el fallo de sombra revierte solo esa subtransacción, guarda tabla/operación/SQLSTATE (nunca SQLERRM, CONTEXT ni fila) y retornaNULL. Si falla el propio registro, usaLOG sanitizado y retornaNULL. pg_try_advisory_xact_lock evita esperar por otro escritor de versiones de sombra; una captura omitida se registra y la reparación autoritativa la recupera. La observabilidad alerta CAPTURE_FAILURE_UNREPAIRED hasta una reparación completa cuyo inicio en reloj fuente sea posterior al fallo. El límite de paginación posterior no se usa para limpiar alertas.

Límite honesto: EXCEPTION WHEN OTHERS no convierte en infalible a PostgreSQL; no cubre caída del servidor ni cancelación de la operación de negocio. La garantía probada es que un error recuperable en la captura —y también en su logger— no aborta el UPDATE de negocio.

Tests: forzarCHECKfalse en outbox, confirmarUPDATE/COMMIT y registrar23514; forzar además fallo del logger y confirmar segundoUPDATE; inyectar columnas adicionales con un sentinel y verificar claves exactas y ausencia del sentinel en snapshot/outbox; receptor rechaza claves fuera de lista y no crea recibo. Pruebas de rollback, aislamiento, frozen retries, tombstones y frescura existentes se mantienen.

Medición pendiente: PostgreSQL producción, tablaTEMP representativa con el trigger exacto, configuración/captura en transacción revertida; comparar3000escrituras de estado con sombra desactivada/activa y500cambios de métrica, sin tocar pedidos reales.

Revisión independiente final: sin bloqueantes;9testsfuente/protocolo y11centrales. Se añaden rechazo de objetos/arrays bajo campos autorizados y prueba de fallo durante reparación/paginado. CI AuthVault detectó cron pendiente ordenado antes del núcleo tras alinear versiones reales: se renombraron únicamente los cron aún no aplicados para ordenar correctamente sus dependencias. Ningún cambio de Auth/MFA de producción.
