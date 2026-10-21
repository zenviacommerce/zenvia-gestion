# Cuentas bancarias — entrega para revisión, sin publicar

2026-10-21. Orden autorizado: lote B Platform publicado → Productos por separado → cuentas bancarias → lote C Platform. Esta entrega se detiene antes de cualquier migración o publicación bancaria. No se han emitido ni enviado documentos reales ni cambiado MFA.

## Comportamiento

General permite varias cuentas con alias, IBAN validado, BIC/SWIFT y titular opcionales; cambio de predeterminada atómico y eliminación mediante archivo. La cuenta importada conserva el IBAN original de business_settings sin borrarlo; un legado inválido permanece visible para corregirlo.

Facturas manuales, recibos internos y facturación Shopify permiten seleccionar cuenta, con prioridad elección manual → serie → global. Cuenta archivada no se sustituye silenciosamente. Transferencia sin cuenta válida se bloquea con «Falta una cuenta bancaria en Configuración → General».

El servidor congela datos al emitir una factura o guardar un recibo, cubre reaperturas y rechaza snapshots proporcionados/modificados desde el cliente. PDF y email usan el snapshot. Los documentos previos conservan el render bancario actual con procedencia legacy_current_render, sin afirmar que fuera el IBAN original al emitir. Donde no había datos se conserva legacy_missing. No se añade facturación Amazon.

## SQL concreto y filas previstas

[SQL completo revisable](../../../supabase/migrations/20261021182000_multiple_business_bank_accounts.sql).

SHA-256: `838539dd7e13540d566fe788be36adbec6c0d73f8c8328f8aa4506857912d7ba`. Nombre provisional local: CLI Supabase ausente; antes de aplicar deberá alinearse con la versión asignada por la herramienta y mantener exactamente el SQL revisado.

Conteos de producción obtenidos mediante SELECT agregado, sin leer IBAN ni PII: **1 cuenta a importar; 26 facturas legacy_current_render; 2 facturas legacy_missing (una emitida y un borrador previamente reabierto con reserved_number); 8 recibos legacy_missing**. Son 36 documentos: sólo metadatos bancarios nuevos, más updated_at por triggers existentes. Sin cambios de números, líneas, fiscalidad ni pagos. Recontar inmediatamente antes de aplicar; consultas exactas y resultados en ../20261021-bank-accounts-design.md.

```sql
UPDATE public.sales_invoices AS i
SET bank_account_snapshot = jsonb_build_object('version',1,'accountId',NULL,
  'alias','Cuenta bancaria de configuración anterior','iban',b.iban,'bic',NULL,'holder',NULL),
  bank_snapshot_source = 'legacy_current_render', bank_snapshot_at = transaction_timestamp()
FROM public.business_settings AS b
WHERE b.owner_id=i.owner_id AND (i.status<>'draft' OR i.reserved_number IS NOT NULL)
  AND i.bank_account_snapshot IS NULL AND i.bank_snapshot_source IS NULL
  AND b.iban IS NOT NULL AND b.iban<>'';

UPDATE public.sales_invoices AS i
SET bank_snapshot_source='legacy_missing', bank_snapshot_at=transaction_timestamp()
WHERE (i.status<>'draft' OR i.reserved_number IS NOT NULL)
  AND i.bank_account_snapshot IS NULL AND i.bank_snapshot_source IS NULL;

UPDATE public.sales_receipts AS r
SET bank_snapshot_source='legacy_missing', bank_snapshot_at=transaction_timestamp()
WHERE r.bank_account_snapshot IS NULL AND r.bank_snapshot_source IS NULL;
```

No ejecutar estos UPDATE separados de la migración: su posición antes del nuevo guard y dentro de la transacción importa. La migración también crea tabla/columnas/índices, políticas propias con MFA restrictiva, RPC SECURITY INVOKER y guards; modifica la RPC Shopify de seis argumentos sin alterar numeración. No reemplaza helpers de autenticación, políticas/grants de tablas existentes ni RPC de emisión.

## Verificación y límites

- Suite integrada final tras incorporar Productos: **310/310 Vitest, 62 archivos**, concurrencia dos workers. **1.244/1.244 Node/SQL** con la exclusión habitual de integración MFA real; build TypeScript/Vite/icono y diff-check verdes.
- SQL local/PGlite: migración repetida sin duplicados/pérdidas, RPC reales de emisión manual/recibo fiscal/reapertura/Shopify, tenant cruzado, falta de cuenta, defaults, archivo y snapshots inmutables. IBAN/BIC TS/SQL: registro Swift103, septiembre2026, 89países; checksum no acredita existencia/titular.
- Revisión independiente: sin bloqueantes; 33pruebas focales repetidas. Los hallazgos de reapertura histórica, Shopify frozen/null, default inválido, opción «Sin cuenta» y PDF legacy quedaron corregidos con regresiones.
- [Comparación visual](READMEvisual.md): **81 PNG** en390/1280/1440; fuentes/hashes/lotes registrados. [Fuentes finales frente a captura](manifest-source-final-vs-capture.json): sólo Products fuera de estas superficies y PDF simulado difieren; UI/App/CSS bancarios idénticos.
- PDF real generado localmente con datos ficticios, sin escrituras: [factura](pdf/invoice-bank-b.pdf) y [recibo](pdf/receipt-bank-b.pdf), con render PNG revisado. Factura corta con IBAN+BIC+titular en una página; legacy conserva el texto y render previos incluso si inválido. Email probado con envío y marcado simulados; adjunto y cuerpo muestran la misma cuenta.
- No E2E bancario en producción, ni prueba de concurrencia con dos sesiones PostgreSQL reales; transacciones/locks/índice único revisados y probados en entorno local. Preview frontend no valida la migración remota que sigue pendiente.

## Rollback preparado para una publicación futura

Base previa a bancos: main de Productos `2f8cc07d7bf46a0063b505106f962fc350e6f1ec`, fuente conservada. Antes de tocar producción, registrar su deployment activo y repetir conteos/estado SQL. Conservar objetos aditivos y todos los snapshots; **no DROP de tablas/columnas ni borrar cuentas o documentos**.

Antes de la primera emisión/recibo nuevo, puede restaurarse el frontend previo si la consulta siguiente devuelve cero. Después de guardar documentos con cuenta elegida, no volver a un lector PDF antiguo que usa business_settings.iban: conservar lector de snapshots y guards y preparar una corrección hacia delante. Esta restricción evita cambiar facturas existentes durante un rollback.

```sql
SELECT bank_snapshot_source, count(*)
FROM (
 SELECT bank_snapshot_source FROM public.sales_invoices
 WHERE bank_snapshot_source='issued'
 UNION ALL
 SELECT bank_snapshot_source FROM public.sales_receipts
 WHERE bank_snapshot_source='receipt_created'
) AS new_bank_documents
GROUP BY bank_snapshot_source;
```

La reversión no elimina los metadatos legacy capturados. El campo original business_settings.iban permanece intacto. La publicación y aplicación de esta migración están pendientes de revisión explícita del propietario.
