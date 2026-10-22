# Seguimiento de envíos — ejecución del diseño #278

Catálogo previo publicado: Platform #81 (7552bd7) y Gestión #277 (4a26892), CI verde. UI real mensual y anual comprobada, 6/6 verificaciones PayPal MATCH en Sandbox; 2 suscripciones con la misma huella antes/después. Puesta Live en backlog de Platform.

## Alcance y decisiones

- Backend de seguimiento separado: adapta MRW, Sendcloud v3 y Envia generaltrack a estados comunes; solo consulta envíos con cuenta y propietario verificados.
- Modo sombra: escribe únicamente tablas shipment_tracking_*; jamás pedidos, etiquetas, importadores o confirmaciones de Amazon/Shopify. UI y RPC de presentación requieren publicación posterior, retenida.
- Revisión de identidad completa incluye cuenta, propietario, proveedor, número, ID remoto y fecha/cancelación de etiqueta. Una respuesta atrasada tras reetiquetar se rechaza.
- Fecha del evento independiente de última consulta y primera detección. Si el proveedor no da fecha real, se muestra «Detectado», nunca se sustituye por la hora de consulta. MRW Fecha es fecha del envío: solo FechaEntrega/HoraEntrega permiten fechar entrega confirmada con este contrato.
- Datos originales: código y descripción limitados a 120/500 caracteres; no se guarda el payload con direcciones, teléfonos o POD. Los errores registrados son códigos internos.
- Límite 25 por ejecución; 3 cuentas concurrentes, cada cuenta secuencial; timeout 12s, ejecución 100s, leases 3min, backoff 5min–6h, pausa de 6h en credenciales/401/403, Retry-After respetado. Terminales salen del sondeo; activos de más de 45 días pasan a diario. Rotación por cuenta en SQL.
- No se reactiva el importador de pedidos Sendcloud: la recuperación se limita a seguimiento. Se comprueba disponibilidad de Event Subscriptions antes de configurar el webhook.
- MRW: comprobación de presencia (sin revelar secretos) confirma trackingPassword ausente en la cuenta activa. Requiere acceso al servicio SeguimientoNumeroEnvioMRWNacional (Franquicia/Cliente/Password), distinto de SAGEC. No se reutiliza la contraseña SAGEC silenciosamente.

## Preflight de producción (solo lectura)

1017 pedidos, 708 con código DELIVERED. Candidatos brutos no terminales con número: MRW 54 (7 sin cuenta); Sendcloud 44; Envia 2; proveedor heredado null 90 (74 sin cuenta). Este recuento no autoriza asignar cuentas por defecto: el seeder solo incorpora identidades verificables. El subconjunto antiguo MRW de 33 del diagnóstico no es el total actual.

## Puesta en sombra y rollback

1. Aplicar únicamente shipment_tracking_shadow, inicialmente enabled=false. Conservar respaldo privado de campos de seguimiento para comparación, sin datos de destinatarios.
2. Desplegar shipment-tracking-worker con verify_jwt=false y validación interna de apikey de servicio antes de cualquier lectura. No cambiar MFA ni otros endpoints.
3. Habilitar exclusivamente el interruptor nuevo, primera ejecución supervisada y verificar digest de tracking original sin cambios.
4. Cron nuevo cada 5 minutos, clonado del comando interno autorizado existente de amazon-sync-worker sustituyendo solo el endpoint. No imprimir secretos ni alterar el cron original.
5. Rollback: enabled=false y cron.unschedule('zenvia-shipment-tracking-shadow'). Mantener tablas e historial aditivos. No se necesita restaurar pedidos porque el trabajador no los modifica.

Pendiente de publicar: toda UI, modelo de lectura y reproceso efectivo de pedidos. Antes de cualquier aplicación mostrar el recuento de diferencias del modo sombra, excluir entregados y comprobar identidad nuevamente.

## Recibo de sombra y revisión

- Esquema aditivo, worker v5 y webhook v1 desplegados. El modelo de lectura/UI NO se ha aplicado/publicado.
- Interruptor enabled=true en modo shadow. Cron zenvia-shipment-tracking-shadow cada 5 minutos; sigue ejecutándose sin Pedidos abierto.
- Sendcloud Event Subscriptions disponible (GET 200). Conexión 48067, suscripción 47879; broadcast de prueba autenticado 200. Solo despierta consultas de una cuenta y número activos; rechaza eventos claim, duplicados, exceso de tamaño y terminales. No acepta estados del payload como autoridad.
- Lotes supervisados: primer lote 25 (2 Envia correctos, cuentas pausadas por configuración), tras corregir carga de claves del servidor Sendcloud 25/25 y 21/21 correctos. Último ajuste Envia 1/1; no se consultó el Envia ya entregado.
- 48 estados recuperados: 42 entregados (41 Sendcloud + 1 Envia), 4 incidencias y 1 en reparto Sendcloud, 1 en tránsito Envia. Los 46 Sendcloud incluyen fecha real del evento; Envia activo conserva 2026-10-21 20:16:11 sin zona, expresamente sin inventar UTC. El Envia entregado conserva su primera detección y no se volvió a consultar.
- 47 MRW con identidad verificable quedan pendientes de trackingPassword. Heredados sin cuenta/proveedor verificables no se asignan silenciosamente.
- Comparación del respaldo: 0 cambios en campos originales de seguimiento de pedidos durante todas las ejecuciones supervisadas. Los 708 pedidos con código DELIVERED inicial no entran en el sondeo.
- Vista previa del reproceso: 48 pedidos obtendrían estado/fecha/detalle del transportista al publicar el modelo de lectura, de ellos 42 dejarían de aparecer activos. Recuento debe repetirse justo antes de autorizar/aplicar la UI; no es un UPDATE de estados originales. Los ya entregados quedan excluidos.
- Capturas sintéticas: 6 antes + 12 después (claro/oscuro, 390/1280/1440, lista y filtro de incidencias), 0 red externa efectiva y 0 errores. Banderas sustituidas por un recurso local gris, sin consultar CDN. No constituyen E2E autenticado de seguimiento; catálogo sí comprobado en producción (captura adjunta).

Revisión independiente: dos hallazgos importantes, ambos reproducidos RED→GREEN antes de entrega. El RPC real de Pedidos es orders_dashboard_pickup_v1: se parchea únicamente su implementación privada y se prueba la selección de 60 filas/paginación y la huella intacta del wrapper MFA. La lectura directa de sombra exige además identidad vigente y pedido sin purgar; la migración propuesta añade un trigger de borrado de estado/historial al purgar PII, evita reseeding y añade cascada del historial al borrar el pedido. **Esta migración de privacidad fue DENEGADA y NO está aplicada**; su SQL completo se ha mostrado en la conversación y requiere aprobación explícita. Recuento al presentar: 0 eventos y 0 estados se borrarían inmediatamente. No se ha publicado la UI vulnerable ni alterado el wrapper de MFA.

Pendiente de aprobación: la migración de privacidad (por separado), y después aplicar shipment_tracking_ui_release y publicar el frontend de esta rama. Mantener el resto del backend en sombra. MRW requiere la contraseña/acceso descritos arriba antes de poder verificar el contrato real y códigos de la cuenta.


## Prioridad alta: consumo antes de publicar seguimiento

Ver [plan de reducción de consumo](20261022-compute-cost-plan.md). La publicación del catálogo ya ha terminado. Esta prioridad se intercala con las correcciones de revisión, antes de publicar la UI de seguimiento.

Corrección local de frontend: un único temporizador de lectura por pantalla con intervalo mínimo de 60 s, solo con documento visible. La suscripción a fulfillment_orders se filtra por workspace y se desconecta al ocultar la pestaña; callbacks de cuentas anteriores se ignoran. Se serializan lecturas y se agrupan eventos. Pedidos y Dashboard dejan de lanzar sincronizaciones periódicas de transportistas desde el navegador. Se conserva la sincronización manual. Broadcast y optimización SQL siguen pendientes del plan; no se afirma cumplido el objetivo de 50 ms.


## Correcciones encontradas por CI del PR #279

- La fixture visual anterior simulaba trackingPresentation y devolvía undefined. Se conserva ahora el módulo puro real, igual que orderStatus/formatting, sin alterar el producto.
- El ensayo real de MFA detectó que la política restrictiva de lectura propuesta no usaba el nombre esperado por private.mfa_activation_findings. La migración UI (todavía NO aplicada en producción) define mfa_select_gate, mfa_insert_gate, mfa_update_gate y mfa_delete_gate. Solo conserva GRANT SELECT; escrituras sin concesión ni política permisiva. Prueba adicional ejecuta el auditor real y exige cero hallazgos para shipment_tracking_state. No se toca el auditor ni se relajan sus comprobaciones.
- La migración de privacidad denegada permanece exactamente igual al SQL presentado. Ninguna de estas correcciones se ha aplicado en producción.
