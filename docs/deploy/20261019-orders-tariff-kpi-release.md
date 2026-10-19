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

Desviación explícita del dato histórico del usuario: la referencia anterior aplicada a los datos actuales clasifica MRW 194,57 € y Correos 60,16 €, manteniendo total 254,73 €. No se ha forzado un reparto histórico de 190,00/64,73 ni modificado envíos para ajustarlo. Es paridad de código/datos actuales; la causa histórica del reparto no está acreditada.

Selección global: test real de Orders con 63 coincidencias y página de 25 exige el enlace «Seleccionar los 63 pedidos que coinciden con los filtros», selección completa y 63 cotizaciones simuladas, cero creaciones de etiqueta. SQL cubre además >200 candidatos de tarifa fuera de página, filtros, aislamiento por tenant y direcciones purgadas.

## Fases pendientes

- CI de la PR.
- Aplicar migración y comprobar RPC real, permisos y paridad.
- Fusionar frontend con CI verde; verificar Vercel/alias/bundle.
- Recibo final y comprobación de usuario en navegador.
