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
