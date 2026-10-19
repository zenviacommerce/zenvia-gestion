# Coste de transportistas: restaurar paridad tras #237

## Estado y autorización

Usuario acepta #237 bundle index-DB5LBqud.js salvo regresión de costes. Autoriza corregir, CI y publicar. Backend primero; no compras de etiquetas ni cambios de Auth.

## Causa y corrección

La tabla previa comparó estados y ventas/IVA, pero omitió costes, neto y ticket medio. La RPC sustituyó la valoración mixta del cliente por importes persistidos. Se añaden candidatos estrechos de tarifa del alcance completo del filtro; se reutiliza el estimador original con revisión histórica, IVA, combustible, servicio y peso. No se descarga la lista completa ni se cotiza contra proveedores. Se reemplazan estimaciones persistidas sin doble conteo. Neto de transporte conserva el fallback anterior al total cuando falta neto registrado.

Snapshot previo: supabase/snapshots/20261019-orders-tariff-kpi/before.json. Rollback SQL: definición previa exacta en 20261019140644_orders_dashboard_record_once.sql. Frontend: Instant Rollback a dpl_A2Hk6yLbRQMxQB4z2LsU5XyQzVUx / index-DB5LBqud.js; mantener RPC aditiva compatible. Preferible al frontend pre-MFA.

## Evidencia previa al despliegue

Datos actuales leídos con RLS authenticated y transacción revertida, 990 filas/1 tarifa. Referencia independiente: mapRow/dedupe/estados/taxParts/shippingPriceForOrder/calculateDefaultShippingPreview de commit 58badb4d. Se conserva presencia de campos para dedupe mediante marcadores; no se guarda PII en el repo. Comparación de cada indicador monetario a céntimos y conteos exactos, cinco periodos: sin diferencias. Resultados agregados en docs/review/orders-tariff-kpi/parity-results.json. Validación de nueva SQL en PGlite con los datos sanitizados de producción.

| Periodo | Coste | Valorados | Neto ventas | Ticket medio |
|---|---:|---:|---:|---:|
| Hoy | 30,39 € | 7/7 | 169,08 € | 29,23 € |
| Mes actual | 254,73 € | 58/58 | 2.896,73 € | 26,98 € |
| Trimestre | 254,73 € | 58/58 | 2.896,73 € | 26,98 € |
| Año | 1.538,34 € | 353/361 | 18.353,63 € | 24,29 € |
| Todo | 1.538,34 € | 353/361 | 18.353,63 € | 24,29 € |

La primera lectura mostró temporalmente MRW 194,57 € / Correos 60,16 €. Una segunda lectura detectó actualización de carrier_code/carrier_name de un envío de 4,57 € de MRW a Correos Express durante la comprobación. Con los datos actuales, referencia anterior y nueva RPC + estimador coinciden exactamente en el reparto informado: MRW 190,00 € / Correos 64,73 €, total 254,73 €. Sin cambios manuales en pedidos.

Backend aplicado por migración 20261019143018_orders_dashboard_tariff_kpi_parity. SECURITY INVOKER, anon sin EXECUTE, authenticated permitido. Comprobación real con RLS, cinco periodos, resultados en production-parity-results.json. Snapshot preparado antes de aplicar. 145 tests Vitest aprobados. CI pendiente antes de frontend.

Selección global: test real de Orders con 63 coincidencias y página de 25 exige el enlace «Seleccionar los 63 pedidos que coinciden con los filtros», selección completa y 63 cotizaciones simuladas, cero creaciones de etiqueta. SQL cubre además >200 candidatos de tarifa fuera de página, filtros, aislamiento por tenant y direcciones purgadas.

## Secuencia ejecutada

- Cinco workflows CI aprobados.
- Migración aplicada y RPC real, permisos y paridad comprobados.
- Frontend fusionado con CI verde; Vercel READY, alias y bundle comprobados.
- Recibo final guardado; comprobación del usuario en navegador pendiente.

## Frontend autorizado

PR #244 fusionada como ba755db9d3a07bd96a27a66591ff69c19bf2e5c9 tras cinco workflows verdes en c50584f600bc36617bb4decf72512c34588adfbd. 145 Vitest, 1.124 scripts Node y build local aprobados. Despliegue Vercel dpl_8s3zsHYC2pLAcqVXM2rxMFXERYs3 en construcción al registrar esta fase.

## Sesión y rollback MFA

Ver 20261019-auth-session-evidence.md: TOTP y AAL2 confirmados; causa del cierre previo no acreditada. No se ha verificado el ajuste Auth de 15 minutos. Si Auth aplica un máximo AAL1 a usuarios con factores verificados, un frontend sin desafío no permite elevar su sesión y puede provocar expiración al refrescar; no puede afirmarse que cualquier rollback cierre todas las sesiones cada 15 minutos. Preferir rollback compatible con desafío MFA. Configuración, factores y sesiones no modificados.

## Publicación verificada

Vercel READY dpl_8s3zsHYC2pLAcqVXM2rxMFXERYs3 y alias gestion.zenviacommerce.com apuntan al merge autorizado. HTML y JS HTTP200, bundle index-DIsFGH6G.js; texto «Costes registrados y estimaciones por tarifa» presente, banner de fixture ausente. Sin PGRST003/57014 en logs de 14:30:18–14:37:30 UTC. Recibo 20261019-orders-tariff-kpi-receipt.json. Se avisa al usuario para revisión con sesión real.
