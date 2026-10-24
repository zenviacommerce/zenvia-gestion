# VERI*FACTU fase 1 — propuesta revisable, sin activar

Estado: rama de revisión, **no aplicada en producción**. La migración arranca en `disabled`. No se ha emitido ninguna factura real, cambiado PDF, conectado AEAT, creado recurso Google Cloud ni manejado certificados. La pasarela elegida sigue siendo Google Cloud europe-west1 con escalado a cero, pendiente de alta por el propietario según fase 0.

## SQL exacto y alcance

- Migración: `../../../supabase/migrations/20261024075749_verifactu_shadow_phase1.sql`.
- Activación posterior y explícita para un solo workspace: `activate-shadow.sql`.
- Interruptor conservador: `disable-shadow.sql`.
- Rollback de esquema **antes de cualquier uso**: `rollback.sql`. Sus condiciones se verifican y abortan si existe historia nueva; después del primer uso solo se desactiva la captura y se conserva numeración, guardas e historia. No se reciclan números emitidos.

La migración es una transacción con `lock_timeout=3s` y `statement_timeout=15s`. Antes de aprobarla debe repetirse el preflight y compararse las definiciones de funciones/triggers con los snapshots: otra sesión podría haberlas cambiado. Incluye copia privada de funciones/manifest MFA y de reservas de borradores. No cambia la configuración del piloto MFA.

## Impacto sobre documentos existentes y corte

Inventario de solo lectura: 29 facturas de venta (26 paid, 2 issued, 1 draft) y 8 recibos independientes. Las **28 facturas cerradas no se actualizan** y no se genera alta retroactiva. Los 8 recibos conservan número, total y contenido; reciben metadatos de conservación `status=issued`, sin fingir una fecha de emisión histórica. La única fila fuente prevista con UPDATE es el borrador con número/reserva: ambos se copian en `private.verifactu_draft_number_backup` y se liberan en el borrador para numerar al emitir. No se modifica ni rellena el pasado fiscal.

La cadena comienza con la primera emisión nueva en sombra: `Huella=` vacía, secuencia 1, NIF/instalación/workspace identificados. Serie/ejercicio empiezan en el mayor de contador existente y máximo número emitido + 1; no se arreglan huecos históricos ni se reutiliza el pool de números liberados. Desde ese ancla, emisión, número, snapshot, hash y evento se confirman o revierten juntos. Reintentar la misma emisión devuelve el mismo documento. La fecha de emisión no puede preceder a la anterior de esa serie desde el corte.

## Inmutabilidad y rutas

`route-audit.md` inventaría UI, importaciones, CRUD, bulk delete, numeración manual, rectificativas, Shopify, pagos, envíos, fusión, series y Edge. `routine-audit-before.json` cierra las 21 funciones reales que referencian las tablas fiscales; `catalog-audit-before.json` conserva asociación/estado de triggers, FK y grants. `deployed-edge-audit.json` identifica 49 bundles desplegados leídos, con versión/huella: solo app-agent referencia ventas, mediante SELECT. No se invocaron Edge ni RPC de negocio.

Guardas invoker cubren INSERT/UPDATE/DELETE y TRUNCATE, comprobando los padres antiguo/nuevo en líneas. Las emitidas no permiten cambios fiscales, reapertura, renumeración, borrado o reasignación de cliente/owner. Las RLS restrictivas filtran DELETE de cerradas y escritura de líneas cerradas; un DELETE authenticated puede devolver cero filas en vez de error. Los triggers también bloquean la operación elevada/service_role; el administrador que pueda alterar/deshabilitar triggers sigue siendo el límite de confianza de PostgreSQL.

Pagos y envío conservan solo status operativo, sent_at/paid_at/updated_at, con eventos separados. Los snapshots fiscales no cambian. Fusión de clientes que intenta reasignar una cerrada y reset demo que intenta borrarla fallan de forma atómica: no se ofrecen excepciones silenciosas. La creación de una rectificativa mantiene intacto el original. Exige clasificación R1–R5 y S/I explícita antes de emitir; la UI completa de clasificación corresponde a fase 2. Standard no puede etiquetarse R ni enlazar un original como si fuera rectificativa. Se recalculan totales de líneas bajo el lock del padre antes de emitir, sin confiar en importes editables de la cabecera.

Los recibos en `sales_invoices` son documentos fiscales legacy y usan el emisor común. `sales_receipts` son justificantes de cobro sin IVA: tienen borrador/emisión, numeración y snapshot/evento inmutable propios; **no se infiere un registro fiscal de alta por el mero total de un justificante**. Compras (`invoices`) no son ventas y quedan fuera del emisor fiscal.

## Huella y límites del modo sombra

`hash.ts` y las funciones SQL implementan la concatenación literal AEAT en UTF-8 y SHA-256 mayúscula para alta/anulación. Se prueban los tres ejemplos oficiales, paridad SQL/TS, importes, Unicode/trim, fechas y offset numérico (Madrid y cambio de hora). La anulación encadena respecto al último registro y referencia el alta; no elimina ni renumera el original. Anular un documento anterior al corte deja constancia local, sin inventar un alta anterior.

El archivo conserva snapshot de factura/líneas y hash_fields. Es una base de sombra: no implementa todavía XML completo/XSD, validación fiscal integral R1–R5/S/I, remisión, QR, respuesta AEAT ni declaración responsable del producto. Los eventos son bitácora local append-only y encadenada; no se presentan como implementación del RegistroEvento oficial de sistemas NO VERI*FACTU. Véase `official-hash-review.md` y contratos versionados de fase 0.

## Plan de activación, sujeto a aprobación

1. Revisar esta PR, SQL y rollback. Repetir inventario/DDL/grants y cotejar hashes de snapshots; detener si hay diferencias no explicadas. Contar documentos por estado y reservas; registrar el resultado antes de cualquier UPDATE del borrador.
2. Ejecutar migración en entorno aislado con copia estructural y datos anonimizados; verificar CI, concurrencia, permisos y before/after de documentos cerrados. No emitir una factura real para probar.
3. Tras aprobación explícita: ventana corta sin operaciones de facturación/recibos hasta completar migración y frontend coordinados, exportar definiciones/recuentos/huellas y aplicar la única migración transaccional. Arranca disabled. Verificar que las 28 cerradas y 8 recibos no han cambiado su contenido y que el único borrador previsto quedó respaldado; si falla antes de uso, rollback.sql.
4. Desplegar frontend desde la PR solo con autorización y CI verde. Capturas sintéticas antes/después disponibles como artefacto del workflow; comprobar inventario de acciones, buscadores/filtros y tablas. No modificar PDF. Validar navegación en navegador real del propietario, sin crear documentos de prueba en producción.
5. Autorizar aparte `activate-shadow.sql`: toma el NIF ya configurado, restringe al owner aprobado y deja evento de activación. La primera factura real que el propietario decida emitir en su flujo normal inaugura la cadena. Comprobar lectura de status/contadores, snapshot, número y huella sin reproducir PII en el diario.
6. Ante incidencia: `disable-shadow.sql` bloquea nueva captura, conserva todas las guardas/historia/números. Documentar el intervalo disabled; no rellenarlo retroactivamente. La anulación de altas de sombra requiere reactivar sombra, nunca emitir un registro incompleto. Revertir frontend si es necesario sin reabrir emitidas; un frontend legacy no emite los nuevos recibos draft, por lo que debe mantenerse bloqueado ese flujo hasta restaurar el cliente compatible. Reversión de esquema posterior a actividad exige otra migración de conservación revisada.

## Verificación

Pruebas reproducibles: cuatro suites `tests/verifactu-{core,hash,hash-sql-parity,ui-lifecycle}.test.*`; PostgreSQL 17 real mediante `scripts/verifactu-postgres-concurrency.mjs` (solo loopback desechable, opt-in explícito, sin credenciales); `npm run build`. El workflow adjunta capturas offline desktop 1440 y móvil 390 de componentes reales con filas sintéticas. El harness visual opcional usa `VF_BASELINE_ROOT` apuntando a main aislado; no necesita sesión del propietario.

Resultado final y enlaces CI se registran en `verification.md`. Ninguna prueba automatizada apunta a producción.

Preflight reutilizable: `preflight-and-fingerprints.sql`, lectura de recuentos/huellas sin PII antes y después. Es un inventario global de Gestión; la migración y las guardas son globales, aunque la activación de captura se limita al owner autorizado. Mantener cerradas las operaciones de documentos durante toda la ventana coordinada. Las capturas sintéticas no incluyen el marco completo de navegación de producción y no sustituyen la posterior validación de navegación del propietario.
