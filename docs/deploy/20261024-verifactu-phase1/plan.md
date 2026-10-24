# VERI*FACTU fase 1: primer corte del núcleo privado

> Ejecución: continuar en esta sesión con superpowers:executing-plans, por tareas, con revisión antes de integrar. Diseño fases0–5 aprobado; este plan desarrolla fase1, no requiere otra decisión de pasarela.

**Objetivo:** emisión fiscal sintética transaccional, numerada, idempotente y encadenada, con snapshot inmutable y outbox desactivada.
**Arquitectura:** aislamiento por obligado/instalación, bloqueo de cabecera por cadena y bloqueo por serie para numeración. Sin llamadas de red en la transacción; snapshot y salida se confirman juntos. Facturas legadas no se incorporan retroactivamente a la cadena.
**Stack:** PostgreSQL/Supabase y pruebas PostgreSQL/PGlite; funciones de dominio Deno/TypeScript para huella/XML/QR.
**Especificación:** docs/deploy/20261023-verifactu-rectificativas-design.md y20261023-verifactu-phase0/acceptance.md (PR300).

## Límites vigentes

ExclusivamenteVERI*FACTU, noSII confirmado; series e impuestos actuales. Sin recursos Google, certificados, contraseñas ni conexión AEAT. Sin emisión real, PayPal o suscripciones. No SQL masivo/destructivo sin recuento/SQL/permiso. Backend fiscal desactivado y publicación detenida hasta revisión del corte; cambios solo en rama aislada. Fase1estimada4–6días de ingeniería; no se declara terminada al iniciar pruebas.

## Auditoría retomada 24-10 tras publicar #304

Snapshot de solo lectura guards-before.json. Hallazgos a cubrir antes del corte fiscal:
1.guard_sales_invoice_immutable permite issued→draft si allowEditIssuedInvoices(defaulttrue), sin envío/cobro; permite borrar issued sin envío/cobro. Es comportamiento comercial vigente, no garantía de inmutabilidad fiscal. Los documentos con snapshot fiscal deberán impedirlo aunque se cambie configuración.
2.guard_sales_invoice_line_edit mira solo NEW.invoice_id enUPDATE. Mover una línea desde una emitida a un borrador no valida el padreOLD. El total recalculado solo mira el padreNEW. Cubrir también cambio deowner/parent y cascadas.
3.recalculate_sales_invoice_totals modifica cabecera; separar cobros/estado comercial y fiscal inmutable. Auditar liberación/reutilización de números y todos los RPC antiguos antes de conectar el núcleo.

## Foco de revisión

- Dos emisiones simultáneas de misma solicitud devuelven un único número/registro.
- Fallo después de asignar número no consume el número ni mueve cadena.
- Tenant/obligado/instalación nunca cruzan snapshots, cadena o salida.
- Reparentado de línea y borrado por cascada no eluden guardas fiscales.
- Rectificación/anulación conserva enlace y no modifica el alta histórica.

## Tarea 1: fixture y superficie de escritura

Archivos: tests/verifactu-immutability.test.ts; tests/fixtures/verifactu-legacy-schema.sql; docs/deploy/20261024-verifactu-phase1/write-surface.json.
Interfaz consumida: guardas reales del snapshot; emitida fiscal sintética con registro asociado. Salida: fixture reutilizable y mapa RPC/trigger/cascadas/mantenimiento.
- [x] Capturar guardas actuales sin filas de clientes ni credenciales.
- [ ] Enumerar todos los RPC públicos/privados de emitir/reabrir/borrar/cambiar número y triggers sobrecabecera/líneas/series.
- [ ] RED: reparentado desdeemitidafiscal→borrador debe lanzar VF_FISCAL_IMMUTABLE; DELETE/UPDATE/issued→draft y cambioowner también.
- [ ] Cerrar todas las rutas de documentos fiscales registrados; cobros posteriores siguen permitidos fuera del snapshot. No activar restricciones del nuevo modo sobre legado sin plan de corte.
- [ ] GREEN de borrador editable, fiscales bloqueados, cobro permitido y cruce tenant denegado. Revisión y commit.

## Tarea 2: transacción y numeración

Archivos: supabase/migrations/<versionCLI>_verifactu_transactional_core.sql; tests/verifactu-transactional-core.test.ts; rollback exacto en docs/deploy/20261024-verifactu-phase1/.
Interfaz: función privada vf_prepare_issue(owner,installation,invoice,idempotency_key) devuelve record_id/number/hash/sequence; no wrapper público hasta cerrar MFA/permiso/tenant.
- [ ] RED:20llamadas concurrentes, repetición misma clave, mismaclave/distintopayload, rollback y tenant cruzado.
- [ ] Modelo privado: instalaciones, cabecera de cadena, registro/snapshot, artefactos y outbox disabled. Bloqueo siempreen orden fijo(cadena,serie) y unique de idempotencia; SHA256 sobre serialización normativa, no JSON arbitrario.
- [ ] GREEN: sin bifurcaciones/números duplicados/filas parciales; sin cambios de series/impuestos actuales. Revisión y commit.

## Tarea 3: dominio offline y corte revisable

Archivos: supabase/functions/_shared/verifactu/{hash,xml,qr}.ts; tests/verifactu-domain.test.ts; docs/deploy/20261024-verifactu-phase1/acceptance.md.
Interfaz: snapshot canónico→artefacto fiscal; entradas/salidas tipadas, sinred, firma o certificados.
- [ ] RED sobre tres vectores oficiales dehuella, UTF8/importes/fecha/huso/primerregistro/rectificación/anulación, y validación XSD de fixtures sintéticos.
- [ ] Implementar serialización, huella y QR bajo contratos fijados en fase0. No afirmar conformidad integral por pasarvectores.
- [ ] GREEN +CI+MFA/tenant; recuento/SQL/rollback y corte desactivado listos para revisión. No aplicar ni emitir real sin autorización específica.
