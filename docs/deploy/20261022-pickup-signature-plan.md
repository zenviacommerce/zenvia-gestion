# B — Firma y correo del informe de recogida

Estimación revisada tras decisiones del propietario: 8–12 h. Rama independiente basada en A; ambas entregas se detienen antes de publicar. No se crean documentos ni envíos reales.

## Hallazgos y diseño

- Cada informe nuevo corresponde a un solo transportista, con número correlativo REC-año-XXXX, firma, estado Pendiente/Firmado/Anulado y correo independientes. Una selección mixta crea todos los informes en una única transacción idempotente y muestra transportista, número y acceso a cada resultado. Los históricos mixtos permanecen íntegros, sin dividir ni renumerar; su renderer conserva las partes originales. Historial, columna/filtro de Pedidos y avisos de pertenencia identifican cada informe y su estado.
- Firma desde historial y desde el informe recién creado. Conductor/a, DNI o matrícula, fecha/hora local es-ES por defecto ahora y bultos reales. Discrepancias con los bultos originales explícitas en pantalla/PDF. El snapshot de envíos nunca se edita.
- Canvas pointer events, captura del puntero, touch-action:none solo en el lienzo, retina y reescalado sin perder trazos. Borrar/Firmar, guardia de doble envío y aviso de inmutabilidad.
- Sello configurado del remitente añadido en servidor. Si no existe, la firma pide configurarlo; el informe sin firmar sigue disponible. PDF generado en servidor desde snapshot y firmas, sin aceptar PDF arbitrario del cliente.
- Ante error, anulación con motivo y auditoría; crear nuevo abre el flujo normal con los pedidos y decisión explícita de duplicado. Sin editar o reutilizar la firma anterior.

## Persistencia y seguridad

Tablas privadas con RLS para estado, firmas, operaciones y correo. Sin escritura directa de authenticated. Edge comprueba usuario, MFA y permiso orders mediante helper existente; RPC service-only revalida owner/actor/acceso. Lecturas del workspace tras RPC humano MFA-gated. Sin ampliar piloto ni modificar Auth.

Storage privado pickup-report-documents, claves bajo owner/report UUID sin nombres/DNI. PNG y PDFs inmutables con hash, sin upsert ni URL pública ni exposición en Platform. Serialización por informe y requestId idempotente; firma concurrente no sobrescribe otra. Firmado tras persistir PDF; recuperación con misma operación.

Correo: las facturas comerciales usan Gmail, no el mailer central de suscripciones. Se reutiliza autorización/MIME de Gmail; Edge envía solo adjuntos del informe del workspace. Destinatario libre validado, CC del propietario resuelto en servidor, asunto/texto predeterminados. Reserva atómica de límites por workspace/destinatario, registro de resultado y respuesta incierta sin reintento ciego. Sin correos reales en tests.

Retención aprobada: 365 días por defecto, configurable. Al vencer se borran únicamente DNI/matrícula e imagen de firma. Se conservan conductor/a, número, transportista, envíos, bultos, fechas, estado, sello corporativo y auditoría. Como el PDF completo también contiene los datos a retirar, primero se guarda una versión sin DNI/firma y después se eliminan todos los PDF completos y PNG de firma anteriores, mediante Storage API. Se conservan sus hashes como evidencia. La versión reducida sigue disponible. No se borran ni renumeran históricos.

Purga DESACTIVADA por defecto tanto en configuración como en programación. Antes de autorizar su activación se mostrará el recuento de informes, firmas y objetos afectados, y el SQL exacto de activación; no se ejecutará ningún borrado ni limpieza automática antes de esa autorización. La migración no instala un cron activo.

## Pruebas y entrega

1. Tests rojos de PDF firmado (carrier/sello/datos/paginación), canvas (pointer/retina/borrar) y MIME (adjunto/CC/headers).
2. PGlite: permisos/aislamiento, estados, idempotencia, carreras/lease, inmutabilidad, anulación, límites de correo y purga. Handler con Storage/Gmail sintéticos y fallos intermedios.
3. UI @zenvia/ui, inventario de acciones, historial/recién creado/firma/firmado/anulación/correo. Capturas desktop/móvil, gesto táctil a 390 y PDF firmado sintético renderizado.
4. Builds/suites, revisión independiente, borrador PR dependiente de A, recibos y rollback. DETENERSE antes de publicar.

## Rollback preparado

Funciones actuales en supabase/snapshots/20261022-pickup-signature-baseline.json. Rollback operativo: revertir UI y deshabilitar mutaciones Edge conservando firmas/PDF/auditoría. Rollback completo de esquema solo sin datos nuevos; abortar si existe cualquiera. Nunca purgar informes para facilitar rollback.
