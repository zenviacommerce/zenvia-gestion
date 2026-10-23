# Hotfix autorizado: correo de informes de recogida

Estimación inicial 1–2 h. Pausar #299 y #300; no mezclarlos en main. Producción de referencia #297 ca8a595c6558356e766168fd51dd0ef78ef3ae66. Autorización explícita de publicar el hotfix tras CI y capturas.

1. Logs exactos: reserva14:13:48UTC; isolate2df4851b-554f-4b64-b465-1c25618f1cf6 terminaCPUTime14:13:51. La fila no tiene resultado. Informe sin firma, sin fila document_state: PDF generado en Edge; facturas generan en navegador. jsPDF compress:true selecciona PNG SLOW y getImageProperties procesa PNG antes de addImage. Revisión independiente y benchmark sintético:2400×1000 778→308ms y4000×1600 1638→902ms concabecera+FAST. NONE descartado:PDF9,6–25,6MB.
2. Recuperación puntual autorizada y SQL mostrado antes: exactamente1fila pasó sending→failed/EDGE_CPU_LIMIT a14:35:21UTC, conauditoría yrollback previo. El propietario revisó su buzón; elconectorGmail disponibleespersonal yno seusa comoprueba de info@. Nocorreodepruebaenviado.
3. PDF: dimensionesPNGporcabecera, FAST explícito,reutilizar imagenpordocumento,límiteantesdecode; mantenerWebPalpha sobreblanco yPDFfirmadooriginaldeStorage sinregenerar.
4. Correo: Message-ID ymailboxdurablesantesPOST,CASantesproveedor,catchporfase yestadofailed conerror_code; SQLwatchdog5min+cron1min para cierresCPU. Predispatch abortadoesreintentable; postdispatchrequiere reconciliación,sinliberaciónciega.
5. Gmailactualessolosesión(sinrefreshTokenservidor): pedirsend+readonlysoloalflujo informes; consultacuentavinculada yRFCid+cabecerapropia. Búsquedaincompleta,error,permisodenegadoocuentadistintanoprueban ausencia. Dosobservacionesvacías separadas≥60s despuésde5min;permite reintentoexplícito,nunca reenvíoautomático. ReconciliaciónalabrirconautorizaciónvigenteoacciónComprobar; sinprometerunworkerGmailpermanentesincredencialpersistente.
6. UI:copiaactivadaencadaapertura,deduplicada siTO=propietario; erroresclaros,historial conComprobar envío,reintento soloconresultadoresuelto. Capturas390/1440antes/después;inventariodeacciones,buscadores/filtros yanchodeTabs sin cambios.
7. Pruebasrojas→verdes deproveedor simulado,SQL,CPU/imagen,UI yMFA. Rollbackexactodefunciones/Edgeantesproducción;CIverde;backendprimero;mainactivaVercel;verificaciónread-only yavisoparaprueba depropietario. Nofacturas,firmas reales,PayPal,suscripcionesocambioMFA.

## Verificación previa al despliegue

- Integración con handler real + PostgreSQL local (PGlite) + Gmail simulado: envío correcto, timeout, 403 y fallo del generador. En todos se persiste resultado; repetir el request no repite el POST. MIME decodificado verifica PDF, identidad propia y ausencia de Cc duplicado.
- Revisión independiente cerrada: búsquedas incompletas nunca prueban ausencia; respuesta idempotente conserva flags; RIFF/WebP verifica frame y canvas antes del decoder, incluida cabecera engañosa y rechazo de animaciones.
- Capturas reales del componente a 390/1440 antes/después: [galería](20261023-pickup-mail-review/README.md). Proveedor simulado y red bloqueada. Copia marcada en cada apertura y comprobación sin reenviar.
- Preflight de solo lectura 15:04:54 UTC: 1 intento failed, 0 sending. Las tres funciones originales siguen con los hashes de la copia de rollback. No hay backfill de datos en esta migración.
- Limitación operativa: Gmail de la app conserva autorización de sesión, sin refresh token de servidor. El watchdog SQL garantiza salida de sending; la comprobación de Gmail ocurre al abrir con token vigente o pulsar Comprobar envío. Si Google deniega lectura o se selecciona otra cuenta, se conserva el resultado incierto y se pide corregir autorización. Nunca se interpreta como ausencia.

Validación final local: 770/770 pruebas Vitest (131 archivos), 1292/1292 pruebas Node (incluidos inventarios de acciones, buscadores/filtros y Tabs), build de producción y comprobación Deno correctos. Capturas: 10 PNG, cero errores de navegador y una sola llamada simulada de envío por escenario. No se ejecutó correo real. Revisión independiente sin bloqueos pendientes.

## Preparación de producción

PR #301: `1a2aa517e4f31c1e8230123ca2f86898a42e2b5a`. Se subieron exclusivamente 35 archivos del hotfix sobre main; las bases de los 11 archivos modificados coinciden exactamente con main. No se mezcló #298 ni #299.

Rollback frontend preparado: restaurar deployment Vercel `dpl_6QnGEy8hmRSpfnh7Z3BijStzdMse` (URL `zenvia-gestion-q2xg52tkg-sergiorojasdiaz-7097.vercel.app`, main `ca8a595c6558356e766168fd51dd0ef78ef3ae66`). Antes de downgrade backend, ejecutar el guard de `supabase/rollback/20261023_pickup_mail_recovery.sql`: aborta con sending o reconciliaciones pendientes y conserva hechos/auditoría. Edge: restaurar los nueve archivos exactos de v3 de la snapshot con `verify_jwt=true`. Nunca restaurar a ciegas el sending del incidente si ya se reintentó.

Preflight Edge: v3 ACTIVE, verify_jwt=true y nueve archivos sin cambios desde snapshot. Solo se sustituirán cuatro helpers del informe y se añadirá pickupMailRecovery; entrypoint, autenticación, MFA y vendor idénticos. MFA a15:08:39UTC: enabled=true,cohorte=1,solo propietario, sin cambios.

Se prepara además un preflight transaccional (`20261023-pickup-mail-production-preflight.sql`) que aborta si cambian las tres definiciones originales, el único intento del incidente ya liberado o la configuración del piloto MFA. Se ejecutará como prefijo de la migración; contiene únicamente comprobaciones, sin cambios de pedidos ni de facturas.

## Backend publicado · 15:14 UTC

CI #301: seis workflows success en el commit exacto `1a2aa517e4f31c1e8230123ca2f86898a42e2b5a`. Preflight transaccional correcto a15:14:42 UTC, sin cambios. Migración `pickup_mail_recovery_hotfix` aplicada; sin backfill ni cambios en pedidos. Edge desplegada v4 ACTIVE, verify_jwt=true, hash de bundle `39e1a7d00ead601a21a94ba400c3d676ebcae605d3cdcfe86a45235c9d65036f`. Se mantiene autenticación/MFA original.

Verificación backend a15:15:16 UTC: archivos exactos desplegados; watchdog `* * * * *` activo; seis RPC de correo con EXECUTE denegado a anon/authenticated y permitido a service_role; MFA enabled=true/cohorte1/solo propietario. El único intento sigue failed/EDGE_CPU_LIMIT/reconcile_required=false. La RPC context confirma que ya no bloquea un reintento.

PR #301 integrada por squash: main `5db28e2e721bfeb75a6cc4b4d38d8c63f128529c`. Pendiente comprobar deployment/alias Vercel antes de avisar al propietario.

## Frontend publicado y comprobación operativa

Vercel producción READY: `dpl_84q6V8ePQ25hYYDYE6XEiz8UsPot`, commit `5db28e2e721bfeb75a6cc4b4d38d8c63f128529c`, URL `zenvia-gestion-5qf91gqb6-sergiorojasdiaz-7097.vercel.app`, alias `gestion.zenviacommerce.com`, sin aliasError. Build 48,9s.

Edge real sin credenciales: OPTIONS200, POST401 por falta de autorización. Logs desde15:14:40 muestran boot60ms y esas dos solicitudes, sin error de ejecución; no prueban un envío autenticado. Watchdog cron succeeded a15:15 y15:16 UTC (12–21ms). Su return_message «1 row» es la fila devuelta por SELECT, no una modificación de correo. El envío completo está probado con proveedor simulado, no con Gmail real.

HTTP de producción: HTML200 y bundle index-By4wrXKI.js200. El modal y servicio son chunks lazy separados: PickupDocumentDialog-DIdezBg2.js y pickupReportDocuments-BsFvrUV3.js, ambos200. Confirmados en runtime los textos Comprobar envío/Estado del informe/Pendiente de comprobar y action reconcile_mail. [Recibo](20261023-pickup-mail-review/production-http-check.json). El primer chequeo del index no encontraba los marcadores por estar en chunks lazy; no era un fallo de publicación.

Avisado el propietario para recargar y reintentar REC-2026-0004; copia por defecto y sin duplicado al enviarse a sí mismo. Se le indica que Google puede pedir lectura y que debe elegir el mismo buzón. No se ha enviado correo real desde esta sesión. Retomado #299; #300 permanece en diseño para revisión.
