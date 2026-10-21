# Múltiples cuentas bancarias — diseño y contratos propuestos

Fecha: 2026-10-21. Base inspeccionada: rama `feat/multiple-bank-accounts-20261021`.
Estado: diseño de implementación local; decisión histórica cerrada por coordinación el 2026-10-21: preservar render actual con provenance explícita. Ningún DDL/DML ni emisión/envío en producción. Las consultas remotas se limitaron a columnas, políticas, triggers y definiciones de funciones de `sjkxxbedkkmgmqnvaqjh`; no se consultaron valores bancarios, filas de negocio, PII ni secretos.

## Evidencia de los flujos reales

| Superficie | Flujo actual | Implicación |
| --- | --- | --- |
| Configuración → General | `src/pages/Settings.tsx`, GeneralTab, `loadBusinessSettings`/`saveBusinessSettings` en `sales.ts`; campo único `business_settings.iban` | Sustituir campo por gestor; no sobrescribir ni borrar el IBAN original durante migración |
| Modal datos fiscales de ventas | `BusinessModal` dentro de `SalesInvoicesCore.tsx`, también edita `form.iban` y llama `saveBusinessSettings` | Eliminar segundo editor de IBAN y enlazar a General; evitar escritores antiguos que pisen cuentas |
| Nueva factura | `InvoiceModal` → `createSalesInvoiceDraft`/`updateSalesInvoiceDraft` → tablas; `issueSalesInvoice` → `issue_sales_invoice(p_invoice_id uuid)` | Selección en borrador; congelar en servidor al emitir |
| Emisión individual/en lote | `SalesInvoicesCore.tsx` llama misma RPC; numeración y reservas están en DB | Trigger central cubre todos sin reescribir números |
| Recibos visibles | `SalesReceipts.tsx` → `salesReceipts.ts` → `sales_receipts`; número en trigger INSERT | Recibo interno: no tiene estado borrador/emitido; congelar banco al primer guardado |
| Recibo fiscal antiguo | `public.issue_sales_receipt(p_invoice_id uuid)` devuelve `sales_invoices`, exige `document_kind='receipt'` | Es un modelo distinto; también queda cubierto por trigger de sales_invoices |
| PDF factura/impresión/email | `salesInvoicePdf.ts`; `SendInvoiceModal` crea el mismo blob y llama `sendInvoiceViaGmail` | Hoy el pie usa `settings.iban` vivo, incluso en facturas emitidas. Cambiar global cambia PDF histórico |
| PDF recibo interno | `salesReceiptPdf.ts`, descarga e impresión desde SalesReceipts | Hoy no contiene IBAN; añadir sólo snapshot. No hay envío email de estos recibos |
| Shopify | `Orders.tsx` → `OrderInvoiceModal.tsx` → `orderInvoices.ts` → `save_shopify_order_invoice(p_order_id uuid,p_client jsonb,p_series_id uuid,p_issue_date date,p_lines jsonb,p_issue boolean default false)` → `issue_sales_invoice` | El modal debe cargar/seleccionar cuenta; transportar selección antes de emisión atómica |
| Amazon | Orders sólo muestra factura para `sourceChannel==='shopify'`; selección masiva rechaza otros canales; RPC también exige Shopify | No existe flujo de crear factura Amazon que extender. No añadirlo en este alcance |
| Edge | búsqueda de `sales_invoices`, `issue_sales_invoice`, `save_shopify_order_invoice` en todas las funciones: sólo app-agent consulta ventas; no hay Edge facturadora | No desplegar Edge ni tocar integraciones de sincronización |
| Recibos → factura | `invoiceSelected` agrupa cliente/mes y crea borradores independientes mediante `createSalesInvoiceDraft` | Resolver cuenta de la nueva factura según su serie/global; no copiar arbitrariamente una cuenta de recibos heterogéneos |

## Forma actual de datos confirmada en producción

`business_settings`: `owner_id uuid default private.app_workspace_owner_id()`, `iban text nullable`; no BIC ni titular.

`sales_invoices`: `id,owner_id,client_id,series_id,invoice_type,rectifies_invoice_id,invoice_number,status,issue_date,operation_date,due_date,currency,subtotal,discount_amount,tax_amount,total_amount,payment_method,notes,client_name,client_tax_id,client_email,client_address,issuer_name,issuer_tax_id,issuer_email,issuer_address,issued_at,sent_at,paid_at,created_at,updated_at,reserved_number,tax_registration_id,client_phone,issuer_phone,issuer_tax_country_code,issuer_tax_registration_label,document_kind,fiscal_treatment,fiscal_reason,source_order_key,source_fulfillment_order_id`.

**No existe ningún IBAN, BIC ni snapshot bancario en sales_invoices.** Los snapshots fiscales no contienen banco.

`sales_receipts`: `id uuid, owner_id uuid, client_id uuid, receipt_number text NOT NULL, receipt_date date, currency text, notes text, total_amount numeric, created_at timestamptz, updated_at timestamptz`. No serie, status, issued_at, forma de pago del documento ni snapshots. Los pagos tienen su propio método y no equivalen a instrucciones de pago del documento.

`sales_invoice_series`: `id,owner_id,code,name,kind,year,prefix,next_number,padding,active,created_at,updated_at`. No existe `sales_receipt_series`.

## Contrato de datos recomendado (aditivo)

`public.business_bank_accounts`:

- `id uuid PK default gen_random_uuid()`, `owner_id uuid NOT NULL default private.app_workspace_owner_id()`.
- `alias text NOT NULL`, `iban text NOT NULL`, `bic text NULL`, `holder text NULL`.
- `is_default boolean NOT NULL default false`, `archived_at timestamptz NULL`, timestamps.
- `validation_status text NOT NULL` (`valid`/`needs_review`) para preservar sin inventar validez un posible IBAN legado inválido.
- `legacy_source text NULL` (valor fijo `business_settings.iban`), índice único parcial por owner/source: migrar exactamente una vez, incluso tras editar el IBAN importado.
- `UNIQUE(owner_id,id)` para referencias compuestas; índice único parcial `owner_id WHERE is_default AND archived_at IS NULL`.
- CHECK alias no vacío, BIC opcional válido, `archived_at IS NULL OR NOT is_default`; cuentas nuevas/ediciones bancarias deben tener validación completa. `needs_review` sólo se introduce por migración, nunca como bypass desde API.

`sales_invoice_series.default_bank_account_id uuid NULL`: nulo significa global. Validación de pertenencia al mismo owner tanto en FK compuesta `(owner_id,default_bank_account_id)` como al usarla; cuenta archivada nunca elegible. No crear series de recibos internos.

En `sales_invoices` y `sales_receipts`:

- `bank_account_id uuid NULL`, referencia compuesta al mismo owner, sin cascada ni SET NULL sobre snapshots.
- `bank_account_snapshot jsonb NULL`, sólo DB escribe: `{version:1,accountId,alias,iban,bic,holder}` con IBAN normalizado para nuevas emisiones; accountId nullable en legado. El IBAN legacy conserva exactamente la cadena usada por el PDF actual, incluso si no valida.
- `bank_snapshot_source text NULL`: `issued` / `receipt_created` / `legacy_current_render` / `legacy_missing`. NULL sólo para borrador nunca emitido. No fabricar fuente `historic`.
- `bank_snapshot_at timestamptz NULL`; preservado al reabrir, evita confundir legado sin snapshot con documento nuevo sin cuenta.
- `payment_method_id text NULL` en invoices; en receipts añadir también `payment_method text NULL`. Los métodos actuales se guardan como etiquetas editables; usar ID estable `bank_transfer` para decidir obligatoriedad. Mantener `payment_method`/etiqueta para PDF y compatibilidad. Para borradores viejos, resolver etiqueta contra catálogo actual y etiqueta estándar como fallback, nunca tratar toda forma de pago como transferencia.

## API a cerrar antes de implementar

Propuestos, no existentes:

- `loadBusinessBankAccounts({includeArchived?:boolean})` → `BusinessBankAccount[]`.
- `saveBusinessBankAccount(input)` → RPC `save_business_bank_account(p_id uuid,p_alias text,p_iban text,p_bic text,p_holder text,p_is_default boolean)` devuelve fila; id NULL crea. Sin owner recibido del cliente.
- `archiveBusinessBankAccount(id,replacementDefaultId?)` → RPC `archive_business_bank_account(p_account_id uuid,p_replacement_default_id uuid default null)`; interfaz puede decir «Eliminar», confirmación explica retirada para documentos nuevos.
- `setDefaultBusinessBankAccount(id)` puede reutilizar save con datos completos o RPC dedicada `set_default_business_bank_account(p_account_id uuid)`; preferir dedicada para evitar sobrescribir datos desde estado obsoleto.
- `BusinessBankAccount`: `{id,alias,iban,bic,holder,isDefault,archivedAt,validationStatus}`.
- `BankAccountSnapshot`: `{version:1,accountId:string|null,alias:string,iban:string,bic:string|null,holder:string|null}`.
- Inputs factura y recibo: `bankAccountId?:string|null`, `paymentMethodId?:string|null`; recibo añade `paymentMethod?:string|null`.
- Tipos de salida: los tres campos `bankAccountId`, `bankAccountSnapshot`, `bankSnapshotAt` y `bankSnapshotSource`.
- Series managed y básicas: `defaultBankAccountId?:string|null`.
- Shopify: mantener firma SQL de 6 argumentos; transportar `bankAccountId` y `paymentMethodId` en `p_client` junto a `taxRegistrationId`, ya existente ahí. Extender insert/update del draft dentro de misma RPC. No segundo UPDATE posterior a emitir ni overload ambiguo en PostgREST.

## Predeterminadas, concurrencia y eliminación

Todas las mutaciones y selección final usan el mismo `pg_advisory_xact_lock(hashtextextended(owner_id::text || ':business-bank-accounts',0))`, más bloqueos de filas necesarios. Cambiar predeterminada debe ser una única transacción: validar nueva, desmarcar anterior, marcar elegida. Nunca copiar el patrón actual de registros IVA con dos llamadas cliente separadas.

Primera cuenta nueva se hace default automáticamente. Siempre una default si queda alguna activa; archivar default exige otra o escoge determinísticamente una activa válida bajo lock. Archivar última deja cero y habilita aviso de falta. Legacy inválido puede conservar condición default importada pero no es utilizable hasta corrección; no ocultarlo ni sustituirlo por una cadena inventada. Una vez haya válida, asignar default válida atómicamente.

Eliminar se implementa como archivo; cuentas archivadas desaparecen de nuevos selectores, siguen legibles en detalle histórico. Una serie con cuenta archivada vuelve a global; selección explícita archivada en borrador muestra error y exige elegir otra, sin sustitución silenciosa. Cuenta o serie de otro tenant siempre error. No cascade de documentos ni snapshots.

## Congelación autoritativa

Trigger nuevo independiente BEFORE INSERT/UPDATE en `sales_invoices`: en primera transición draft→issued resuelve selección explícita → default de serie activa → default global activa, valida cuenta/owner, normaliza y rellena snapshot. No modificar las RPC de emisión ni su lógica de números, reservas, totales, permisos y fiscalidad. El trigger debe cubrir también INSERT ya emitido para no permitir bypass.

Documento de transferencia sin cuenta válida: excepción exacta **«Falta una cuenta bancaria en Configuración → General»**; validar antes de consumir número (misma transacción revierte también numeración). No transferencia permite ausencia; si usuario elige cuenta se congela igualmente.

Trigger separado `sales_receipts` INSERT: congelar elección/global al guardar (es el momento real en que existe un recibo numerado). Edición posterior de líneas o fecha no modifica banco. UI edición muestra cuenta congelada como sólo lectura. Esto respeta mutabilidad actual del resto del recibo.

No confiar en JSON enviado por cliente: sobrescribir en primera emisión/INSERT; bloquear escrituras prematuras y cambios posteriores a snapshot, fuente, timestamp y selección. Este guard debe ejecutarse **también al reabrir a draft** y en drafts ya reabiertos: `private.guard_sales_invoice_immutable()` actual retorna temprano al reabrir y sólo revisa campos fiscales, por eso un guard separado es necesario. `reopen_sales_invoice` actual borra issued_at y snapshots fiscales pero no tocará nuevas columnas: preservar banco a través de reapertura/reemisión, sin recapturar default viva. Para legado reabierto sin evidencia, conservar la condición no demostrada; no convertirlo inadvertidamente en snapshot histórico probado. Se requiere marca de origen o backfill de marcador, nunca IBAN supuesto.

Resolver defaults al crear formulario y persistir ID cuando usuario guarda. Si cuenta cambia antes de emisión, snapshot captura los datos vigentes al emitir; si se archiva, pedir otra selección. Cambio de serie recalcula default sólo si usuario no ha hecho selección manual. Al editar borrador mantener selección persistida.

## Históricos: contrato cerrado por coordinación

No hay datos para recuperar el IBAN mostrado al emitir. **No afirmar que el IBAN actual era el original.** Preservar exactamente el render actual: antes de activar múltiples cuentas, congelar el IBAN de business_settings en documentos cerrados con provenance `legacy_current_render` y captured_at (`bank_snapshot_at`). Esta captura conserva el resultado actual del generador, no reconstruye un PDF original desconocido. No normalizar ni validar para render de legado: hoy PDF interpola la cadena íntegra. Cuenta legacy `needs_review` no invalida ni elimina este snapshot.

Factura cerrada sin IBAN actual, y todos los recibos internos históricos (su PDF no muestra IBAN), se marcan `legacy_missing`, snapshot NULL, timestamp de captura; nunca fallback vivo. En reapertura/reemisión conservar snapshot/provenance incluso `legacy_missing` para no atribuir cuenta después. No es necesario boolean adicional.

SQL exacto del backfill propuesto (sólo local; revisión SQL y conteos antes de producción):

```sql
UPDATE public.sales_invoices AS i
SET bank_account_snapshot = jsonb_build_object(
      'version',1,'accountId',NULL,'alias','Cuenta bancaria de configuración anterior',
      'iban',b.iban,'bic',NULL,'holder',NULL),
    bank_snapshot_source = 'legacy_current_render',
    bank_snapshot_at = transaction_timestamp()
FROM public.business_settings AS b
WHERE b.owner_id = i.owner_id
  AND (i.status <> 'draft' OR i.reserved_number IS NOT NULL)
  AND i.bank_account_snapshot IS NULL
  AND i.bank_snapshot_source IS NULL
  AND b.iban IS NOT NULL AND b.iban <> '';

UPDATE public.sales_invoices AS i
SET bank_snapshot_source = 'legacy_missing',
    bank_snapshot_at = transaction_timestamp()
WHERE (i.status <> 'draft' OR i.reserved_number IS NOT NULL)
  AND i.bank_account_snapshot IS NULL
  AND i.bank_snapshot_source IS NULL;

UPDATE public.sales_receipts AS r
SET bank_snapshot_source = 'legacy_missing',
    bank_snapshot_at = transaction_timestamp()
WHERE r.bank_account_snapshot IS NULL
  AND r.bank_snapshot_source IS NULL;
```

La condición `b.iban <> ''` reproduce JS truthiness del PDF: incluso una cadena de espacios era visible y debe preservarse exactamente. Repetición no modifica filas capturadas ni timestamp. No se modifican fiscalidad, números, líneas ni pagos. El trigger existente de inmutabilidad compara una lista de columnas, ninguna bancaria nueva: según definición real no bloquea estos UPDATE. Instalar nuevo guard de snapshots **después** del backfill dentro de la misma transacción; nunca deshabilitar triggers/MFA. Si se descubre otro bloqueo en ensayo, alternativa es tabla lateral legacy con PK `(owner_id,invoice_id)`, snapshot/provenance/timestamp y RLS igual, insert-only para usuario; no eludir controles existentes.

Los UPDATE anteriores disparan `sales_invoices_updated_at`/`sales_receipts_updated_at`; este efecto de metadatos debe incluirse en revisión. Si se exige conservar también updated_at original, usar tabla lateral para legado en lugar de tocar triggers. Antes de producción comparar conteos SELECT con los mismos WHERE y agrupar por status/source, sin seleccionar IBAN ni PII.

## Migración idempotente sin pérdida

1. Crear mediante `supabase migration new multiple_business_bank_accounts` (nombre generado por CLI, no timestamp inventado); implementar y verificar sólo en DB local/PGlite.
2. Objetos aditivos, `IF NOT EXISTS`/guards compatibles; crear políticas propias y funciones con firma cerrada. No redefinir helpers Auth, MFA ni grants existentes.
3. Insertar una cuenta por `business_settings` con IBAN no vacío, alias «Cuenta principal», conservando original íntegro en business_settings y normalizando sólo nuevo campo si válido. `legacy_source` único y `ON CONFLICT DO NOTHING` impide duplicados tras segunda ejecución o edición posterior. Si inválido preservar texto, `needs_review`, advertencia para corregir; migración no falla ni borra dato.
4. Preservar `business_settings.iban` como legado; retirar ambas interfaces editoras y excluir IBAN de `saveBusinessSettings` nuevo para evitar pisadas desde un formulario fiscal obsoleto. No sincronizar hacia legado desde cambio de default si el histórico aún usa ese campo.
5. Nuevas columnas nullable; backfill legacy_current_render/legacy_missing anterior, antes del guard nuevo. No tocar clientes, pagos, líneas, numeración, importación ni series existentes salvo nueva columna nullable.
6. Ensayo dos veces con fixtures: 0/1 cuentas; espacios/minúsculas; IBAN inválido; varias empresas; misma cadena en distintos owners; cuenta importada editada antes de rerun. Verificar cero pérdidas/duplicados.

## Validación bancaria

Fuente oficial a fijar en implementación: [Swift IBAN Registry](https://www.swift.com/standards/data-standards/iban-international-bank-account-number), registro actualizado (consultado 2026-10-21; PDF publicado septiembre 2026). Tabla explícita país→longitud; no restringir a ES ni aceptar desconocidos por longitud genérica. Normalizar mayúsculas y espacios, exigir prefijo de país + dos dígitos + BBAN alfanumérico, longitud exacta por país y MOD-97=1 con acumulador por dígito (sin Number de todo el IBAN). No eliminar guiones u otros signos silenciosamente.

Validación espejo TS/SQL con los mismos fixtures y tabla versionada. BIC opcional: normalizar mayúsculas/espacios exteriores; 8 u 11 posiciones `^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$` según [Swift BIC](https://www.swift.com/standards/data-standards/bic-business-identifier-code). Primeras cuatro posiciones alfanuméricas, no imponer sólo letras obsoleto. No exigir que país BIC iguale IBAN ni afirmar existencia de cuenta o titular por checksum. Alias obligatorio; titular opcional texto saneado con límites razonables. No registrar IBAN en logs de tests/capturas de producción.

## Multiempresa, permisos y MFA

`owner_id` es workspace: `private.app_workspace_owner_id()` delega en `private.app_workspace_id()`, no es auth.uid(). RLS nueva SELECT: mismo owner y sales/clients, incluir admin para General si fuera necesario; escrituras admin mismo owner con USING + WITH CHECK. Respetar lectura ventas y política General admin. Nunca confiar owner enviado por frontend.

En producción las políticas `mfa_select_gate`, `mfa_insert_gate`, `mfa_update_gate`, `mfa_delete_gate` son **RESTRICTIVE**, todas llaman `(select private.mfa_allowed())`. Replicar en tabla nueva, sin alterar funciones, enrolamiento MFA, JWT ni políticas existentes. RPC SECURITY INVOKER, search_path vacío, objetos calificados; nuevos grants mínimos authenticated, revocar EXECUTE a PUBLIC/anon sólo en funciones nuevas. No service role en cliente. FK compuestas y guard del servidor impiden referencia cruzada incluso si RLS oculta fila. Verificar metadatos de grants antes del SQL final.

## Ownership para implementación sin solapes

| Responsable | Archivos exclusivos | Entrega |
| --- | --- | --- |
| Backend/servicios | nueva migration; `src/services/businessBankAccounts.ts`; `src/services/bankAccountValidation.ts`; `src/services/sales.ts`; `src/services/salesReceipts.ts`; `src/services/salesConfig.ts`; `src/services/orderInvoices.ts`; tests SQL/PGlite y servicio | Contratos TS, RPC CRUD/default, validación, guard snapshots, selects/mappers y payload Shopify |
| UI | nuevo `BusinessBankAccountsPanel.tsx`; nuevo `BankAccountSelect.tsx`; `Settings.tsx`; `SalesInvoicesCore.tsx`; `SalesReceipts.tsx`; `SalesConfigurationModals.tsx`; `OrderInvoiceModal.tsx`; CSS del alcance; tests UI | Gestor General, selector transferencias, default serie, ausencia/archivada, detalle inmutable y legacy |
| PDF/integración por coordinación | `salesInvoicePdf.ts`; `salesReceiptPdf.ts`; tests PDF; `SendInvoiceModal.tsx` sólo si requiere detalle de snapshot | Render elegido y adjunto idéntico; no envío real |

No editar `settingsSchema.ts` salvo contrato final decida añadir setting; default banco vive en tabla/serie, no en app_settings JSON. Evitar que agentes editen el mismo sales.ts/UI/PDF. Tests de integración se asignan a un único dueño.

## Plan RED → GREEN y revisión

1. RED fixtures banco: IBAN ES/DE/FR/GB válidos públicos de prueba, checksum erróneo, país desconocido, longitud de otro país, minúsculas/espacios, caracteres prohibidos; BIC 8/11 y opcional.
2. RED DB PGlite: dos tenants, RLS/grants estructurales y ejecución con roles si harness lo permite; account/series cruzada rechazada; MFA restrictive preservado; default único concurrente; primera cuenta/default/archive última; importación dos veces sin pérdida.
3. RED snapshots: dos cuentas A/B, seleccionar B, emitir fixture local, cambiar IBAN/BIC/alias/default/archivar B, PDF y fila permanecen B original. Intentar UPDATE directo JSON/id/fuente/timestamp, spoof INSERT emitido, reabrir/reemitir. Fixture legacy: PDF antes con business_settings.iban debe contener exactamente el mismo texto bancario que después de backfill; cambiar settings/cuentas posteriormente no cambia ese texto. Legacy inválido sigue visible. Recibo interno antiguo legacy_missing no gana IBAN. Métodos efectivo/tarjeta sin cuenta permitidos; transferencia falla con mensaje exacto.
4. RED recorridos reales: factura manual y bulk; recibo interno al INSERT y edición; recibo fiscal `issue_sales_receipt`; Shopify draft→issue y generar+enviar con Gmail mock; recibos→factura conjunta; Amazon continúa sin opción de facturar. Ningún documento real.
5. RED UI: CRUD General, dos cuentas, default serie/global, override manual, change serie sin pisar manual, archived stale selection, sin cuenta → enlace General y texto exacto, snapshot read-only. Capturas desktop/móvil con datos ficticios.
6. GREEN implementación pequeña por ownership, ejecutar tests relevantes existentes: `sales-receipts`, `sales-settings`, `shopify-order-invoice`, `shopify-invoice-rounding-sql`, `invoice-send-notice`, `configurable-sales-due-date`, junto nuevos tests; `npm test`/`npm run build` según coste y harness.
7. Revisión integrada local: capturas, diff migración SQL exacta, prueba idempotencia y conteos sintéticos, evidencia PDF/adjunto sin live fallback. Revisión obligatoria antes de cualquier DDL producción o publicación bank. No emitir ni enviar reales para validar.

## Contratos cerrados para reparto local

- Histórico factura: `legacy_current_render` conserva cadena actual con timestamp; `legacy_missing` preserva ausencia. Sin atribución al IBAN original desconocido; no fallback vivo tras captura.
- IBAN legado inválido: preservar cuenta default needs_review con bloqueo de uso en documentos nuevos hasta corrección, sin perder el campo original ni el render histórico.
- Congelar recibo interno al guardar y mostrar banco sólo lectura en ediciones posteriores; añadir forma de pago al formulario de creación, sin inventar emisión ni envío email.
- Default opcional por serie implementado con nullable default_bank_account_id, selección explícita tiene prioridad.
- RPC/shape exactos arriba; columna payment_method_id estable para no basarse en traducciones o etiquetas mutables.
- Sólo falta revisión final de SQL exacta y conteos para producción; no pedir aprobaciones intermedias de implementación local.

Fuentes Supabase consultadas: skill `supabase:supabase` y documentación oficial RLS vía search_docs. Changelog descargado mediante HTTP tras error del lector markdown; revisadas entradas breaking de PostgreSQL 15.19/17.11 y TLS sin impacto en este SQL (sin extensiones, cifrados ni clientes nuevos). Registro Swift release 103 (septiembre 2026) descargado y cotejado: 89 países, incluido YE/30. No cambios de API Supabase: se reutilizan from/rpc actuales.

## Recibo de implementación backend local

Migración: `supabase/migrations/20261021182000_multiple_business_bank_accounts.sql`. Nombre provisional local explícito porque `command -v supabase` y `node_modules/.bin/supabase` no encuentran CLI; no se ejecutó ni aplicó en producción. Hash SHA-256 al cerrar backend: `838539dd7e13540d566fe788be36adbec6c0d73f8c8328f8aa4506857912d7ba`.

Implementados servicios/campos según contrato. Guard de snapshot separado preserva reapertura. Shopify mantiene seis argumentos y actualiza banco sólo cuando `p_client` incluye bankAccountId; omisión conserva banco congelado. Una nueva cuenta válida se promueve si sólo existía default inválida. Captura legacy incluye drafts con reserved_number no nulo, evidencia real del flujo de reapertura anterior a migración. No tocaron helpers Auth/MFA ni políticas/grants de tablas existentes.

Pruebas backend observadas RED→GREEN: validación, payloads/mappers, edición fiscal sin pisar IBAN legado, serie default, Shopify omisión; PGlite idempotencia, inmutabilidad, multiempresa/FK, MFA/admin, default y archivo, corrección de default inválida, reapertura previa/posterior y reemisión; RPCs reales `issue_sales_invoice`, `issue_sales_receipt`, `reopen_sales_invoice`, `save_shopify_order_invoice` con numeración y totales originales. Se conserva definición original de issue_sales_invoice byte por byte en prueba.

11 tests backend en 4 archivos pasan. Scripts existentes de receipts/settings/Shopify/rounding/send-notice/due-date: 22 tests pasan. `tsc -b` pasa. Primer suite completo: 300 pasan/4 fallan (PDF legacy largo, selector vacío UI y dos fixtures Shopify); se comunicaron a sus dueños, quienes corrigieron. Segunda ejecución completa `npm test` después de esas correcciones: **60 archivos, 304 tests pasan**, 31,08 s. Ningún documento real emitido/enviado; SQL ejecutado únicamente en PGlite local. Nuevas restricciones de propietario se apoyan en RLS de workspace y FK compuestas documento/cuenta; no se modifica ninguna FK de propiedad existente (en producción sales_receipts todavía referencia auth.users, mientras las otras tablas de ventas referencian workspaces).

### Conteos de lectura para revisión previa a producción

Consultas ejecutadas sólo SELECT, sin IDs, valores bancarios, PII ni secretos. Resultado al 2026-10-21: 26 facturas a legacy_current_render (3 issued, 23 paid); 2 a legacy_missing (1 issued y 1 draft previamente reabierto); 8 recibos internos a legacy_missing. Total 36 documentos. Recontar justo antes de aplicar: la aplicación puede cambiar entre revisión y despliegue. Como las columnas nuevas no existen aún, los WHERE de snapshot-null son implícitos en esta previsualización.

```sql
SELECT 'invoices_legacy_current_render' AS migration_group,
       i.status, count(*)::bigint AS affected_rows
FROM public.sales_invoices i
JOIN public.business_settings b ON b.owner_id=i.owner_id
WHERE i.status<>'draft' AND b.iban IS NOT NULL AND b.iban<>''
GROUP BY i.status
UNION ALL
SELECT 'invoices_legacy_missing', i.status, count(*)::bigint
FROM public.sales_invoices i
LEFT JOIN public.business_settings b ON b.owner_id=i.owner_id
WHERE i.status<>'draft' AND (b.iban IS NULL OR b.iban='')
GROUP BY i.status
UNION ALL
SELECT 'receipts_legacy_missing','internal',count(*)::bigint
FROM public.sales_receipts
ORDER BY migration_group,status;

SELECT CASE WHEN b.iban IS NOT NULL AND b.iban<>''
            THEN 'legacy_current_render' ELSE 'legacy_missing' END AS migration_group,
       count(*)::bigint AS affected_rows
FROM public.sales_invoices i
LEFT JOIN public.business_settings b ON b.owner_id=i.owner_id
WHERE i.status='draft' AND i.reserved_number IS NOT NULL
GROUP BY 1;
```

Resultados exactos agregados: primera consulta `(invoices_legacy_current_render,issued,3)`, `(invoices_legacy_current_render,paid,23)`, `(invoices_legacy_missing,issued,1)`, `(receipts_legacy_missing,internal,8)`; segunda `(legacy_missing,1)`.
