# Hotfix facturación del pedido Shopify #1023

## Diagnóstico reproducido

Producción de partida: Gestión main `3decf71a4ce436fe4762b9d5cd0aad9800d285b2`, deployment `dpl_J6RLpKEotrEC2ddFMVeySm8YobV2` (READY). Extracción @zenvia/ui pausada en su worktree, sin mezclar archivos.

El cálculo defectuoso existe desde `59583b9761b8b1705c9e2b81416c87e2afe32973` (12/10/2026, 17:22 Madrid), que añadió esta funcionalidad. El fichero del cálculo no cambió después. No es una regresión de las fases de diseño ni de la caché: `prepareOrderInvoice` relee `fulfillment_orders.raw_payload` por ID, incluso desde listas paginadas.

Lectura fiscal de #1023: dos productos, 27,99 + 12,99 EUR, IVA incluido al 21 %, impuestos Shopify 4,86 + 2,25 EUR, transporte gratuito. La segunda base sin redondear es 10,7355; redondear primero a 10,74 y después calcular el IVA produce 2,26, y el total queda 40,99. La comprobación contra Shopify bloquea correctamente esa discrepancia. El rechazo del `Promise.all` descarta también emisor, series y registro IVA aunque esas consultas hayan terminado bien: reproduce exactamente los síntomas del propietario.

## Corrección

- IVA de pedidos Shopify con impuestos incluidos calculado antes de redondear la base, tanto en preparación como en persistencia. Total 40,98, base 33,87, IVA 7,11. Se conserva la comprobación estricta de total; no se toleran céntimos ni se inventan líneas de ajuste.
- El trigger permanece SECURITY INVOKER. Helper privado devuelve únicamente el indicador fiscal, limitado al workspace actual, permiso sales y vínculo factura/pedido con el mismo owner. Permite conservar la regla cuando edita un usuario de Facturación sin permiso para leer pedidos/compradores. No amplía acceso a payloads ni modifica Auth/MFA.
- Facturas manuales, Amazon y recibos conservan cálculo y guardas previos. Amazon no tiene acción de emisión desde el detalle del pedido en la app actual; no se añade. Los recibos siguen sin IVA según su tratamiento fiscal.
- Carga independiente de datos de la ventana mediante allSettled; un fallo se muestra y bloquea emisión, sin esconder la configuración que sí cargó.
- La factura existente y sus importes persistidos se siguen leyendo sin recalcular; la migración no modifica filas existentes.

## Evidencia y validación

Pruebas nuevas observadas fallando antes de corregir: modal sin líneas ni emisor y cálculo PostgreSQL 2,26 frente a 2,25. Pruebas después: dos productos, total, emisor, serie, registro IVA; fallo de preparación conserva emisor/serie y bloquea emisión; trigger PostgreSQL y edición por rol sin lectura de pedidos; preservación manual/Amazon/recibo y rechazo IVA en recibo exento.

Capturas `before/after-1023-{390,1280,1440}.png` y `screenshots.json`: componente y cálculo reales, mismos importes fiscales de #1023, identidad de cliente/emisor y nombres de producto sintéticos. Incluyen línea de transporte gratuito. Son pruebas locales sin red, no validación visual de una sesión de producción. No se pulsa emitir ni enviar y no se reserva numeración real.

Snapshot previo SQL: 21/10/2026 13:46:53 Madrid. Función anterior en `rollback.sql`, MD5 `f5c4d704351e76ff0f265e1232eee0ae`, propietario postgres. 27 facturas (hash IDs/número/total `b47ce38eacebf50fa837153554086513`), 45 líneas (hash importes `ce2a99321cad46ad35e2b49f20f9edfb`). #1023 tiene 2 items, 40,98 EUR y ninguna factura vinculada. No se copian datos de compradores al diario.

## Rollback preparado antes de producción

1. Restaurar frontend anterior `dpl_J6RLpKEotrEC2ddFMVeySm8YobV2` o revertir el commit del hotfix. La versión anterior vuelve a bloquear #1023; no emitir mientras se investiga.
2. Ejecutar `rollback.sql` para restaurar exactamente la función previa. El helper privado puede quedar sin callers; no requiere borrar objetos ni datos. No se cambian filas ni facturas emitidas al aplicar/revertir esta migración.
3. Verificar hash de función y conteos/importes. Las facturas que el propietario emita después son documentos reales y no se eliminan ni recalculan con un rollback.

CI remota, aplicación y comprobación final se registrarán al completarse. No se publica @zenvia/ui en este hotfix.
