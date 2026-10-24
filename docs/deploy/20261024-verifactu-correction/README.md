# #306 — paquete único de revisión del circuito de corrección

**BORRADOR. No se ha aplicado SQL ni publicado frontend en producción.** Esta ampliación cierra desde pantalla el bloqueo operativo identificado en la revisión anterior. La fase 1 completa sigue pendiente de aprobación del propietario.

## Decisión sobre el legado y corte

Decisión expresa del propietario, 24/10/2026: **ninguna acción sobre las facturas históricas**, incluidas F202650 y F202654. Se conserva su historial como evidencia; no se renumeran, reemiten, rectifican ni regularizan automáticamente. No se crean altas retroactivas ni se reescriben importes, líneas, PDFs, cobros o números ya emitidos.

El corte técnico comienza en la primera emisión nueva después de activar `shadow` para el owner aprobado. Los documentos anteriores siguen siendo legado. La captura técnica en sombra no es una remisión a AEAT ni una declaración de entrada en vigor legal: la futura activación fiscal/transporte tiene su propio corte pendiente de aprobación. En esta PR no existe conexión AEAT, firma ni recursos Google Cloud.

## Qué puede hacer el propietario

1. **Emitir** un borrador: recibe el siguiente número correlativo de su serie/ejercicio. Una factura emitida muestra el aviso de inmutabilidad; desaparecen editar, borrar, reabrir y renumerar. Los borradores conservan edición y borrado, también en selección masiva.
2. **Crear rectificativa**: seleccionar R1–R5 con su explicación, modalidad S (valores correctos finales) o I (diferencias firmadas) y motivo obligatorio. S precarga las líneas originales; I copia conceptos/cantidades/IVA con precio cero para introducir explícitamente el ajuste. Se abre el editor existente, con líneas editables y serie rectificativa; el número se asigna solo al emitir. El motivo y tipo pueden revisarse; modalidad/vínculo/snapshot original quedan fijos para evitar convertir importes finales en diferencias sin querer. Para cambiar modalidad se elimina el borrador y se crea otro.
3. **Ver relación y estado**: la original y la rectificativa tienen vínculos de navegación en ambos sentidos; el listado muestra Rectificada cuando existe una corrección emitida no anulada. Los borradores vinculados también se ven, sin marcar todavía la original como rectificada. R5 se ofrece a originales simplificadas F2/R5. Para otra sustitución sobre una factura ya sustituida se corrige la última rectificativa; se bloquea descontar la misma original dos veces. Las diferencias I explícitas pueden ser positivas, negativas o cero y acumularse.
4. **PDF rectificativo**: muestra número/fecha originales, R1–R5, S/I y motivo. En S incluye base y cuota originales junto a los importes finales. No cambia el PDF de las facturas ordinarias/legado. El ejemplo adjunto es sintético y sin validez fiscal.
5. **Anular cuando proceda**: desde el detalle, elegir operación inexistente o emisión duplicada, explicar motivo y confirmar expresamente. Para corregir una operación real o sus importes se dirige a rectificativa. Usa la anulación registrada existente, conserva documento/número/registro y muestra Anulada. No devuelve ni modifica cobros. Se bloquea anular una original con rectificativas emitidas activas vinculadas; primero hay que revisar esos documentos. La decisión jurídica no se infiere automáticamente del estado de la factura.

Los estados fiscales son derivados: no se escribe `rectified`/`cancelled` sobre la factura fuente. Cobros registrados e historial comercial se conservan. Los KPI de Facturación, Resumen, Clientes y el impacto de la exportación usan S=final−original e I=diferencia; documentos anulados aportan cero, evitando doble contabilización. Filas/PDF mantienen sus importes documentales. El CSV incluye modalidad, original, motivo, importes originales e impacto fiscal. Los saldos comerciales no se recalculan ni se devuelven automáticamente: deben revisarse con el propietario tras una corrección.

Inventario de acciones y retiradas deliberadas: [action-inventory.json](action-inventory.json). Recibos emitidos siguen protegidos; su anulación registrada permanece disponible por RPC, sin atribuirle un nuevo botón de factura.

## Capturas del circuito

Componentes React reales renderizados localmente con mocks y datos sintéticos; no son capturas de una sesión real ni prueban producción. Antes: detalle de la fase 1 sin circuito completo. Después: emitir/lista → inmutabilidad → clasificación → edición → rectificativa emitida y enlace → confirmación de anulación → estado Anulada. Las pantallas emitidas/anuladas son estados sintéticos preparados; SQL y concurrencia se prueban aparte en bases desechables. Los dos generadores visuales opt-in se ejecutan expresamente en CI.

[Galería y PDF](gallery.md). 40 capturas a 1440/390 px, claro/oscuro, con una segunda vista del editor desplazada hasta las líneas. Cero desbordamientos horizontales del documento. Se desactiva movimiento en el capturador para evitar capturar colores a mitad de una transición de tema; se serializa el estado checked de la confirmación.

## SQL adicional: inventario sobre tablas existentes

[SQL completo de la ampliación](../../../supabase/migrations/20261024193413_verifactu_correction_circuit.sql) · [SQL inicial de fase 1](../../../supabase/migrations/20261024075749_verifactu_shadow_phase1.sql) · [inventario inicial con recuentos](../20261024-verifactu-phase1/existing-table-statements.sql).

La ampliación ejecuta esta única alteración de tabla fuente:

```sql
ALTER TABLE public.sales_invoices ADD COLUMN rectification_reason text,
 ADD COLUMN rectification_original_number text, ADD COLUMN rectification_original_date date,
 ADD COLUMN rectification_original_base numeric, ADD COLUMN rectification_original_tax numeric;
```

| Sentencia/objeto adicional | Impacto al aplicar |
|---|---|
| ALTER anterior: 5 columnas nullable sin default | Todas las facturas obtienen metadatos NULL; **0 UPDATE de valores fiscales históricos**. Último recuento de revisión: 29 facturas; repetir preflight al activar. |
| CREATE TRIGGER vf_correction_identity_guard BEFORE UPDATE sobre sales_invoices | 1 trigger, 0 filas modificadas; fija modalidad/vínculo/snapshot de los nuevos borradores rectificativos. |
| CREATE OR REPLACE private.vf_issue_invoice, vf_cancel_document, vf_append_record, vf_shadow_status | 4 funciones privadas sustituidas; 0 DML de facturas al aplicar. Conservan permisos de escritura sales; lectura sales OR dashboard y MFA, coherente con RLS existente. |
| INSERT private.verifactu_migration_backup | 4 definiciones guardadas para rollback. No contiene facturas ni certificados. |
| INSERT private.mfa_function_manifest | 2 entradas nuevas para crear/guardar corrección, con huella canónica; no modifica piloto, factores ni políticas MFA. |
| CREATE FUNCTION | 5 funciones nuevas: 2 RPC públicas, 2 implementaciones privadas y función del trigger. |
| REVOKE/GRANT EXECUTE | Pública/anon/service_role sin acceso a nuevas RPC; authenticated puede invocar wrappers con comprobaciones; implementaciones privadas no ejecutables por clientes. 0 filas. |

**No hay DROP de tabla/columna existente, UPDATE/DELETE/TRUNCATE de documentos fuente, cambios de RLS ni backfill en esta ampliación.** Los UPDATE/DELETE/INSERT dentro de la nueva RPC de guardado ocurren solo cuando el propietario guarda un borrador rectificativo, dentro de una transacción y con lock del padre; nunca se ejecutan al instalar la migración. El único UPDATE fuente de toda la fase 1 sigue siendo el borrador DEMO de otro workspace descrito y respaldado en la revisión inicial (1 fila + su auditoría); ninguna emitida ni F202650/F202654.

Ambas migraciones fijan lock_timeout=3s y statement_timeout=15s. Creación/guardado/emisión/anulación comparten orden de locks por owner → documento → cadena/serie. Se verifica en PostgreSQL 17 con sesiones competidoras, no solo PGlite.

## Activación propuesta, después de aprobación

1. Exigir CI verde del SHA exacto, revisar esta galería, migraciones, fingerprints y rollback. Refrescar preflight de solo lectura: recuentos, números siguientes por serie, ninguna actividad fiscal en curso, manifiesto MFA limpio y reserva DEMO esperada. Si difiere, volver a mostrar diferencias antes de aplicar. No emitir documentos de prueba reales.
2. Acordar ventana coordinada con el propietario sin emisiones/ediciones fiscales ni trabajos automáticos de facturación. Preparar el deployment Vercel anterior y ambos scripts de rollback. La aplicación de la fase 1 sola no es una publicación aceptable del circuito.
3. Aplicar migración inicial y ampliación en ese orden, con captura `disabled`; si una falla, mantener la ventana cerrada y restaurar mientras los gates de rollback lo permitan. Comprobar columnas, triggers/ACL/RLS, las 8 entradas del manifiesto del paquete, cero findings MFA y fingerprints de emitidas/líneas/cobros sin cambios. No tocar datos de legado.
4. Publicar el frontend del mismo SHA en la ventana coordinada. El propietario verifica en su navegador listados, filtros, selección, acciones retiradas, detalle y acceso al circuito. Durante esta verificación no se emiten facturas reales para probar. Las pruebas completas de emisión/corrección/anulación son las desechables adjuntas.
5. Solo con aprobación del owner activar `shadow` para 7461b2b7-f383-460d-b1c7-6ccbb52e42b2 usando el script ya revisado. Registrar hora del corte, instalación, anclas y siguiente número. Baseline leído: F202655 y R20260001, sujeto a preflight actual; no reiniciar contador ni rellenar huecos históricos. El primer registro será la primera emisión natural nueva que autorice el propietario.
6. Observar esa emisión natural y sus registros/fingerprints/cadena sin modificarla. Sin AEAT/PDF QR/certificados ni contratación. La obligación legal futura y el transporte no se activan en esta fase.

## Rollback coordinado

- **Antes de cualquier actividad nueva:** detener escrituras; ejecutar [rollback de la ampliación](rollback.sql) y después [rollback de fase 1](../20261024-verifactu-phase1/rollback.sql); restaurar deployment Vercel. Antes de cada gate, la misma transacción bloquea en ACCESS EXCLUSIVE las 16 tablas fuente/archivo implicadas; así ninguna emisión ni activación puede entrar entre la comprobación y el DDL. Se conserva lock_timeout=3s/statement_timeout=15s: la contención aborta sin borrar. Cada gate verifica que no hay registros/eventos/números consumidos ni nuevos borradores incompatibles. La ampliación restaura 4 funciones y elimina solo sus 2 manifests/RPC y 5 columnas nuevas. El rollback base fija search_path=public para restaurar definiciones históricas con retornos compuestos no cualificados; probado incluso desde sesión con search_path vacío.
- **Tras cualquier evento o uso, incluida activar shadow:** los scripts rechazan el rollback destructivo. Ejecutar [disable-shadow.sql](../20261024-verifactu-phase1/disable-shadow.sql) para detener nuevas altas; conservar guardas, documentos, números, cadenas e historial. Las anulaciones de altas ya capturadas siguen pudiendo registrarse y encadenarse aunque la captura esté apagada. No reciclar números ni borrar eventos.
- El frontend previo carece del circuito: después de empezar a usarlo **no se vuelve al cliente anterior para seguir operando facturación**. Mantener el frontend compatible y apagar captura/cerrar temporalmente el flujo afectado; cualquier reversión posterior de esquema necesita una migración de conservación revisada. Nunca dejar al propietario con emitidas inmutables y sin vía de corrección desde pantalla.

## Referencias oficiales usadas

AEAT, [procedimientos de facturación](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/procedimientos-facturacion.html): R1–R5 y S/I, valores finales/base-cuota originales en S y ajuste firmado en I. AEAT, [anulación](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/registros-facturacion-anulacion.html): conservación de número y registros. Consulta 24/10/2026. Este circuito no sustituye la decisión jurídica del propietario sobre un caso concreto.
