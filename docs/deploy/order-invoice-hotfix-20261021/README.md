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


## Comparación ampliada y desviaciones de verificación

`fiscal-comparison.json` y fixtures fiscales sin datos personales cubren #1020–#1025: los seis totales e impuestos finales coinciden con Shopify (21,98 / 10,80 / 32,97 / 40,98 / 23,98 / 29,70 EUR). Antes fallaban #1021, #1023 y #1025 por el mismo redondeo; se cubren descuentos y transporte. Estas lecturas históricas no son pedidos nuevos ni una validación de ventas cobradas.

Configuración comprobada sin publicar identidad: emisor presente; serie ordinaria 2026 activa y siguiente número 53; cuatro registros IVA activos, uno predeterminado. No se cambia esa configuración ni se consume numeración.

Suite local Node: 1.238 pruebas (antes de añadir el caso agrupado de seis pedidos). Vitest completo: 259. Una primera ejecución simultánea agotó el tiempo de pickup-reports-sql; repetición completa con 2 workers en verde. Build correcto. Revisión independiente sin bloqueantes tras añadir el helper y el test de rol restringido.

Primera CI remota: build, lógica y Auth en verde; integración desechable Auth/Vault falló al aplicar el helper porque el historial antiguo del repositorio carece de document_kind/fiscal_treatment, columnas que producción sí tiene. Se añade esa dependencia únicamente al fixture del runner (igual que las dependencias de Pedidos existentes), sin alterar Auth/Vault/MFA de producción ni omitir pruebas. Se repite la CI completa.


## Backend aplicado

CI remota completa en verde para `4fce728aa6fc77751636e2e40295899760b0c768` (builds, Auth, integración real GoTrue/Vault y todas las capturas). Se aplicó después la migración `20261021115856_shopify_invoice_tax_rounding` a Gestión a las 13:58:56 Madrid. Archivo renombrado a la versión real para impedir futuras reaplicaciones.

`backend-applied.json`: a las 13:59:07, hashes y conteos de las 27 facturas y 45 líneas idénticos al snapshot; helper inaccesible a anon, disponible a authenticated, sin exposición de payload. La función del trigger conserva modo invoker; helper booleano usa definer con alcance de workspace y permiso sales. No hay cambios de filas de negocio. Ninguna factura emitida por las pruebas.

Se prueba también la creación y numeración real de un recibo en PostgreSQL aislado, con las funciones originales: REC-2026-0001, 2 × 12,99 con 10 % de descuento = 23,38 sin IVA; tipo 21 % conservado para futura factura; rollback elimina el fixture. La prueba de un recibo exento rechaza IVA distinto de cero. No se crean recibos reales en producción.

Se repite CI sobre la versión final del repositorio (alineación de filename, pruebas complementarias y capturas con locale es-ES); código productivo de frontend/backend sin cambios respecto al que pasó la CI anterior.
