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

1. Migración aditiva `20261022192947_register_external_shipment.sql` (versión MCP; preparada inicialmente con sufijo 20261022150219); no registra ni reprocesa datos existentes. Afecta esquema, dos RPC Shopify mediante sustitución comprobada y una guardia nueva.
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


## Ajustes aprobados por el propietario antes de publicar

Estimación inicial de este paso: 60–90 min; siguiente 2b: 60–120 min. Autorización explícita del propietario: publicar después de cuatro ajustes y CI verde. No se interpreta como autorización de pruebas comerciales.

- Selector MRW, Correos Express, CTT Express, SEUR, GLS, Correos, DHL, UPS, Nacex, FedEx, DPD y Otro. Cuenta MRW rellena MRW; los agregadores usan el carrier configurado si lo tienen (una cuenta Envia/Sendcloud puede operar varios transportistas). Normalización adicional en SQL para clientes antiguos, sin reprocesar filas.
- Estado de primera consulta para cuentas integradas con tracking y sin observación. No se infiere tránsito de un SHIPPED heredado. Una consulta fallida con cuenta muestra Consulta pendiente, sin afirmar que no existe integración.
- Alta programa next_poll_at explícitamente al momento de registro. Prueba SQL contra tracking_claim real demuestra que se reclama inmediatamente con MRW, sin etiqueta ni confirmación Amazon/Shopify. Producción comprobada: tracking activo y cron */5 * * * *.
- Tracking completo y seleccionable, botón Copiar con confirmación; el harness conserva lo introducido y verifica el texto íntegro recibido por clipboard. Antes la fixture fijaba SYNTHETIC aunque se introdujese SYNTHETIC-000123.
- Fecha dd/mm/aaaa y calendario español independientes del locale del navegador; hora hh:mm de 24 h; se rechazan fechas imposibles. Usa FormModal/FormGrid de @zenvia/ui y patrones existentes.
- Galería ampliada: [390/1280/1440 claro y oscuro](20261022-external-shipment-adjustments/README.md), calendario incluido; inventario de acciones y disabled preservado. Capturas inspeccionadas visualmente.
- CI del head anterior 26eb71c: los seis flujos completados success; no queda la X histórica de la dependencia Shopify ausente en el entorno desechable.
- Verificación: 32 pruebas SQL del registro, 9 regresiones de estos ajustes; suite general 569/569 antes de las últimas dos regresiones añadidas (las 9 juntas pasan); Node 1281/1281. Build completo correcto; repetición final tras ajustes de formato en curso.
- Revisión independiente detectó fallback legacy SHIPPED en la primera consulta; corregido con regresión observada en rojo. Sin otros bloqueos comunicados.

### Preflight y rollback de publicación

Base producción main 0ae9622b1da1bf6f0901b6c27a4bb2982ac67750. Vercel rollback READY: dpl_3mGW3zL16KPAMf99gM93HhRGzYyb, zenvia-gestion-p09izqx13-sergiorojasdiaz-7097.vercel.app. Proyecto prj_L6nGgpq78QTEnZByUNtjtmF5rGkv; dominio gestion.zenviacommerce.com.

Bundles actuales capturados completos en supabase/snapshots/20261022-external-shipment/: mrw-shipping v24, envia-shipping v44, sendcloud-orders v34, sendcloud-order-tools v36 y Shopify v6 ya capturado. El plan de despliegue preserva todos los ficheros actuales de cada bundle, verify_jwt=true, auth/MFA intactos; solo inserta la guardia external_shipment en amazonPiiRead y cambia la condición Shopify revisada. Nueva Edge register-external-shipment con validación de usuario/empresa/MFA vigente.

Inspección BD confirma columna external_shipment aún ausente. Migración aditiva y creación/reemplazo de rutinas; no ejecuta UPDATE/DELETE sobre pedidos existentes ni reprocesa datos. Rollback de esquema existente aborta si ya hay altas; rollback operativo conserva auditoría y envíos y desactiva la nueva alta. No se ha aplicado rollback ni despliegue al escribir este preflight.

### Recibo de ajustes y CI remota

Head de ajustes 457290965efbc0da55f9efd7c875d91ac6ea3e1b. Validación final local: 571/571 Vitest en 102 archivos, 1281/1281 Node y build completo correcto. Revisión independiente final sin bloqueos.

El run MFA desechable 39836124683 (job 120024824299) falla antes de ejecutar la integración real: Docker devuelve `toomanyrequests` al descargar imágenes. Las regresiones sintéticas del mismo job pasan. Se reintenta el job fallido sin cambios de código ni exclusiones. Producción todavía no modificada; publicación condicionada a que este commit quede verde.

El segundo intento (job 120026818322) repite GHCR toomanyrequests. La acción setup-cli fija ghcr.io para CLI 2.45.5; se explicita el registro predeterminado oficial public.ecr.aws en el job desechable. La fuente oficial CLI v2.45.5, internal/utils/docker.go, confirma que GetRegistry/GetRegistryImageUrl solo cambia el host y conserva las etiquetas; setup-cli src/main.ts respeta el valor configurado. Sin cambios de versión, auth/MFA de producción, SQL ni pruebas. Los otros cinco flujos del head previo pasan o completan sus jobs correctamente.

El mirror ECR también rechaza la descarga antes de migraciones: job 120028003912, `toomanyrequests: Data limit exceeded`. Se usa docker.io, tercer origen oficial admitido explícitamente por GetRegistryImageUrl de CLI 2.45.5, que conserva los nombres originales de las imágenes y sus etiquetas. El bloqueo sigue siendo infraestructura, sin modificar ninguna prueba ni versión.

El run 39837402762 ya pasa la integración real GoTrue/Vault con Docker Hub; los cinco flujos funcionales/build están verdes. El visual 39837402453 agotó su límite total de 15 min: la instalación de paquetes Linux de Chromium duró casi 12 min, luego MFA, Pedidos e imágenes pasaron sin fallos de aserción. La siguiente fase fue cancelada automáticamente a las 19:23:06 UTC. Se amplía solo el límite del job visual a 35 min, conservando todos sus pasos, verificaciones y artefactos. No se toca MFA en producción ni se omiten pruebas.

## Publicación autorizada — migración

Head aprobado 44eba8a88d2fd8829668e28da5070ef9a6160e62: seis flujos CI completados success (build 39839758752, visual 39839758784, integración real 39839758808, auth 39839758767, build check 39839758827, shared UI 39839758844). PR287 ready/mergeable/clean sobre base 0ae9622b.

Se aplica mediante apply_migration register_external_shipment el SQL versionado 20261022150219 sin cambios: success=true. No se registra ningún envío de prueba ni se reprocesan datos. Continúa verificación de ACL/metadatos y despliegue mínimo de Edge con bundles capturados.

## Publicación autorizada — backend verificado

Migración registrada por MCP con versión real 20261022192947, nombre register_external_shipment (el archivo fuente de preparación se generó como 20261022150219). Verificación: external_rows=0, authenticated sin EXECUTE, service_role con EXECUTE, dependencia Shopify parcheada.

Edge ACTIVE y verify_jwt=true: mrw-shipping v25, envia-shipping v45, sendcloud-orders v35, sendcloud-order-tools v37, shopify-confirm-shipment v7 y nueva register-external-shipment v1. Se vuelve a descargar cada bundle y se comprueba igualdad exacta por nombre y contenido con el plan: todos los ficheros coinciden, incluidas auth/MFA y helpers anteriores. No se ha desplegado código 2b.

La PR288 alinea el nombre del archivo de migración con la versión real 20261022192947 asignada por MCP y actualiza el lector del test. SQL idéntico byte a byte; no se ejecuta otra migración ni se repara/modifica el historial de producción. Evita que un db push posterior intente aplicar de nuevo el archivo con el timestamp de preparación.

## Publicación autorizada — frontend y comprobaciones finales

PR287 fusionada con expected_head_sha 44eba8a88d2fd8829668e28da5070ef9a6160e62. Merge main 036c49b78362a67921ffcffea522a4ad81e67a79. Vercel producción dpl_BU2EGbbPrHvenTxGPeXAANoovFDN, READY; alias gestion.zenviacommerce.com asignado al despliegue zenvia-gestion-b2efydlj0-sergiorojasdiaz-7097.vercel.app. Construcción Vercel: 55,41 s.

Dominio público sirve /assets/index-CHhzOa5O.js, SHA256 46ef34d496a73108363d012eaf6cb58afa19d3f6ee1c585cf8f06c87b1d18dcf. Comprobados en el bundle servido: Pendiente de la primera consulta, Copiar tracking, dd/mm/aaaa, Correos Express y Registrar envío externo. El POST sin Authorization al nuevo endpoint devuelve 401 UNAUTHORIZED_NO_AUTH_HEADER; no llega a registrar un envío.

Advisors de seguridad antes/después: cinco avisos existentes, sin cache_key nuevo ni retirado. No se afirma ausencia de todos los avisos previos del proyecto. Se conservan el tracking activo y el cron existente; no se emiten etiquetas, facturas ni confirmaciones comerciales reales para probar.

Rollback operativo preparado antes de publicar: restaurar frontend dpl_3mGW3zL16KPAMf99gM93HhRGzYyb y desactivar nuevas altas revocando ejecución del RPC, preservando registros/auditoría/guardias. Los snapshots completos anteriores siguen en 20261022-external-shipment/. Los cuatro bundles vigentes de 2a se capturan también en 20261022-relabel-base/ para el rollback futuro de 2b, sin perder la guardia de expedición externa.

2b se entrega por separado en PR288 como borrador, pendiente de revisión visual; no se ha desplegado su frontend ni sus cambios de Edge. La galería y la implementación publicadas de 2a son las aprobadas más los cuatro ajustes solicitados.
