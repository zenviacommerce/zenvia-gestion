# order-cancellation restringido y piloto Amazon PII — 17 octubre 2026
Proyecto sjkxxbedkkmgmqnvaqjh. Horas Europe/Madrid (UTC+2).
## Cambios
- order-cancellation v2 → v3, JWT obligatorio conservado. Único cambio desplegado en su bundle: configuración Amazon compartida con credencial propia prioritaria, fallback únicamente para integration_accounts.id 4e55e0f5-9388-467c-b35c-a86dd4a7b383 configurado en AMAZON_LEGACY_FALLBACK_ACCOUNT_ID, error explícito "cuenta Amazon sin credenciales" y evento amazon_legacy_fallback_used sin token.
- La revisión completa de las 37 funciones (137 archivos empaquetados actuales) encontró además el lector inline sin restricción en integration-accounts y el indicador de configuración de amazon-status. Corregidos: integration-accounts v42 usa el cargador compartido; amazon-status v19 acota su indicador al id autorizado. Las credenciales propias prevalecen también si credential_source histórico dice environment.
- PR224 fusionada a las 15:03:45 tras CI verde; main fff020a414c404531660211a5ba99d3e58965da5. Incluye las correcciones urgentes y preparación de purga. https://github.com/zenviacommerce/zenvia-gestion/pull/224
- Migraciones aditivas 20261016185733_amazon_buyer_pii_guard y 20261016194728_amazon_pii_bounded_runner aplicadas antes de publicar el SELECT del frontend. Tombstones, columnas analíticas, guardas de escrituras, controles y cancelación, leases de lectura de 480 s, RPC service-only y runner acotado. Sin cron de purga.
- Funciones compatibles desplegadas y leídas de vuelta archivo por archivo/JWT: envia-shipping41, mrw-shipping21, sendcloud-orders31, sendcloud-order-tools33, order-logistics-state15, amazon-recipient-fallback7.
- Frontend público confirmado en https://gestion.zenviacommerce.com/assets/index-BkauntMi.js : piiPurgedAt 12 apariciones, pii_purged_at 2, destination_country_code 2 y aviso de retención 1. El bundle anterior index-CZubPrPc.js tenía cero apariciones de los tres marcadores. No se utilizó sesión de Vercel.
- Controles históricos de este owner minimizados con 754 llamadas confirmadas al helper, límite 50 por tabla/llamada: 37.598 jobs, 3.227 runs y 0 states. Último dry-run 0/0/0. Se conservan únicamente controles tipados y clases de error; no registros comerciales ni facturas se tocaron en este paso.
- Piloto EXACTO 10 pedidos canónicos / 10 filas fulfillment a las 15:19:59.535, run 23685adc-a3ed-4845-9a5c-b0880017953e, duración 1038 ms, errores 0. No se ejecutaron lotes posteriores ni se borró Storage; pilot_verified_at sigue NULL.

## OBFUSCATED_SHIPMENT_ID — decisión de dos líneas
Es una referencia opaca de envío en los movimientos financieros, no un campo de nombre, dirección, teléfono o email.
Se conserva como referencia económica: el censo completo y el código productor no muestran una copia de datos del comprador; no bloquea este piloto ni se altera la identidad/deduplicación financiera.

Límite de la evidencia: el enum de relatedIdentifiers del modelo oficial Finances2024-06-19 (commit af0be99a754fba53d46d6a845a5aba8f99f077c4) no nombra OBFUSCATED_SHIPMENT_ID. No se atribuye a Amazon una definición documental inexistente. En producción se observaron 41.795 identificadores de este tipo, todos de forma opaca y emparejados con SHIPMENT_ID (distintos, no equivalentes). Censo recursivo completo de 44.185 metadatos en45 tandas, profundidad32 y cero truncaciones: exclusivamente breakdownAmount/breakdownType/breakdowns/currencyAmount/currencyCode/marketplaceId. Código safeIdentifiers copia identificadores de negocio del proveedor. Se retiene esa referencia, no datos de contacto. Fuente: https://github.com/amzn/selling-partner-api-models/blob/af0be99a754fba53d46d6a845a5aba8f99f077c4/models/finances-api-model/finances_2024-06-19.json

## Evidencia
### Tests / publicación
- Selección de credenciales real ejecutada en VM: snapshot order-cancellation RED 6fallos/6correctos → GREEN12/12; otros lectores RED4/2 → GREEN6/6. Junto a12tests previos:30/30.
- Suite completa de seguridad1027/1027; preparación PII1075/1075 y35/35Vitest/build; comprobación combinada posterior1093/1093 Node,0fallos.
- CI del head e095c43c5a8c5c99ab193bf4c9db1644a02bb456: build y auth-tests verdes antes de fusionar. https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39034667284 ; https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39034667266 ; https://github.com/zenviacommerce/zenvia-gestion/actions/runs/39034667318
- Las tres RPC public.amazon_pii_run_batch / amazon_pii_scrub_control_copies / amazon_pii_claim_external_read: anon=false, authenticated=false, service_role=true. Tablas privadas con RLS. Gates registrados sólo tras evidencia real de reconciliación/ciclo, despliegue compatible, revisión de copias y frontend público; espera adicional antes de anonimizar de896s desde último despliegue (>400s + margen).
- Pruebas HTTP sin sesión, cuerpo vacío y sin ids de negocio: cancellation401; envia/mrw/sendcloud-orders/sendcloud-tools/logistics401; integration-accounts401; amazon-status403. No cancelaciones, etiquetas ni confirmaciones comerciales de prueba.

### Selección / comprobaciones de producción
- Dry-run real15:19:45 y nueva comprobación dentro de la transacción:10/10, huella bcf702392d8b4df8ac1037ce1a328690 idéntica al write. Compra más antigua11febrero; fecha límite más reciente3junio2026 10:03:03UTC. Regla compra+1440horas, sin inferir entrega de estados ni excepción fiscal.0identidades inválidas,0fechas ausentes,0leases activos;446grupos aún dentro de plazo.
- SQL inmediato y repetido después del ciclo:10marcados/10tombstones;0violaciones de nombre/email/teléfono/direcciones/raw_payload;0capacidades de tracking/etiqueta;0cambios económicos o incumplimientos de fecha. Ningún pedido adicional marcado.
- 10/10 RPC de lectura externa devuelven purged; no adquieren lease ni llaman al transportista.
- Registros normalizados y financieros idénticos antes/después y tras ciclo:10amazon_orders huella2223d159b1e8f6fc9a957a3030e85bfc;10amazon_order_items huellabfb01eff6d28eb777cf58bca63494d54;14amazon_finance_transactions huella188522bc02b8ea3d69520b568c9695b5.
- IVA estimado como en UI:8pedidos con importe,7con país ES;3países ya ausentes y2importes ya nulos. Bruto total292,21; neto243,92388429752066115704; IVA48,28611570247933884296 antes y después. Analítica excluyendo cancelados/EUR: bruto278,22 e IVA48,28611570247933884296 (48,29€ redondeado). País, importes, moneda, costes, SKU y cantidades se conservaron.
- Antirrepoblado: se ejecutó el importador operativo realmente descargado de amazon-sync-orders con los10identificadores e importes conservados y datos de comprador FICTICIOS; generó20escrituras/10filas,0HTTP. Sus patches se aplicaron a las10filas reales en una transacción con ROLLBACK:10/10seguían anónimas dentro de la transacción. No se copiaron datos personales reales.
- Después del piloto, ciclo NATURAL de pedidos:18jobs orders iniciados15:20:03 y finalizados15:20:31,18success,0failed,0reintentos. Cola elegible0, diferida0, running0, lease vivo0; relectura mantiene10anónimos. No se afirma que Amazon haya vuelto a devolver esos10pedidos históricos; la prueba dirigida anterior cubre su escritura y las guardas reales. No se forzó orchestrator ni se hicieron GETs históricos extra.
- Intervalo12:55UTC hasta consulta final:9finances success239rows_processed,9inventory success2781rows_processed,64orders success832rows_processed;1intento de job recuperado con clase AMAZON_QUOTA_429. Estos son jobs/filas, NO número exacto de HTTP SP-API.
- Logs agregados del intervalo:0Auth5xx,114eventos fallback y0fuera de la cuenta autorizada. Baseline inicial36/60; muestreos posteriores27–34durante despliegue/limpieza, último29/60;0failed. No se activó ningún criterio operativo de rollback.

## Auditoría de todas las Edge Functions
Las lecturas del token Amazon de entorno se limitan al config compartido restringido (12roots); amazon-status añade sólo un indicador condicionado al mismo id. No queda lector Amazon sin restricción, ni selección Amazon basada en credential_source=environment.
Sí quedan condiciones environment para credenciales de Sendcloud en6roots/archivos inventariados: sendcloud-orders,sendcloud-order-tools,integration-accounts,order-logistics-state,order-cancellation/_shared/cancelCarriers.ts y amazon-recipient-fallback (seis roots, todos sin selección de token Amazon por esa condición). No son refresh tokens Amazon y no se cambió ese mecanismo ajeno a este alcance.

| Función | Versión | JWT | Archivos | Lectura token Amazon |
|---|---:|---|---:|---|
| admin-users | 26 | sí | 1 | no |
| sendcloud-orders | 31 | sí | 3 | no |
| sendcloud-order-tools | 33 | sí | 2 | no |
| amazon-status | 19 | no (auth interna/propia) | 6 | restringida al id + Vault prioritario |
| amazon-sync-manual | 24 | sí | 8 | restringida al id + Vault prioritario |
| amazon-sync-orders | 20 | no (auth interna/propia) | 6 | restringida al id + Vault prioritario |
| amazon-sync-finances | 18 | no (auth interna/propia) | 7 | restringida al id + Vault prioritario |
| amazon-sync-inventory | 13 | no (auth interna/propia) | 6 | restringida al id + Vault prioritario |
| amazon-sync-orchestrator | 18 | no (auth interna/propia) | 8 | restringida al id + Vault prioritario |
| amazon-sync-worker | 38 | no (auth interna/propia) | 12 | restringida al id + Vault prioritario |
| noop | 10 | sí | 1 | no |
| amazon-sync-fx | 35 | no (auth interna/propia) | 3 | no |
| amazon-backfill-finance-components | 18 | no (auth interna/propia) | 3 | no |
| amazon-confirm-shipment | 18 | sí | 7 | restringida al id + Vault prioritario |
| transport-tariff-parser | 12 | sí | 1 | no |
| amazon-sync-product-images | 23 | no (auth interna/propia) | 5 | restringida al id + Vault prioritario |
| integration-accounts | 42 | sí | 5 | restringida al id + Vault prioritario |
| support-notify | 10 | no (auth interna/propia) | 2 | no |
| platform-admin | 15 | sí | 1 | no |
| platform-bridge | 29 | no (auth interna/propia) | 3 | no |
| customer-billing | 9 | sí | 1 | no |
| platform-mailer | 10 | no (auth interna/propia) | 2 | no |
| app-agent | 19 | sí | 1 | no |
| envia-shipping | 41 | sí | 3 | no |
| invoice-document-intelligence | 7 | sí | 1 | no |
| order-logistics-state | 15 | sí | 3 | no |
| mrw-shipping | 21 | sí | 3 | no |
| shopify-orders | 11 | sí | 3 | no |
| app-agent-tools | 2 | sí | 2 | no |
| mrw-label-diagnostic | 5 | sí | 1 | no |
| amazon-reconcile-orders | 8 | no (auth interna/propia) | 6 | restringida al id + Vault prioritario |
| amazon-order-diagnostics | 3 | sí | 1 | no |
| shopify-confirm-shipment | 6 | sí | 4 | no |
| order-cancellation | 3 | sí | 8 | restringida al id + Vault prioritario |
| amazon-recipient-fallback | 7 | no (auth interna/propia) | 3 | no |
| shopify-analytics-sync | 9 | no (auth interna/propia) | 4 | no |
| amazon-performance-diagnostic | 10 | sí | 1 | no |

## Desviaciones y límites
- Se corrigieron integration-accounts y amazon-status además de cancellation porque la revisión completa demostró lectores/indicador sin restricción. No se modificaron MFA/OAuth/#216.
- El empaquetador omitió dependencias que ya no se importan; la comparación se realizó sobre el cierre de dependencias realmente desplegado, con igualdad de todos sus archivos.
- El parche de cancellation conserva exactamente dependencias preexistentes ajenas al problema (incluidos http.ts y shopifyAuth.ts antiguos, diferentes del main compartido); no se afirma igualdad de esos bundles antiguos con un rebundle completo desde main. La seguridad config y los entrypoints corregidos sí están versionados en main.
- Dos tandas agrupadas de limpieza alcanzaron statement_timeout y se revirtieron completas; se redujo agrupación hasta2llamadas por consulta. Cada helper sigue limitado a50filas/tabla. No hubo piloto parcial ni fallo de jobs.
- amazon-recipient-fallback devuelve500 con "Sesión no válida" para la prueba anónima. El mismo catch existía en v6: rechazo antes de consultas de cuentas/transportista, no regresión del piloto y no Auth5xx. Defecto HTTP preexistente pendiente; no se maquilló como401.
- El conector asignó inicialmente versiones de historial20261017130335/20261017130337 a las dos migraciones ya existentes del repo. Se reparó únicamente ese metadato, con comprobación de dos filas esperadas y ausencia de destino, para alinearlo a20261016185733/20261016194728 sin reejecutar DDL; versiones originales conservadas en migration-ledger-before.json.
- UI autenticada queda a cargo del usuario según autorización. No se declara smoke visual ejecutado. El marcador en el bundle público demuestra publicación de frontend, no uso completo en navegador.
- Censo/revisión de copias cubre tablas SQL e inventario de productores; no es borrado de Storage, proveedores, descargas locales, logs remotos o backups administrados. Ninguna factura de otro ámbito se modificó.

## Rollback
No rollback operativo ejecutado: el429recuperado es normal, no disparador.
Snapshots exactos de código/JWT ANTES de desplegar: credenciales commit2b686fef62c774a9a475ae61fb48964faf6ce52c, docs/verification/20261017-credential-snapshot; seis roots PII commitba15d2c428d6fca1bebc9d46c4949d755e878682, docs/verification/20261017-pii-edge-snapshot. Restaurar bundles completos/JWT, comprobar readback y auth; restaurar un lector vulnerable reabre el riesgo y sólo es medida de emergencia.
Tras anonimización NO restaurar datos personales ni retirar tombstones/guardas: cualquier pantalla/proceso roto se corrige en código conservando las10filas anónimas y parando lotes. No se creó backup PII. Restaurar frontend antiguo completo podría perder bloqueos; cualquier corrección debe mantener la protección.
Sin cron de purga; pilot_verified_at NULL impide nuevos lotes. Storage se conserva para su fase posterior.

## Diez pedidos para revisión visual
| Referencia Amazon (búsqueda en Pedidos) | UUID fulfillment |
|---|---|
| 407-8955292-3228323 | a8801896-ad00-4b29-b973-597fa874838e |
| 402-4482176-6710710 | a516a79b-93de-4148-b669-7d7e7eeac3e7 |
| 406-4572220-0247554 | e3b451e0-092a-418f-a740-fac7f0f2693c |
| 403-1104705-6572360 | b0e3d20d-c211-4894-8111-38ed79c28979 |
| 407-1865750-8266730 | f319ee74-1489-4c64-92d3-1343e4956575 |
| 408-7574095-4719530 | 2cede0df-5082-4f5d-b6c1-596f0e306a14 |
| 405-1739549-8265931 | 4943259e-1353-4911-8e85-0f7310844c8b |
| 408-7873699-8232313 | d40b9a90-d96b-4b75-a2ba-3e739904503e |
| 402-7269678-9343507 | 73f5b7c5-4ca5-4665-b73a-25843900b80b |
| 406-5007292-6629143 | 0f460bcf-730a-4be7-91e0-3ecc833da2f2 |

## Lista de comprobación para el usuario (6 puntos)
1. Recarga https://gestion.zenviacommerce.com/ ; Pedidos → Amazon → Todos, intervalo11/02/2026–04/04/2026. Busca cada referencia de la tabla; debe existir y abrir sin error (incluye3cancelados).
2. Listado: sin nombre/contacto del comprador; referencia, fechas, SKU/cantidades e importe cuando existía siguen visibles. Nombre real o fila desaparecida indica fallo.
3. Detalle: sin dirección/email/teléfono; aviso "Datos personales eliminados. Envío y etiquetas no disponibles.". Error de pantalla, datos reales o aviso ausente indica fallo.
4. Acciones: no preparar/imprimir/descargar etiqueta ni tracking para estos pedidos; no seleccionar para etiquetas en lote. Comprueba sólo disponibilidad de controles, sin crear un envío. Si permite esas acciones, indica fallo.
5. Pedidos/IVA y Analítica Amazon: filtros de marzo/abril cargan sin error. En los7pedidos ES del piloto, bruto conjunto278,22€, IVA estimado48,29€; no confundir con el total del periodo, que incluye otros pedidos. La purga no debe alterar las cifras.
6. Actualiza pedidos y vuelve a abrir uno enviado y uno cancelado: deben seguir anónimos. No existe exportación CSV de Pedidos; las exportaciones operativas presentes son etiquetas/PDF/ZIP, que deben omitir/bloquear estos pedidos. Cualquier excepción, descarga personal o repoblado indica fallo.

Esperar confirmación explícita del usuario antes del resto de lotes.
