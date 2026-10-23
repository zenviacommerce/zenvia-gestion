# Hoja de ruta — entrega de revisión 23/10/2026

## Reconciliación

PR #298, head `882456e526e1dc7214bbe03f6cbc62d683dac5de`. Worker, cron y activación desactivados; no se aplicó la migración ni se cambiaron handlers en producción. Se mantiene el punto de aprobación visual del propietario.

Comprobación final de GitHub Actions: **6/6 workflows correctos**: Build check 39959709469, Shared UI package and tab contracts 39959709398, MFA real integration disposable 39959709564, Auth resilience 39959709659, Build ZENVIA Gestión 39959709594 y MFA visual review 39959709400. Verificación local final 791/791 Vitest y 1292/1292 Node; cinco entrypoints Deno, build y contratos verificados. Se usaron servicios sintéticos, sin envíos/documentos/facturas/correos reales.

Galería de 36 capturas antes/después, 390/1440 claro/oscuro: `docs/deploy/20261023-shipping-reconciliation-review/README.md` en la rama de #298. Precuenta registrada: 0 marcadores *_CREATING, 0 leases vivos, tabla durable aún no instalada. Al publicar se repetirá, con rollback preservador de operaciones y activación separada. No se sustituye la aprobación por una CI verde.

## Rendimiento

PR #299, candidato WIP, no desplegado. 15 pruebas focales y 751/751 Vitest pasan. Medición pública anterior ~2,5 s pese a caché válida; candidato temporal mucho más rápido, pero con muestras >100 ms. Objetivo pendiente, sin afirmar mejora instalada. Regresión de invalidación perdida de evidencia e histórico reproducida y cubierta; rollback exacto preparado. Ver diario y benchmark en la rama de #299.

Se verificó que la medición temporal DO metrics ya se autodesprogramó; el coste de 294 llamadas es histórico. Se identificó el patrón real del lookup ASIN y su índice insuficiente para cuenta+orden de fecha; índice y cleanup siguen pendientes de validación. No se reseteó pg_stat_statements, reprocesaron pedidos ni cambiaron funciones persistentes de producción durante el trabajo de rendimiento.

## Diseño fiscal

Estimación al comenzar el diseño: 3–5 h. Documento [VERI*FACTU y rectificativas](20261023-verifactu-rectificativas-design.md), solo propuesta. Lectura de BOE consolidado/original y documentación técnica primaria AEAT; código actual e inventario agregado de producción contrastados. 29 facturas observadas: 1 borrador, 2 emitidas y 26 cobradas, todas ordinarias; sin modificar documentos.

Revisión independiente de construibilidad terminada: **nothing important left**. La revisión no equivale a dictamen fiscal ni aprobación del propietario. Las decisiones reservadas al asesor y a infraestructura están identificadas como puertas posteriores. No se implementó un núcleo fiscal, no se subieron ni pidieron certificados, no hubo remisiones a AEAT, ni correo real o actividad PayPal/suscripciones. MFA conserva el piloto existente.

Se detiene la implementación fiscal con el diseño para revisión. La #298 permanece sin publicar y el objetivo de rendimiento sigue abierto en #299; este diario no declara terminados los tres pasos.
