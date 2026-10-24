# #304 en producción — 24-10-2026

Autorización explícita del propietario recibida. CI 7/7 verde para bbf827b25a13c37401a8c29b0056a124ab3c9e38; el primer control real-auth-vault falló con HTTP502 al arrancar Edge Runtime, se reintentó solo ese control y pasó íntegro, sin saltar pruebas.

## Ejecución

apply_migration y execute_sql devolvieron Invalid or expired requestState tras sendas esperas del conector. Se comprobó tras cada fallo que la tabla no existía. No se repitió una escritura de resultado incierto. Alternativa: editor SQL del proyecto sjkxxbedkkmgmqnvaqjh, main Production. El contenido copiado del editor coincidía exactamente con apply.sql tras normalizar CRLF del portapapeles. Se ejecutó toda la selección BEGIN…COMMIT; Success. No rows returned.

Recibo de BD: completed_at 2026-10-24T07:26:25.958223Z, retained_rows549, refreshed_groups9, repair_ms686.752. Sin errores/timeout de sentencia o bloqueo. No se hizo muestreo de esperas durante esos687ms, por lo que no se afirma tiempo de espera cero. Límites lock_timeout3s, statement_timeout15s. Se registró posteriormente en supabase_migrations.schema_migrations la versión canónica20261024064200, nombreorders_purge_logistics_retention y el SQL íntegro, sin reejecutar DDL o reparación.

## Integridad y comportamiento

549 hechos privados archivados. Purgados:513shipped/36cancelled, cero pending/labelled, dirty0/stale0. Las huellas JSON de los549pedidos fuente,82invoices/330líneas,29sales_invoices/50líneas y4pickup_reports/33items son idénticas antes/después: production-verification.json. Transportista/coste forman parte de la huella de fuente. Ninguna factura, documento, correo o envío emitido.

RPC públicas como authenticated, contexto AAL2 real del propietario, timeout8s. Lanzadas en paralelo mediante el conector: workbenchPendientes147.801ms (2filas/total2), workbenchEnviados183.582ms (25filas/total943), pickupPendientes144.190ms. order_logistics_read sobre los9reparados:23.694ms, todosshipped. Son medidas de BD; no sustituyen latencia HTTP/concurrencia del navegador. Antes:workbenchPendientes141.756ms,total11.

## Publicación y revisión visual

Merge #304: main dadf8262c35dcc64f928675ebb4de122141bb788. Vercel FDkKv1dUjohVTY8g7TeRjmPS25qy, Ready/Current,49sdebuild, dominio gestion.zenviacommerce.com, finalizado07:28:24UTC(09:28:24CEST). URLinmutable https://zenvia-gestion-pbfpm4a4s-sergiorojasdiaz-7097.vercel.app . Captura production-vercel.png.

Avisado el propietario al publicar. Pestaña NUEVA del navegador conectado, sin modificar sus pestañas: Pendientes2, Etiquetados0, Enviados943, Incidencias7, Cancelados64; dospendientesreales405-3761478-6570762 y408-6864481-6961148 con selección habilitada. Captura production-pending.png recortada antes de las filas para excluir datos de compradores. Pendiente de aceptación/medición propia del propietario; no se inventa esa confirmación.

Rollback listo: rollback.sql probado restaura8funciones, quita trigger y conserva archivo sinPII (reintroduce el defecto conocido). Frontend: commit0c7c202309482a90cc48cbf8169b79cee055f636, Vercel9h5KKoGo7y7BTXcL22286d5moB3i. No se ha activado rollback.

Cron amazon-pii-purge-daily permanece activo a02:30UTC. Comprobación de solo lectura programada para25-10-2026a02:40UTC/03:40EuropeMadrid(después del cambio aCET); verificará cron, cobertura, los9y ausencia de purgados pending/labelled. No reparará ni cambiará cron automáticamente.

Lección: verificar SIEMPRE el navegador real con las llamadas concurrentes reales, además de SQL aislado. La verificación propia del propietario sigue pendiente.

Tras la publicación se retoma VERI*FACTU fase1, sin conexión AEAT, recursos Google, certificados ni facturas reales.
