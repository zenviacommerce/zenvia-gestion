# Retoque aprobado de cuentas bancarias — 2026-10-21

El propietario comprobó Platform#79 (ZENVIA5/1/171, DEMO1/0/0, cobertura2/2 y Tickets correctos) y Productos#273 (95 productos también en Hoy). Aprobó#274 con selector bancario dentro de Fechas y cobro y sólo para transferencia, incluidas las ventanas de recibos y Shopify; autorizó migración con snapshot/rollback y publicación tras el ajuste.

## Antes y después

Base antes: PR#274 d5e47b2b204aa9f242231d764fe0e13239de2e5b, árbol0fe35b2198f80c6b63a11e8a9fdb11ca2dcb8ac6. Se recuperaron metadatos Git locales y cotejaron los2019blobs: todos coinciden. La etiqueta local approved-bank-layout identifica ese mismo árbol inmutable.

9PNG antes y24después a390/1280/1440, tres formularios reales, CSS transitivo y @zenvia/ui reales; fronteras de carga/persistencia simuladas con datos ficticios y red bloqueada. Reloj fijo. El harness ahora resuelve herramientas desde el repositorio, sin depender del checkout transitorio anterior. No se reescribe la comparación original de81PNG.

Los nueve recorridos verifican que el selector comparte la tarjeta Fechas y cobro con Forma de pago, desaparece al elegir Efectivo y vuelve con Transferencia; se mantienen defaultglobal/serie y override. Cero errores de página/overflow. Antes:before-manifest.json. Después:after-manifest.json; cada captura y fuente tienen SHA256.

| Formulario | Antes390 | Después390 | Después1440 |
|---|---|---|---|
| Factura | [antes](before-invoice-390-payment.png) | [transferencia](after-invoice-390-bank-manual-override.png) · [efectivo](after-invoice-390-cash-no-bank.png) | [transferencia](after-invoice-1440-bank-manual-override.png) |
| Recibo | [antes](before-receipt-new-390-top.png) | [transferencia](after-receipt-new-390-bank-manual-override.png) · [efectivo](after-receipt-new-390-cash-no-bank.png) | [transferencia](after-receipt-new-1440-bank-manual-override.png) |
| Shopify | [antes](before-shopify-390-top.png) | [transferencia](after-shopify-390-bank-manual-override.png) · [efectivo](after-shopify-390-cash-no-bank.png) | [transferencia](after-shopify-1440-bank-manual-override.png) |

Se añadieron tres regresiones UI RED→GREEN para ubicación/visibilidad y otras tres para permitir guardado en efectivo aunque falle la carga bancaria oculta. En efectivo se envía bankAccountId:null, sin arrastrar una selección archivada; snapshots congelados conservan su inmutabilidad. No se cambia la resolución/snapshot del servidor acordada en la PR.

## Migración y snapshot

CLI Supabase2.121.0 disponible y migración generada con migration new. SQL bancario desde private.bank_normalize_iban permanece idéntico al aprobado838539dd…; se antepone CTAS privado idempotente de business_settings,28facturas cerradas/reabiertas,8recibos y definición original de save_shopify_order_invoice. REVOKEALL para PUBLIC/anon/authenticated. Prueba local confirma captura original conservada en repetición y falta de acceso del rol de aplicación.

Antes de aplicar se mostraron al propietario los tres UPDATE exactos:26facturas legacy_current_render,2facturas legacy_missing,8recibos legacy_missing. Recuento agregado actualizado:1cuenta por importar. Sin DELETE ni cambios de números/filas/pagos. updated_at cambia por triggers existentes, como ya se informó. Versionado final de Supabase se alineará con el recibo real manteniendo bytes SQL.

Rollback previo: deployment dpl_pftFospm77ikRDdhBXUQKRVJGk2v / main2f8cc07d. Conservar esquema y snapshots aditivos; sólo restaurar lector antiguo si no hay documentos nuevos con bank_snapshot_source issued/receipt_created. Si ya existen, conservar lector de snapshots y corregir hacia delante. No DROP ni DELETE de documentos/cuentas, ni cambios de Auth/MFA. Las copias privadas conservan estado/definición original para auditoría o restauración específica revisada.

Revisión independiente del ajuste+snapshot:17/17 focales verdes, sin bloqueantes. Suite completa, build, CI y recibo de producción se registran al terminar el despliegue. Ningún documento real emitido/enviado en pruebas.

## Próximo alcance confirmado

El propietario eligió explícitamente Resto de Platform para loteC: Resumen, Planes, Facturación, Usuarios y Auditoría con sus formularios, @zenvia/ui y funcionamiento conservado; revisión/capturas antes de publicar. No se amplían APIs, Auth/MFA ni operaciones de facturación reales. Empezar implementación tras publicar y verificar bancos.
