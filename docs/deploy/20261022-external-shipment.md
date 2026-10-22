# Registro de envío externo — 2a

Estado: preparación en rama, sin publicar. Diseño aprobado por el propietario en la conversación de continuidad del 22/10.

## Descubrimiento

- Base: main `0ae9622b1da1bf6f0901b6c27a4bb2982ac67750`; copia por conector GitHub porque Git directo no tiene acceso de red. Se conserva esa base para construir la PR sin sustituir main.
- Supabase consultado solo en lectura: columnas operativas, auditoría, integración y seguimiento; funciones de cobertura y confirmación Shopify; leases y triggers.
- Referencia: 24 pruebas de seguimiento pasan. El primer build detectó una copia local truncada de Gmail; se recuperó del mismo commit antes de modificar producto.
- El seguimiento existente acepta cuenta propia, proveedor y tracking sin exigir una etiqueta. El registro externo no fabrica PDF ni fecha de etiqueta.
- Shopify reintenta confirmaciones mediante dos RPC; Amazon dispone de reintento automático y forzado. Es necesario persistir la decisión de notificar y proteger ambos canales.
- Automatización existente de consumo: 23/10 11:20 Europe/Madrid, no se crea otra.

## Implementación y verificación previstas

1. Registro atómico con bloqueo de fila, validación de actor/workspace/cuenta, protección de expedición existente y lease, idempotencia y auditoría. Estado de seguimiento sembrado solo para ese pedido.
2. Modal con FormModal/FormGrid de @zenvia/ui, campos obligatorios, opcionales y notificación desmarcada. Inventario de acciones conservado.
3. Pruebas SQL con datos sintéticos, pruebas de UI/reintentos/lease, build y capturas antes/después a 390/1280/1440.
4. Preparar PR y rollback. Detenerse antes de producción para revisión visual.

## Límite operativo

No se ejecuta registro, reproceso ni DML sobre producción durante la preparación. No se generan documentos, etiquetas ni confirmaciones reales. MFA y PayPal fuera de alcance.

## Implementación revisada

- El registro deja el pedido localmente `shipped`; no modifica los campos de confirmación Amazon/Shopify ni llama al canal. Así sale de Pendientes usando el clasificador y la proyección existentes, sin reconstrucción global.
- Una marca JSON conserva autor, fecha, petición idempotente, datos y elección de notificar. `shipping_cost_source=external_manual` identifica el envío también en la proyección ya publicada, incluso si falta el coste. Sin consultas adicionales por página.
- Se bloquea un pedido con etiqueta previa cancelada: reemplazar tras cancelación sigue siendo 2b. Nunca se reutiliza accidentalmente un tracking state antiguo.
- La inserción de tracking afecta exclusivamente al pedido registrado y su cuenta; el worker existente lo recoge normalmente. Sin integración se informa de seguimiento manual.
- Los reintentos no pueden confirmar un envío sin autorización: guardia sobre la escritura del intento Amazon/lease Shopify. Las RPC Shopify excluyen esos pedidos de su cola.
- Shopify v6 estaba desplegado pero no versionado en main. Se añade su entrypoint con un único cambio de elegibilidad para admitir envío externo sin una fecha de etiqueta ficticia.
- Revisión independiente: detectó clasificación pendiente y reutilización de cancelación; corregidas. Segunda revisión sin bloqueos importantes.

## Publicación futura: puerta obligatoria

**No autorizada todavía.** Revisar primero la galería y CI. Antes de aplicar, volver a comparar cada fuente/ACL con producción y capturar sus snapshots actuales.

1. Migración aditiva `20261022150219_register_external_shipment.sql`; no registra ni reprocesa datos existentes. Afecta esquema, dos RPC Shopify mediante sustitución comprobada y una guardia nueva.
2. Nueva Edge `register-external-shipment`, JWT y autenticación humana existentes. Actor/owner proceden de autenticación, nunca del cuerpo del cliente.
3. Adaptación mínima de `shopify-confirm-shipment`: **preservar todos los archivos de dependencia del bundle v6 capturado**, cambiando solo el entrypoint revisado. El helper local `amazon/supabase.ts` contiene MFA y `shopifyShipment.ts` contiene otras diferencias: NO desplegarlos bajo esta tarea. Snapshot: `supabase/snapshots/20261022-external-shipment/shopify-confirm-shipment-v6.json`.
4. Protección contra comprar otra etiqueta: comprobar snapshots y aplicar únicamente la guardia `external_shipment` en `_shared/amazonPiiRead.ts` a los bundles de MRW, Envia, sendcloud-orders y sendcloud-order-tools que lo consumen. No reemplazar otras dependencias ni modificar autenticación.
5. Publicar frontend solo con autorización del propietario; nunca main/merge anticipado. Verificar a 390/1280/1440 sin guardar pedidos reales.

## Rollback preparado

Operativo preferido: revertir frontend al commit base y revocar ejecución de `register_external_shipment` al rol service_role para desactivar altas. Conservar metadatos/auditoría/seguimiento existentes y las guardias de no notificar. No borrar registros externos para volver atrás.

El rollback de esquema exacto está en `supabase/rollback/20261022_external_shipment.sql`: aborta si existe cualquier registro externo; restaura las dos definiciones Shopify previas y retira solo objetos nuevos. No ejecutado en producción. Restaurar Shopify desde su bundle capturado si la ventana lo permite, teniendo en cuenta que la versión antigua no confirma envíos externos.

## Evidencia visual y funcional

Galería: [antes/después](20261022-external-shipment-review/README.md). Usa OrderDrawer y ExternalShipmentModal reales, CSS de aplicación, datos sintéticos, red bloqueada y persistencia de fixture.

El manifiesto compara botones y disabled de pedidos pendientes/etiquetados a los tres anchos, claro/oscuro. Mantiene todas las acciones anteriores; verifica selección de cuenta MRW, notificación desmarcada, registro único, estado Enviado, detalle de expedición y ausencia de Imprimir/Descargar sin etiqueta.

Límites: no se ha probado una confirmación comercial real ni el sondeo de un tracking real. PGlite prueba transacciones y contratos SQL, pero no contención entre conexiones de un servidor PostgreSQL. El bloqueo de fila y el lease compartido se verifican mediante SQL y regresiones de concurrencia existentes.

## Verificación local final

- Suite general Vitest: **554/554**, 101 archivos, 141,42 s; después se añaden dos comprobaciones del rollback que se ejecutan junto a toda la suite SQL del registro.
- Suite Node usada por CI: **1281/1281**, cero fallos.
- TypeScript y build Vite completos: correctos; verificador del icono iOS correcto. Se conservan los avisos existentes de chunks grandes/imports dinámicos.
- Capturas: 390/1280/1440, claro/oscuro; inventario de acciones y disabled comparado contra base inmutable; selección real de cuenta MRW; sin solicitudes comerciales.
- `git diff --check`: correcto. CI remota se comprobará en la PR; no se confunde con verificación local.
- Las primeras ejecuciones localizaron archivos omitidos al copiar el repositorio (imagen del logo, iconos y dos documentos de pruebas); se recuperaron del mismo commit y las suites se repitieron. No se modificó el producto para ocultar esos fallos.
- Registro y rollback: **26/26 pruebas SQL** tras añadir las dos pruebas del rollback. El rollback vacío restaura las funciones y retira la columna; con un registro existente aborta sin pérdida.

## Entrega para revisión

PR **#287**, rama `feature/register-external-shipment-20261022`, abierta como borrador. La base sigue siendo `0ae9622b1da1bf6f0901b6c27a4bb2982ac67750`. Se han subido las 48 fuentes/evidencias previstas conservando el árbol base; no se ha fusionado ni publicado. El harness usa esa base inmutable por defecto (la copia local equivalente se indica con EXTERNAL_BASELINE).

CI remota en curso al escribir este recibo; consultar los checks de la PR para su resultado final. La segunda revisión de código no encuentra bloqueos importantes. El siguiente paso del propietario es revisar la galería, antes de autorizar producción.

### Dependencia histórica descubierta por CI

El run `39804687217` falló al arrancar Supabase **desechable**, antes de ejecutar las pruebas reales: las funciones `integration_shopify_pending_shipments` y `integration_shopify_claim_shipment` existen en producción, pero no en el historial de migraciones. La nueva migración fallaba correctamente al no encontrarlas; no se suaviza esa comprobación ni se modifica SQL/auth/MFA de producción.

El runner ya reconstruye dependencias históricas ausentes a partir de fixtures. Se añade a ese mismo paso la fixture capturada de ambas funciones, con sus ACL reales (`postgres` y `service_role`, sin anon/authenticated). Cambio de cuatro líneas en el montaje de CI, sin alterar pruebas ni lógica MFA. Una regresión consulta `has_function_privilege` para comprobar que la migración conserva esas ACL. La suite SQL pasa a **27 pruebas**. Repetición remota pendiente de este recibo.

### Coherencia de importes y servicio

La revisión final añade un caso con una cotización preparada pero sin expedición. Al registrar el envío externo se retiran el desglose neto/IVA, código de opción y contrato de esa cotización: no describen el nuevo envío y no se inventa IVA a partir del total introducido. Regresión observada en rojo y corregida; se mantiene el coste total opcional y su moneda visible. Suite SQL ampliada a 28 casos.
