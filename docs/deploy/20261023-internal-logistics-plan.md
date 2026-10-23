# Estado logístico y firma verificable — recuperación

Especificación: instrucciones del propietario del 23/10/2026 y `20261023-owner-next-logistics-state.md`. Ejecución autorizada hasta revisión, sin publicación.

Rama recuperada: `feature/internal-logistics-state-20261023`, base `fa17966`. No había implementación de B, únicamente dos snapshots SQL y un preflight. A ya está implementada en #294: se conserva y se vuelve a verificar.

## Diseño y decisiones

Estado comercial y salida física independientes. Registrar la primera evidencia por identidad exacta de etiqueta (misma identidad que seguimiento: propietario, cuenta, proveedor, tracking, referencia, parcela, creación y cancelación). Tabla privada inmutable de salidas con fecha, causa, actor y referencia al informe cuando corresponda. Las cancelaciones y sustituciones cambian la identidad y no heredan una salida anterior.

Fuentes: firma efectiva sin retiradas; movimiento normalizado de esa identidad; acción manual individual/masiva validada en servidor con permiso Pedidos, alcance del workspace y comprobación MFA existente. Ninguna modificación del piloto ni de la confirmación de Amazon/Shopify.

Reutilizar la proyección y su fallback, cambiando su clasificación a la misma evidencia. No deducir salida de texto libre ni de `source_status`. Incluir fecha y causa en las respuestas. Aviso de almacén con `settings.orders.overdueHours` (24 por defecto).

## Pasos y estimaciones

- [x] 1. Recuperar rama, inventario y preflight de solo lectura (20–30 min). Snapshot de clasificadores y funciones recuperado. Primer recuento físico, sin deduplicar: 1.024 filas; 368 etiquetas activas sin purga, 115 con movimiento de identidad y 253 sin movimiento/firma (Amazon 248, Shopify 5). Es un candidato preliminar, NO el recuento final de migración ni evidencia de que los históricos sigan en almacén.
- [x] 2. Pruebas y persistencia SQL por generación, firma/seguimiento/manual y aislamiento (2–3 h). Probar firma retirada, cambio de etiqueta, evento tardío y permisos.
- [x] 3. Clasificador SQL/proyección y cliente, fecha/causa, acción individual/masiva y aviso con componentes compartidos (1–2 h). Pruebas de paridad de contadores/paginación/selección.
- [x] 4. Backfill separado, recuento exacto y rollback preparado (45–60 min). No ejecutar en producción.
- [x] 5. Suites, build y revisión visual 390/1440/2560 del flujo sintético completo (1–2 h). Inventarios compartidos de acciones, búsqueda/filtros y ancho. Detenerse antes de publicar.

## Riesgos que deben demostrar las pruebas

- Una firma de un informe anterior nunca despacha una etiqueta nueva, incluso con tracking reutilizado.
- Una línea retirada queda Etiquetada salvo evidencia independiente de recogida.
- Una confirmación del marketplace no despacha el paquete.
- El primer evento conserva su fecha/causa ante reintentos y eventos posteriores.
- Selección masiva con un pedido ajeno o identidad obsoleta falla atómicamente.

## Diario

Recuperación: ningún cambio en producción. Changelog Supabase recuperado y documentación oficial de funciones/RLS consultada. Se reutilizan dependencias locales existentes; no se instalan versiones nuevas.


Recuperación y diagnóstico cerrados. La cifra preliminar de 253 sin movimiento se descartó al incorporar estados históricos del transportista y deduplicar. Recuento canónico final de solo lectura: 1.007 pedidos; 10 pasan de Enviados a Etiquetados (8 Amazon, 2 Shopify), 933 conservan Enviados, 64 Cancelados. Se conservan 577 históricos canónicos sin etiqueta local, sin inventar fecha de salida ni causa. Datos a insertar en el backfill: 356 evidencias y 591 filas históricas físicas (incluyen duplicados del canal).

Revisión independiente: corregidas cancelación normalizada en acción manual, cancelación histórica en clasificación, respuesta tardía de otro workspace, acción manual indebida sobre un histórico sin etiqueta y rollback de proyecciones. Resumen usa ahora el mismo clasificador común; regresión observada en rojo y corregida. Lectura directa de Resumen enriquecida por RPC con los mismos permisos y MFA existentes.

Release atómico ejecutable preparado: la migración sola se rechaza; schema y backfill van en una transacción y el guard de recuento/huella fuerza nueva revisión si cambian datos. Rollback preserva las evidencias y fuerza fallback hasta reconstrucción y paridad. Nada ejecutado en producción.

Verificación local final: suite completa 707/707 y regresión adicional de autorización de metadata; suite específica 26/26. Node 1.292/1.292; inventarios comunes 14/14, TypeScript/build correctos. 110 capturas sintéticas; pruebas de la firma, retirada, acción individual/masiva y fence de workspace en las seis combinaciones. Galería inspeccionada a 390. Pendiente exclusivamente CI de la PR y revisión del propietario; cero escrituras de producción.

Reproducción de alta de tenant: se añadió una regresión que vacía únicamente el esquema sintético y reproduce todas las definiciones. El bloqueo del esquema aislado se limita a bases con pedidos existentes; una base vacía puede reproducir las migraciones sin backfill histórico. Se mantiene intacto el bloqueo de producción con datos. No se modificó ningún workflow ni configuración MFA.

Revisión del propietario: A+B aprobadas con dos mejoras previas a publicación (estimación 45–75 min). Se pasa la lista de comprobación al primer bloque del modal, sin scroll interno; el total declarado se deriva de las líneas comprobadas y se reinicia al marcar/desmarcar/retirar, con edición y aviso de discrepancia. El PDF existente conserva ambos totales; ya no se fuerza su igualdad en prepare/complete. Se mantienen IDs exactos, revisión, generación y validación numérica. SQL y diez pedidos se presentarán para aprobación antes de cualquier escritura.

Diagnóstico de CI ac0fbbf: todas las migraciones se reproducen correctamente en el Supabase desechable; falla el guard mfa_activation_findings porque las dos RPC aditivas no tenían el wrapper/manifest estándar. Se reproduce en rojo con la prueba de registro de ambas RPC y se aplica el mismo patrón que pickup_report_*; no se altera la configuración, cohorte ni funciones MFA existentes. Regresiones de UI en rojo para orden y total declarado, y SQL para la discrepancia explícita. Pendiente validación final y nuevas capturas.

Verificación de la revisión: 715/715 en la suite completa, 27/27 específicas (SQL19/UI6/PDF2), build/TypeScript correctos y contratos de Pedidos 6/6. Revisión incremental independiente sin bloqueos. Flujo72 capturas en seis combinaciones; 18 capturas previas del modal preservadas. Inspeccionadas lista y aviso a390. Consulta de solo lectura vuelve a devolver los mismos diez IDs: `20261023-logistics-ten-orders.json` y SQL de consulta asociado. Sin escrituras de producción. Pendiente CI del nuevo commit y aprobación del SQL exacto antes de publicación.

Revisión rechazada por el propietario: el preflight anterior de diez pedidos queda INVALIDADO; no se autorizó ni ejecutó. La regla omitía exception/returned como posesión física y descartaba todo el fallback MRW. Producción confirma los cuatro casos señalados y otro RETURNED_TO_SENDER. Nuevas regresiones anonimizadas en rojo antes de corregir; prueba adicional de evento aislado detecta caché sin invalidación. Se amplían triggers de estado/evento/raw, siempre por identidad; se encola invalidación al insertar evidencias o baseline. SHIPPED ambiguo requiere fecha de movimiento posterior a etiqueta; estados inequívocos sin fecha conservan fecha de observación explícita, nunca presentada como fecha real de movimiento. Snapshot histórico sin evidencia tras7d se conserva por identidad y no se hereda al reetiquetar. Pendiente nuevo guard/recuento/CI; no usar SQL ni solicitud de aprobación anteriores.

Regla corregida congelada: 734/734 pruebas completas; 41 específicas (18 posesión,19 SQL de logística,4 estado), build/TypeScript y contratos6/6 correctos. Revisión independiente encontró dos drifts de raw sin fecha/código raw del estado: se reprodujeron y fijaron con paridad preexistente/live, incluido raw_code vacío. Fechas desconocidas usan sufijo _observed y aviso explícito, no una salida física inventada. Capturas24 nuevas antes/después de presentación a390/1440/2560 claro/oscuro; inspeccionadas a390. Recuento canónico de solo lectura:1008 (5 Etiquetados,938 Enviados,64 Cancelados,1 Pendiente nuevo), conserva577 históricos. Candidatos físicos:362 evidencias +591 históricos =953; huella78773903a5e7a10a73a2d7e76e8172c1. Guard y transacción atómica regenerados con la misma consulta. Pendiente CI del commit actualizado y aprobación expresa; producción sin cambios.

Congelación final: huella a97d5e1170f91c358cda01e4327a2f46 (reemplaza78773903a5e7a10a73a2d7e76e8172c1 al distinguir observaciones legacy de eventos). Guard previo de cinco cambios2bf159987fcade696a4dfdaa77c94ede; probado aborto temprano y rollback tardío del esquema tras pasar el guard de selección sintético. Suite completa734 y nueva regresión adicional, SQL20/20. SHIPPED exige evento carrier posterior; la fecha de importación sola no acredita posesión. Estados legacy de fulfillment conservan tracking_updated_at como observación. Revisión final independiente sin bloqueos. Nada ejecutado en producción.

CI final del código9f4b648eb18396f8183ef94f6818a133cf573585:6/6 workflows y Vercel correctos;735 pruebas completas y11/11 de integración real sin omisiones. Preflight repetido de solo lectura a2026-10-23T12:25:36Z:5 cambios y953 candidatos, ambas huellas exactas sin variar;1008 pedidos canónicos (938 enviados,64 cancelados,1 pendiente,5 etiquetados propuestos). Recibo `20261023-logistics-possession-ci-receipt.json`. SQL y lista corregidos preparados para revisión, NO aprobados. No se ha migrado ni publicado.

Autorización de producción del propietario recibida: versión corregida #297, repetir preflight y detenerse si cambia, ejecutar transacción y publicar con rollback anotado. Preflight12:31:29Z coincide exactamente con aprobación; siete funciones de rollback verificadas byte a byte contra producción,0 discrepancias; tablas nuevas todavía ausentes. MFA enabled y cohorte1 conservados. HTTP producción200 y assets anteriores anotados. API Vercel permite descubrir proyecto/equipo, pero limita detalles de despliegue; verificación por GitHub y HTTP público, rollback por main anterior y SQL preparado. Nueva hoja de ruta guardada en `20261023-owner-roadmap-after-logistics.md`; VERI*FACTU solo diseño cuando corresponda, sin solicitar certificados ni emitir facturas reales.
