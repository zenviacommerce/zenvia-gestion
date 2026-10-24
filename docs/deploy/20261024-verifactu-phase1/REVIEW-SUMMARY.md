# #306 — resumen de revisión antes de aprobar

**No aplicado ni publicado.** Recuentos de producción del 24/10/2026, alrededor de las 20:40–20:47 Europe/Madrid, solo SELECT. Evidencia: `review-production-evidence.json`. SQL literal por operación: `existing-table-statements.sql` (inventario, no ejecutar).

## 1. Check MFA: regresión real, corregida

El stack arrancó y aplicó todas las migraciones. Vault, GoTrue y AAL1→TOTP→AAL2 pasaban. Fallaba el gate del manifiesto: el antiguo `division by zero` ocultaba tres findings, exactamente `issue_sales_invoice`, `issue_sales_receipt` e `issue_sales_receipt_document`.

`pg_get_functiondef` depende de search_path: devuelve `RETURNS sales_invoices` con public visible y `RETURNS public.sales_invoices` con search_path vacío. #306 calculaba el MD5 del manifiesto en el primer contexto; `mfa_activation_findings()` comprueba en el segundo. Las tres RPC compuestas diferían aunque su protección estuviera presente. No era infraestructura ni un fallo de Vault/GoTrue, TRUNCATE o RLS.

Corrección: `SET LOCAL search_path=''` antes de generar wrappers/manifiesto, limitado a la transacción. No se relaja el gate, sus grants, cohorte, TOTP ni políticas. La aserción informa ahora nombres/motivos. Test RED reprodujo los mismos tres findings; GREEN con la corrección. Revisión independiente sin Important abiertos. **MFA real GREEN: 11/11, cero omitidos**, [job 120956135557](https://github.com/zenviacommerce/zenvia-gestion/actions/runs/40122248780/job/120956135557), commit `826c3a3f4c085bac6aac144b9abfae78108201ce`.

## 2. SQL que toca lo existente

**Una sola migración:** `supabase/migrations/20261024075749_verifactu_shadow_phase1.sql`. No DROP TABLE preexistente ni DELETE de facturas/recibos durante la migración. Lo demás son pruebas, contratos oficiales, inventarios y capturas. Aproximadamente 27.073 líneas del diff inicial corresponden a HTML/CSS visual; no son migraciones ejecutables.

| Sentencia o grupo literal (expandido en el inventario SQL) | Alcance actual / DML al aplicar |
| --- | --- |
| `ALTER sales_invoices ADD verifactu_type CHECK…, ADD rectification_mode CHECK…` | 29 filas reciben columnas NULL; **0 UPDATE** de contenido |
| `ALTER sales_receipts ADD status DEFAULT 'issued' NOT NULL CHECK…, ADD issued_at` | 8 recibos quedan clasificados como emitidos; issued_at NULL, sin inventar fecha; default por metadatos PG17, sin UPDATE |
| `ALTER sales_receipts ALTER status SET DEFAULT 'draft'` | Solo altas futuras; 0 UPDATE |
| `ALTER sales_receipts ALTER receipt_number DROP NOT NULL` | Relaja NOT NULL para borradores futuros; no elimina columna/valores; 0 UPDATE |
| `ALTER sales_receipts ADD CONSTRAINT vf_receipt_number_on_issue…` | Valida los 8 existentes; 0 UPDATE |
| Respaldo a tabla nueva + `UPDATE sales_invoices SET invoice_number=NULL,reserved_number=NULL WHERE status='draft' AND …` | **1 borrador DEMO de otro workspace**, con 2 líneas intactas; 0 facturas del propietario actualizadas. Su trigger existente actualiza updated_at e inserta **1 audit_logs** |
| 7 `CREATE TRIGGER` de guardas/captura en facturas, recibos, ambas líneas, series y contador | Se añaden sin dispararse sobre el pasado; 0 UPDATE/DELETE |
| Loop de 7 `CREATE TRIGGER … BEFORE TRUNCATE` | Facturas29 / líneas50 / recibos8 / líneas13 / series4 / pool0 / contador1; protege truncados futuros; 0 filas modificadas |
| `REVOKE INSERT,UPDATE,DELETE … FROM authenticated` | Pool de números liberados (0 filas) y contador recibos (1); cambia ACL, no filas |
| 8 `CREATE POLICY … AS RESTRICTIVE` | DELETE de padres solo draft; INSERT/UPDATE/DELETE de ambas líneas solo con padre draft. Se conservan RLS tenant/MFA existentes; 0 filas modificadas |
| Reemplazo de 10 funciones existentes: guarda fiscal, asignación recibos, banco, vencimiento, pagos, issue factura/recibo, reopen/delete/renumber | Cambia comportamiento futuro; sin DML inmediato sobre documentos. Definiciones anteriores respaldadas en tabla privada nueva |
| Loop de wrappers: `INSERT … ON CONFLICT UPDATE private.mfa_function_manifest` | **6 INSERT previstos** (ninguna de estas firmas tiene entrada hoy); ACL de 6 RPC públicas y helpers privados. No toca configuración MFA ni secretos |
| 9 tablas privadas nuevas, con FK a workspaces y documentos existentes | Nacen sin historial fiscal; RLS/ACL propias. Las FK añaden conservación futura; no reescriben tablas referenciadas |

Los UPDATE de documentos/series, INSERT/UPDATE de contadores y DELETE de borradores que aparecen **dentro de funciones** no se ejecutan al migrar. Actúan al emitir/borrar un documento futuro: documento y contador en una transacción; jamás DELETE de emitida. El inventario distingue ambos momentos y detalla también las operaciones del rollback.

## 3. Qué cambia en el día a día

| Acción | Comportamiento y mensaje / alternativa real |
| --- | --- |
| Editar/borrar borradores | Continúa disponible; solo se eliminan borradores en una selección mixta |
| Editar, borrar o reabrir emitidas (también ya cobradas/enviadas) | Botones retirados; no hay opción en Configuración para habilitarlos. Mensaje: «Las facturas emitidas se conservan. Para corregirlas, crea una rectificativa.» RPC/BD rechazan intentos legacy |
| Renumerar, también borradores, o importar un número fiscal elegido | Se retira el campo editable; «El número de factura se asigna al emitir y no se puede modificar manualmente.» Importación guarda el número externo como referencia |
| Editar/borrar los 8 recibos existentes | Se consideran emitidos y desaparecen esas acciones. Borradores nuevos recuperables sí pueden corregirse/reintentarse; «Solo se puede editar un recibo en borrador.» |
| PDF, impresión, correo y cobros de emitidas | Se conservan; datos fiscales y snapshots no cambian por registrar/corregir un cobro |
| Cambiar prefijo/año/tipo/contador de serie ya utilizada | Rechazado con `VF_SERIES_IMMUTABLE`; usar una serie/ejercicio nuevo sin reidentificar las emitidas |
| Recibo nuevo | Se guarda draft y se emite de forma controlada. Si falla, queda recuperable; sin cobro/PDF/conversión mientras sea draft, ni KPI de pendiente inflado |
| Fusión de cliente / reset demo con emitidas | No pueden reasignar/borrar cerradas: la operación completa falla, sin cambios parciales |

**Límite operativo que debe valorar el propietario:** Crear rectificativa genera un borrador, pero emitirlo exige R1–R5 y S/I explícitos. Esta PR aún no expone esos selectores en pantalla; la emisión de ese borrador falla con `VF_DOCUMENT_CLASSIFICATION_INVALID` sin clasificación. La anulación registrada se entrega por RPC, sin botón nuevo. Por tanto la alternativa técnica existe, pero **no es todavía un circuito completo de corrección accesible desde la UI**. No se presenta como operativa terminada; esto debe decidirse antes de publicar una conservación global. La fase 2 entrega esa UI/clasificación completa.

## 4. Legado y siguiente número

28 documentos cerrados (27 paid + 1 issued), sus 48 líneas y contenido de los 8 recibos **no se reescriben**. Se conservan también las dos renumeraciones históricas descritas debajo; esta PR no las corrige automáticamente ni las legitima. Sin altas retroactivas.

| Workspace / serie 2026 | Contador actual | Máximo emitido | Próximo número con esta PR |
| --- | ---: | ---: | --- |
| Propietario / F | 55 | 54 | **F202655** |
| Propietario / R | 1 | ninguno | **R20260001** |
| Otro workspace / DEMO | 3 | 1 | **D-2026-0003** |
| Otro workspace / R | 1 | ninguno | **R-2026-0001** |

Sí, siguen los contadores actuales. El ancla es `greatest(next_number,max_issued+1)`; no baja ni rellena huecos antiguos. El borrador DEMO pierde la reserva 2, previamente respaldada; no se recicla ese número. La correlatividad transaccional se garantiza desde el corte, con retry idempotente y sin consumo en rollback. La cadena de huellas empieza vacía en la primera nueva emisión bajo shadow.

## 5. Historial de cambios ya ocurridos — lectura

83 eventos de numeración examinados. **2 facturas actuales del propietario muestran una emisión anterior y posterior vuelta a draft/cambio de número**; 3 eventos de limpieza/cambio tienen una emisión previa acreditada. Mirar solo eventos cuyo status='issued' habría ocultado este flujo.

- **F202650**: auditoría1774, 13/10 08:25:40 Madrid, constaba issued como **F20265**; eventos1775–1776, 08:31:03, draft y número **F202651**; eventos1777–1778, 09:06:24, pasa al número actual **F202650**.
- **F202654**: evento2084, 21/10 17:08:10 Madrid, constaba issued como **F202652**; 2086–2087, 17:19:05–10, draft y número actual **F202654**.

No he modificado estos documentos. **Edición posterior de importes, líneas o datos fiscales: recuento no determinable con el histórico disponible.** El log específico solo guarda números/estado; `updated_at > issued_at` también ocurre con pagos/envíos y no demuestra una edición fiscal. No se afirma «cero edits». Tampoco se confirma por estas trazas si los PDF de versiones anteriores se entregaron al cliente; corresponde valorarlo con el propietario.

## 6. Activación y rollback, por pasos (todavía no autorizados)

1. Revisar este resumen/SQL y decidir el circuito de corrección y las dos renumeraciones históricas. Repetir preflight, recuentos, hashes de cerradas y DDL/manifiesto; detener ante diferencias. Registrar deployment Vercel activo y copia de definiciones/ACL.
2. Abrir ventana sin operaciones de Facturación/Recibos **en todos los workspaces**. Aplicar solo esta migración, con lock_timeout3s y statement_timeout15s. Arranca disabled; las guardas son globales, independientemente del interruptor.
3. Comparar contenido de 28 cerradas/48 líneas y 8 recibos/13 líneas, respaldo del único draft, 6 entradas MFA y cero findings. No emitir documentos reales para probar. Un fallo revierte la transacción.
4. Desplegar cliente compatible coordinadamente y verificar navegación/acciones con el propietario, sin guardar documentos de prueba. No abrir la operativa hasta completar ambos lados.
5. Solo con aprobación adicional: ejecutar `activate-shadow.sql` para el owner indicado. Inserta configuración/evento; no emite factura ni conecta AEAT. La siguiente emisión real decidida por el propietario inaugura el registro sombra.
6. **Rollback antes de cualquier uso/activación:** cerrar operativa, restaurar frontend compatible y ejecutar `rollback.sql`. El gate exige que no existan eventos, series_state, snapshots, RF o anulaciones nuevos; restaura funciones/ACL/reserva del draft y retira solo objetos/columnas nuevos. Puede cambiar updated_at e insertar otra auditoría del draft: no es rollback byte a byte de esa fila.
7. **Tras activar, incluso sin emitir, ya hay un evento:** el rollback destructivo queda bloqueado. Ejecutar `disable-shadow.sql`, conservar historia/números/guardas, cerrar flujos incompatibles y, si procede, revertir frontend. El interruptor NO vuelve a permitir editar emitidas. Un frontend legacy no emite recibos draft: mantener ese flujo cerrado hasta recuperar cliente compatible. Una reversión de esquema posterior exige otra migración de conservación revisada.

**Detener aquí. Sin aprobación de producción.** Ni SQL mutante en producción, ni AEAT, PDF, certificados, Google Cloud, PayPal, suscripciones o configuración del piloto MFA modificados en esta revisión.
