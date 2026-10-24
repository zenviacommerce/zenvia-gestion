# Activación aprobada — 24/10/2026

Autorización expresa del propietario: aplicar fase 1 y circuito completo, publicar frontend y activar sombra para noviembre/diciembre. Esta anotación sustituye el estado «pendiente de aprobación» del paquete archivado; no autoriza conexión AEAT.

## Publicación y corte

- PR #306 fusionada: `c9df8aa6afa8f9d9b07abf13a48c9f6c375ed101`; head revisado `d9629c30b10ac6f181dfcaf87ad1270d3284a8f7`, sus 11 checks en verde antes de publicar.
- Vercel production READY: `dpl_Gd4tAGNUMiKqrUUhz8hpZ5P3nAmt`, gestion.zenviacommerce.com; build terminado a las 23:21:28 Europe/Madrid.
- Sombra activada **24/10/2026 23:22:05 Europe/Madrid (21:22:05 UTC)**, solo owner `7461b2b7-f383-460d-b1c7-6ccbb52e42b2`.
- Instalación `1a00d7ed-bdc5-4909-b3e9-2d3a60eafc72`. Un evento mode_shadow con SHA-256 válido; cero RF, cadenas, anulaciones, snapshots o números consumidos al cierre. La primera emisión natural nueva abrirá la cadena, sin altas retroactivas.
- Próximos números conservados **F202655 / R20260001**. DEMO sigue 3/R1 tras revertir las pruebas.
- Sin AEAT, QR fiscal, certificados, recursos Google Cloud, PayPal/suscripciones ni documentos reales emitidos para probar.

## Preflight y SQL

Coinciden los recuentos de la última revisión: 29 facturas, 28 cerradas (27 paid/1 issued), 50 líneas/48 cerradas, 8 recibos/13 líneas, 4 series, 1 contador de recibos, 0 números liberados y 1 reserva de borrador DEMO. Sin operaciones fiscales activas. Las 20 definiciones coinciden con los snapshots revisados: solo cualificación textual public. de retornos según search_path; sin cambios de lógica. El JSON de la revisión anterior no conservaba hashes de contenido histórico: se fijaron antes de mutar y se compararon tras SQL y activación; no se afirma una comparación anterior inexistente.

Las seis huellas de migraciones, rollbacks e interruptores coinciden con [sha256.json](sha256.json). Ambas migraciones se aplicaron en orden, sin errores, con lock_timeout=3s y statement_timeout=15s. La captura siguió disabled hasta que el frontend compatible estuvo READY.

| Archivo revisado | Versión del historial MCP en producción |
|---|---|
| 20261024075749_verifactu_shadow_phase1.sql | 20261024211923 / verifactu_shadow_phase1 |
| 20261024193413_verifactu_correction_circuit.sql | 20261024212002 / verifactu_correction_circuit |

Único DML fuente de instalación: limpiar la reserva del borrador DEMO aprobada, respaldada en private.verifactu_draft_number_backup. Ninguna cerrada, línea histórica, recibo o cobro reescrito. F202650/F202654 quedan como legado sin acción correctora.

## Conservación y pruebas

[Recuentos/huellas previos y finales](production-activation-evidence.json): seis hashes idénticos.

| Conjunto | Filas | MD5 operativo de conservación |
|---|---:|---|
| Facturas cerradas | 28 | dbeb1fe10e86d9191b750b78376da2a5 |
| Líneas de cerradas | 48 | a706d237a87b82aabe4ebc6c582edcdc |
| Recibos históricos | 8 | 071c4419b6a496859f45f742d5535db6 |
| Líneas de recibo | 13 | 9012a6a3987f712b2737cc8c03054772 |
| Cobros de facturas | 27 | 34c1c56fd9e4825e28db2b8eae8e114e |
| Cobros de recibos | 7 | 04e0a68e8b9887fcc8c46de153729206 |

Comparación excluye solo las siete columnas técnicas nuevas de factura y status/issued_at nuevos de recibo; incluye todos los campos previos y updated_at. Las 28 cerradas conservan metadatos fiscales nuevos NULL; los 8 recibos quedan issued/issued_at NULL, sin inventar fecha. MD5 prueba conservación, no sustituye SHA-256 fiscal.

Prueba SQL **solo DEMO y ROLLBACK obligatorio**: authenticated DEMO → emitir su borrador → rechazar edición/reapertura → crear R4/I → guardar líneas atómicamente → emitir rectificativa → anular hija/original. Dentro de la transacción: 4 RF, 2 anulaciones y cadena SHA-256 válida. Tras ROLLBACK: 0 RF/eventos/settings/contadores/snapshots/anulaciones. [SQL ejecutado](production-demo-rolled-back.sql). Sin PDF, correo ni petición externa.

MFA: 8 firmas/manifiestos con hashes válidos, 0 activation_findings. Las 8 RPC rechazan contexto AAL1 del owner antes de operar. No se simuló sesión AAL2 del propietario ni se cambiaron cohorte/factores/Vault: piloto enabled con una persona. AAL2 real cubierto por CI GoTrue/TOTP/Vault 11/11; queda el navegador del propietario. DEMO authenticated completa el circuito reversible.

9 tablas privadas con RLS y cero privilegios clientes de lectura/escritura/truncate; cero EXECUTE clientes en helpers privados. 8 políticas restrictivas y guardas instaladas. Advisors detecta RLS sin políticas en esas tablas privadas (denegación por defecto deliberada) y los 8 wrappers SECURITY DEFINER authenticated con auth/tenant/permiso/MFA. No se amplían grants para silenciarlos: [RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Dominio y bundle público responden HTTP 200: `/assets/index-B5kIXMQl.js` contiene create/save_sales_invoice_correction, verifactu_cancel_sales_document, «Crear rectificativa» y aviso de inmutabilidad. Fetch protegido Vercel recibió 403 intentando crear share link; comprobación pública directa funciona sin bypass/login/cambio de protección. Inspección del bundle no equivale al navegador autenticado.

## Rollback preparado

Antes de activar: scripts ampliación → base y Vercel anterior `dpl_FDkKv1dUjohVTY8g7TeRjmPS25qy` preparados. Gates/locks de conservación probados en PostgreSQL17/CI; no se ejecutaron rollbacks en producción para probar.

**Tras mode_shadow ambos rollbacks destructivos deben rechazar la reversión**: ya existe un evento. Mitigación preparada: [disable-shadow.sql](../20261024-verifactu-phase1/disable-shadow.sql).

```sql
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
SET LOCAL application_name='verifactu_shadow_disabled_preserve_history';
UPDATE private.verifactu_settings SET mode='disabled'
WHERE owner_id='7461b2b7-f383-460d-b1c7-6ccbb52e42b2';
COMMIT;
```

Apaga nuevas altas conservando documentos, números, guardas, cadena, historial y frontend compatible. Anulaciones de altas capturadas **sí** pueden encadenarse con captura apagada gracias a la ampliación: comentario final del antiguo disable-shadow.sql obsoleto, SQL vigente. No restaurar cliente antiguo para seguir operando sin correcciones. Reversión de esquema posterior requiere migración de conservación revisada.

## Pendiente del propietario

Recargar Facturación en navegador real y abrir emitida: sin editar/borrar/reabrir; sí Crear rectificativa y Anular cuando proceda. Revisar filtros, selección y enlaces sin emitir documentos reales de prueba. No afirmar aceptación visual hasta recibir resultado. Después observar solo en lectura la primera emisión natural autorizada.
