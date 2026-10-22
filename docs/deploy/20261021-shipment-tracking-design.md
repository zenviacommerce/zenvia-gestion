# Seguimiento fiable — diseño para revisión

Estado: propuesta arquitectónica sobre el diagnóstico del 21/10. Sin código de producto ni migraciones aplicadas.

## Resultado esperado

El propietario ve en Pedidos el último estado conocido del transportista, su fecha real y si la consulta está desactualizada. Funciona sin una pestaña abierta. Una consulta sin movimientos no hace parecer reciente el envío. Se conservan el código y detalle originales y se mantienen aislados los tenants y sus cuentas.

## Alternativas y elección

1. Solo sondeo: permite recuperar el atraso y cubre MRW; aumenta latencia y peticiones.
2. Solo webhooks: menos peticiones, pero no cubre MRW ni eventos perdidos ni el atraso actual.
3. Webhooks más sondeo acotado de recuperación: recomendado. Un único procesador idempotente recibe ambos y usa adaptadores por proveedor. No reactivar la antigua importación de pedidos Sendcloud.

## Estado y fechas

Añadir campos separados para estado normalizado, código/mensaje original, fecha del evento del proveedor, último movimiento observado, última comprobación correcta, siguiente consulta, intentos/error y revisión de la identidad del envío. Historial de eventos mínimo sin direcciones, teléfonos, POD ni payload de pedido completo. RLS por owner_id; permisos de escritura solo al servicio. Un código desconocido mantiene estado null y muestra «Sin información», no inventa En tránsito ni Incidencia.

| Estado | Presentación | Ejemplos y límites |
| --- | --- | --- |
| pre_transit | Preparado | Etiqueta creada/READY_TO_SEND; no prueba recogida. |
| in_transit | En tránsito | Recogido, SHIPPED del transportista, clasificación; preservar subtipo. |
| out_for_delivery | En reparto | DRIVER_ON_ROUTE, Envia 9, Sendcloud in_delivery. |
| delivered | Entregado | Confirmación del transportista al destinatario; no Delivered at Origin ni entrega forzada. |
| exception | Incidencia | Intento fallido/ausente, pérdida, daño, dirección, demora; pickup requerido conserva subtipo y texto «En punto de recogida». |
| returned | Devuelto | Devolución completada: Envia 11/13; un retorno anunciado conserva detalle y no se considera completado sin confirmación. |
| cancelled | Cancelado | Código inequívoco de cancelación completada; nunca por el mensaje libre ni por una solicitud pendiente. |

Information/null no establecen estado por sí solos; conservar último estado fiable y mostrar el nuevo detalle. Amazon/Shopify pueden aportar datos históricos de despacho pero no sobrescribir un estado confirmado por transportista. Distinguir expresamente la procedencia. Eventos atrasados se archivan sin hacer retroceder el estado vigente; una corrección posterior verificable del transportista sí puede sustituirlo.

Si no hay fecha del evento, mostrar «Detectado el…» y conservar fecha_evento=null. El movimiento observado solo cambia al cambiar estado/código/detalle significativo. No calcular atascos a partir de la hora de la última consulta.

## Proveedores y aislamiento

- Sendcloud v3: consulta de tracking existente, sin crear registros externos ni etiquetas. Decodificar phase/exception/sub_status de eventos de transporte; excluir eventos de reclamaciones. Validar el webhook según contrato oficial y correlación a cuenta; una notificación se usa para programar verificación autenticada, sin aceptar estados ciegamente. Configurar Event Subscriptions solo tras comprobar disponibilidad de la cuenta.
- Envia: generaltrack acotado a números activos de la cuenta. Usar ID estable de estado y conservar descripción. Webhook autenticado por cuenta; no buscar globalmente solo por tracking_number.
- MRW: adaptador SOAP TrackingService; mismo usuario y contraseña SAGEC guardados en Vault por cuenta. El gateway solo admite destino fijo y operación permitida, con las mismas defensas de autenticación existentes; nunca un proxy arbitrario. Probar primero una consulta de lectura y confirmar códigos reales/documentación de MRW. Si la cuenta carece de acceso, marcar configuración requerida y alertar sin simular éxito.
- Filas heredadas sin proveedor: resolver exclusivamente por identificadores de parcela/cuenta verificables; ambiguas quedan pendientes y visibles. No asumir Sendcloud por carrier_code=mrw.

Identidad completa: owner_id + integration_account_id + proveedor + número/ID remoto + revisión del envío. Una cancelación/reetiquetado invalida consultas en vuelo de la etiqueta anterior. Persistir con condición sobre identidad y revisión; no aplicar una respuesta a otro envío.

## Trabajador, recuperación y observabilidad

Cron cada 5 minutos; selección por next_poll_at y lease con SKIP LOCKED. Primer límite: 25 envíos por ejecución, máximo 3 llamadas concurrentes, timeout por llamada y límite de duración total. Rotación justa por cuenta y tenant; índices parciales para activos pendientes. Agrupar solo cuando el proveedor lo permita y siempre dentro de una cuenta.

Tras consulta correcta: 30 minutos para en reparto; 2 horas para tránsito/incidencias/preparado. Fallos transitorios: backoff con jitter de 5 minutos hasta 6 horas; respetar Retry-After y pausar una cuenta ante 401/403 con alerta. Entregado, devuelto completado y cancelado completado salen del sondeo; webhook posterior puede reabrir comprobación. Un envío viejo activo no desaparece silenciosamente: aviso y sondeo diario después de 45 días. No consultar entregados en cada importación Envia.

Registros sin PII: proveedor/cuenta/tenant, resultado, latencia, HTTP, cantidad, antigüedad, motivo de bloqueo. Heartbeat con inicio/fin/error, contadores de backlog y fallos consecutivos. Aviso operativo si el trabajador no completa en 15 minutos o una cuenta queda sin consultas correctas durante 6 horas. Ningún email/Slack automático hasta definir y autorizar destinatario; alertas dentro de Zenvia.

Webhooks idempotentes, autenticados y con límite de tamaño/frecuencia. Repeticiones solo adelantan la próxima consulta una vez. No activar callbacks externos hasta desplegar y verificar el receptor; el sondeo sigue cubriendo huecos.

## Pedidos y configuración

Usar @zenvia/ui, docs/design-system.md, tabla y tarjeta móvil existentes. Columna Seguimiento: etiqueta normalizada + fecha de evento/detección; detalle original accesible. Separar «Última comprobación» de «Último movimiento». Filtro Incidencias sobre estado normalizado, y filtro/aviso «Sin movimiento».

Umbral inicial configurable: 3 días naturales sin movimiento; en pre_transit desde etiqueta si no hay evento. Etiqueta de aviso explicita «Sin movimiento registrado en X días» y no afirma pérdida. Terminales fuera del aviso. Mostrar desconocidos/desactualizados sin ocultarlos del listado. Umbral en Configuración conforme a patrones existentes; no crear otra colección de configuración.

## Verificación y puesta en servicio

Tests de contratos con fixtures de cada proveedor; Delivered at Origin, DRIVER_ON_ROUTE, ausencia, cambios de fecha, mayúsculas/minúsculas/null, texto «cancelado» con código no cancelado. Pruebas de tenant/cuenta, duplicados, eventos fuera de orden, carrera de reetiquetado, leases concurrentes, timeout/429/401, detención de terminales, fecha sin movimientos, no escrituras de facturas/etiquetas/marketplaces. PostgreSQL real desechable para leases/RLS, mocks para acciones externas.

Capturas antes/después a 390/1280/1440, tema claro y oscuro, tabla/tarjetas, incidencias y desconocidos. Detener antes de publicar cambios visibles.

Preparar rollback antes de producción: desactivar únicamente cron y receptor nuevos; restaurar frontend/Edge previos y mantener el esquema aditivo e historial. Respaldo de campos exactos de las filas a reprocesar antes de cualquier actualización. Cualquier restauración de datos debe comparar revisión e identidad para no pisar movimientos legítimos posteriores.

Reproceso: primero dry-run de candidatos con conteo por proveedor/cuenta, identificación de ambiguos y SQL exacto que encole/actualice filas existentes. Mostrar ese SQL y las filas afectadas al propietario antes de pedir permiso, como exige su regla. Tras autorización: lotes pequeños, idempotentes, limitados y con conciliación final de activos, errores y desconocidos. No ejecutar la sincronización antigua de Envia, que también reconcilia/importa pedidos.
