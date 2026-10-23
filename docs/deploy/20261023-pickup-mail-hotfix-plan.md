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
