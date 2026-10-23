# 2b — historial persistente y publicación autorizada

Propietario confirma A/B en producción y aprueba 2b con transportista, tracking y fecha de cancelación anteriores visibles tras reetiquetar. Estimación inicial45–60min.

## Evidencia y decisiones

Producción previa main64a09358, MRW25/Envia45/Sendcloud-orders35/tools37. Cero operaciones de cancelación y cero pedidos con label_cancelled_at. Sin backfill ni reprocesado; no se actualizan los1023pedidos existentes. Nueva tabla separada de Platform shadow, con RLS workspace/permiso pedidos/MFA, escritura cliente denegada, limpieza al purgar PII del pedido.

Se prueban captura anterior→limpieza→nueva etiqueta→sincronización, deduplicado, siguiente ciclo y permisos/PII. Rojo observado por migración ausente, verde posterior. Componente: permanece tras cambio de etiqueta, ausencia explícita de datos antiguos, ocultación con PII.

Revisión independiente detecta único P2: valores NULL podían interpretarse como cancelación. Dos regresiones rojas lo reproducen y pasan al usar coalesce(boolean,false). Sin otros hallazgos. Pruebas focales finales8/8. Se cualifica explícitamente order_shipment_history.order_id en RLS; fixture incluye el order_id text real del pedido.

[Galería](20261023-relabel-history-review/README.md): cancelada y nueva etiqueta a390/1280/1440 claro/oscuro. Se conserva el inventario completo de acciones; inspección visual móvil después de reetiquetar correcta. No se inventan datos de referencias antiguas perdidas.

Los cuatro bundles de despliegue se construyen desde las dependencias frescas de producción, sustituyendo solo los cuatro entrypoints de2b y el helper de elegibilidad. Se comprueba igualdad byte a byte del entrypoint previo con la base revisada y se conserva MFA de producción. Deno2.9.6 verifica los cuatro bundles reales. Build correcto.

## Rollback

Snapshots completos: supabase/snapshots/20261023-relabel-before-publication. Restaurar los cuatro bundles con verify_jwt=true y frontendB dpl_9K2RvEJdTVrnMUKhA2u3t7Qv9GNw. Conservar tabla/trigger de historial para no perder evidencia ni detener su purga PII; no hace falta DROP, DELETE ni UPDATE de rollback. B permanece como lector de informes firmados.

No se invocan operaciones comerciales reales en pruebas. No se cambia MFA, PayPal, suscripciones ni informes existentes. La purga de informes sigue desactivada.

Validación final local:661/661 Vitest (118archivos),1284/1284Node, build correcto y Deno sobre bundles reales correcto. React: carga solo al abrir el detalle, dependencias primitivas, descarte de respuestas obsoletas y guardia PII; no se añaden listeners ni librerías.

CI detectó una incompatibilidad con el contrato de activación MFA existente: toda tabla pública expuesta debe tener las cuatro políticas restrictivas mfa_select/insert/update/delete_gate. La primera versión solo incluía comprobación MFA en la política SELECT. Se añade una regresión roja (0políticas frente a4), se adoptan los cuatro gates estándar en la tabla nueva, sin modificar ninguna función, configuración ni cohorte MFA existente. No se rebajan tests ni el scanner. Regresión focal posterior9/9.

Suite final tras adoptar gates estándar:662/662 Vitest en118archivos. La integración MFA real del nuevo head90af4f38 también termina con success; se espera el resto de CI antes de publicar. Producción sigue sin cambios.

Historial aplicado con versión real20261023042324: RLS activa,4gates restrictivos,0filas históricas,0hallazgos de activación MFA. Los1023pedidos y su fingerprint8e2b6bf3a0fab2a4599b4fec670457c0 permanecen idénticos antes/después; guard MFA33c89c211446450e2dadbe7e5b5760cf intacto. Se alinea el nombre de migración y su prueba con la versión asignada, sin cambiar un byte SQL. La galería sintética conserva el mismo origen Amazon Shipped después de reetiquetar, sin modificar el estado del canal.

Backend publicado: MRW26,Envia46,Sendcloud-orders36,tools38. Verificados todos los ficheros contra los payloads revisados, incluidas dependencias MFA de producción; verify_jwt=true. Probes sin autenticación:401enloscuatro endpoints, sin llamadas al proveedor. Frontend aún en B mientras pasa CI de la alineación de nombre de migración y las referencias de prueba.

## Publicación final completada

Headed3457f0149cec6610569fba4a99bf9ecb6f41bd, seis checks finales verdes:39900305968,39900305978,39900306246,39900305949,39900305986,39900305945. PR288 merge6ead7df805ab4a975697d057242b2843e1ae8688. Vercel READY dpl_9ZwSUSkgztVrf39oc42KM15Jg6Vx y dominio gestion.zenviacommerce.com HTTP200. JS servido index-CH0PVdtx.js SHA25698110ed78563563be1b7057b2c251927eefc1b37f476bad619cd2b29d24c67ad; CSS previo B intacto SHA2561d8486aac28204a71993fdf6880bf0ac4768ec423a638b9020b1eec3f962f211.

Verificación real de solo lectura: sesión autenticada, Pedidos carga y detalle conserva Editar pedido/Preparar etiqueta, sin error de carga del historial. No se crea ni cancela ningún envío real. Historial y cancelaciones0; pedidos1023; informes3 y firmas0; purga de informesfalse. Guard MFA mismo hash y0hallazgos.

El build local no reproduce el hash JS servido: se observa el identificador OAuth público de Google en producción, ausente del entorno local; replicarlo solo no iguala todo el entorno. Se registra esta comparación sin presentarla como igualdad byte a byte. La procedencia se verifica con el SHA del despliegue Vercel y la comprobación funcional de la versión publicada; los cuatro bundles Edge sí se han contrastado byte a byte con sus payloads exactos.

Se mantiene el rollback operativo documentado antes del despliegue, conservando el lector B y la tabla de historial con su limpieza PII. Continúa2c por separado, sin autorización para publicar2c. La tarea de consumo sigue habilitada para23/10/2026a11:20Europe/Madrid.
