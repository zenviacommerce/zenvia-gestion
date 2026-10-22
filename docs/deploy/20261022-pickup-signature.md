# Firma y correo de recogidas — diario B

Estado: desarrollo local en feature/pickup-report-signature-20261022, dependiente de A. Sin publicar ni desplegar migraciones/Edge.

## Paso 1 — evidencia y diseño

Estimación B: 6–10 h. Consulta de solo lectura confirma 3 informes existentes y snapshots inmutables. Se guardan definiciones exactas de get/list y sus implementaciones privadas en supabase/snapshots/20261022-pickup-signature-baseline.json. No se leen datos de conductores ni se modifica producción.

Plan: 20261022-pickup-signature-plan.md. Firma separada por transportista; inmutabilidad por firma y estado Firmado al completar todas. Correo reutiliza Gmail de facturas comerciales. Propuesta de retención configurable inicial 60 días pendiente de revisión del propietario antes de publicar.

## Paso 2 — fundamentos y pruebas

- PDF: renderer único compartido navegador/Edge, mantiene compacto el informe sin firma. Tests rojos y verdes con firma solo en su transportista, sello en su recuadro y bultos reales diferenciados; 10/10 comprobaciones focalizadas de PDF.
- Canvas: pointer events, captura, retina, conservar trazos en resize, Borrar y tap accidental rechazado; 2/2 tests tras implementación. Queda captura táctil real.
- Gmail: builder MIME compartido con factura, CC opcional y rechazo de inyección; 5/5 tests. No se envían correos.
- Modelo SQL: tablas privadas con RLS, RPC solo service_role revalidan actor/owner/permisos, lease e idempotencia, estado parcial/firmado, anulación y auditoría sin DNI ni firma. Reserva de correo atómica con 10/h y 100/día/workspace, 3/h/destinatario; respuesta incierta no se reenvía con la misma solicitud.
- Purga: API Storage antes de vaciar PII, cola con leases, firmas sin sobrescritura y hashes/auditoría conservados; sin lectura de PNG por authenticated. 6/6 pruebas PGlite del núcleo/correo/aislamiento/purga. Se refuerza la exclusión con firma reanudada para impedir retirar un artefacto activo.
- Edge, UI, cron, rollback y galería de B todavía en preparación. A permanece en borrador #289/#82; se corrigió su comprobación financiera histórica sin alterar UI.

## Decisiones del propietario incorporadas antes de continuar B

Estimación revisada: 8–12 h. Informes nuevos independientes por transportista; selección mixta atómica, numeración correlativa y resumen con accesos. Históricos mixtos sin cambios ni renumeración. Se ajustan pertenencia, historial, filtro y avisos.

Retención configurable 365 días. Solo se retiran DNI/matrícula e imagen de firma; se conserva el resto y un PDF reducido. El PDF completo incrusta esa PII: se debe reemplazar por la versión reducida y retirar todas las copias completas anteriores. Purga desactivada por defecto, sin cron activo. Antes de cualquier activación se presentará recuento y SQL para autorización. La propuesta previa de 60 días y borrado general queda descartada. Las pruebas de esa propuesta son evidencia de desarrollo, no aceptación de la política final.

## Paso 3 — decisiones verificadas en desarrollo

- Nuevo RPC humano con MFA/manifest: crea en una transacción un informe por transportista, conserva reintentos por lote y protege todos los nuevos snapshots frente a mezcla de transportistas. Pruebas 3/3: correlativos, atomicidad, reintento después de cambiar pedidos, histórico intacto y aislamiento/MFA.
- Retención final: 365 días, configuración desactivada y sin cron. Prueba SQL exige guardar el PDF reducido antes de retirar los objetos completos; conductor y resto del informe se conservan. El worker genera y verifica hash de esa versión antes de borrar. 7/7 pruebas SQL de firma/retención y 6/6 PDF/worker.
- Interfaz con @zenvia/ui: confirmación con accesos por transportista, firma, correo pendiente/firmado, resultado incierto sin reenvío automático, anulación y nueva creación; 11/11 pruebas focalizadas. DNI y PNG se vacían de la pantalla tras firmar.
- Columna/filtro de Pedidos: transportista y estado, filtros pendientes/firmados/anulados y sin informe activo; los anulados permanecen consultables y dejan de bloquear otro informe.
- Quedan galería, validación completa, revisión independiente y recibos finales. Nada aplicado ni publicado en producción.

## Paso 4 — revisión y evidencia visual

Galería 20261022-pickup-signature-review: 80 capturas de aplicación, antes/después a 390/1280/1440 en claro/oscuro, más dos PDF sintéticos y sus renders. Dedo mediante eventos táctiles nativos de Chromium a 390/DPR3; el scroll del documento/panel no cambia. El PDF reducido conserva conductor, envíos, bultos, fecha, número y sello, sin DNI ni firma. Cero correos reales.

Revisión independiente detectó dos casos y confirmó sus correcciones: sello ilegible ahora impide firmar; reintento desactualizado de histórico mixto requiere solicitud nueva en vez de sobrescribir PDF. 19/19 pruebas independientes de SQL/PDF/Edge correctas. Se añaden pruebas de envío Gmail con proveedor sintético y rechazo antes del envío por cuota/permisos.

Build de producción correcto. Deno 2.9.6 comprueba ambas nuevas Edge Functions. Rollback operativo preparado en supabase/rollback/20261022_pickup_document_read_only.sql: bloquear altas/firma/correo, conservando lectura y prueba firmada. Tras existir firmas no se vuelve a una UI que regenere PDF sin detectar la prueba guardada. No se activa la purga ni se ejecuta SQL de rollback.

## Paso 5 — cierre de revisión funcional

La suite completa alcanzó 620/620 Vitest. La revisión final encontró caché de PDF pendiente tras firmar y cambios del PNG al girar el móvil tras un fallo. Corregidos con descarga siempre desde el estado actual del servidor, sin fallback a PDF sin firma, y payload congelado por solicitud; el canvas desactivado puede redibujar sin emitir otro PNG. Regresiones rojas y verdes: 16/16 UI/descarga/canvas/Edge; 9/9 Edge tras añadir PDF firmado y branding opcional. El gate global detectó un select nativo de históricos y se cambió a SelectField; 8/8 comprobaciones Node focalizadas correctas. Queda confirmar CI global del borrador.

A: seis comprobaciones de Gestión y una de Platform en verde; recibo de heads y enlaces guardado. No se publica A ni B.

## Corrección final del rol de diálogo detectada por CI visual

CI 39860351677 completó las capturas de Pedidos sin pérdidas, pero el test de abrir/cancelar informe encontró el role=dialog en un wrapper sin área visible alrededor del FormModal fijo. Se coloca el rol y su nombre accesible en la superficie .modal real mediante el hook de formulario, manteniendo foco, Escape y trapping. Prueba roja/verdes de host de rol y 12/12 UI focalizadas; galería completa regenerada con aserción de diálogo visible en navegador (62 capturas/68 checks). No se relajó la comprobación de CI ni se publicó nada.
