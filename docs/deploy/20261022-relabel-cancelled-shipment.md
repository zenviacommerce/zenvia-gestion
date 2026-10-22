# 2b — Reetiquetar tras cancelar

Estimación: 60–120 min. Base local 36c5c10, equivalente al head 2a remoto 9daa83b6e28214ae8ab68978c15c1dc6da8b98f9. Trabajo en rama separada fix/relabel-cancelled-shipment-20261022. No publicado; las capturas requieren revisión antes de publicar según la regla del propietario.

## Evidencia previa

Consulta agregada de producción, sin PII ni cambios: cero filas con label_cancelled_at, cero operaciones de cancelación registradas y una fila Amazon Shipped con código de máquina CANCELLED, sin tracking, referencia, parcela ni URL de etiqueta y con fulfilled_at. Los clasificadores de UI y el guardia Amazon bloqueaban ese caso por confundir expedición cancelada con estado del pedido; Sendcloud añadía restricciones propias por Shipped.

## Cambio

- Regla común canRelabelCancelledShipment; cancelación acreditada por timestamp o código de máquina CANCELLED/CANCELED (Envia admite su código 4), sin descriptor activo. Nunca se usa una mención de cancelación en el mensaje libre.
- Mantiene bloqueados canal cancelado, entregado/devuelto/reembolsado, Amazon pendiente de pago, PII purgada y envío externo. No cambia source_status ni mueve retrospectivamente filas entre las pestañas.
- En el detalle cambia el rótulo a Etiqueta cancelada y aparece Preparar nueva etiqueta mediante el flujo existente. Se mantienen las acciones previas de pendientes/etiquetados.
- Cotizador sendcloud-order-tools y cotización/creación sendcloud-orders usan la misma excepción acotada. La edición actual ya pasa por order-logistics-state y no necesita relajación adicional.
- Tras confirmación de creación nueva, MRW/Envia/Sendcloud limpian el marcador anterior; MRW persiste fecha y referencia antes de descargar PDF y puede recuperar el PDF sin crear otra expedición. Envia reemplaza el código CANCELLED por preparación; Sendcloud elimina tracking cancelado anterior incluso cuando guardar el nuevo tracking esté desactivado.
- No hay migración, UPDATE masivo ni reprocesado. Operaciones de cancelación y auditoría existentes se conservan.

## Verificación y revisión

13 pruebas de elegibilidad observadas en rojo y después verdes. 8 pruebas de handlers reales Envia/Sendcloud, con SDK/HTTP de frontera sintéticos y lease/relectura reales: cotización en ambos endpoints Sendcloud, creación, cancelaciones inseguras, guardar tracking desactivado, Envia sin heredar CANCELLED. 11 regresiones del lease/guardias pasan: 32 casos dirigidos correctos.

La revisión independiente encontró los bloqueos Sendcloud y la recuperación de PDF MRW; ambos se reprodujeron en rojo y corrigieron. Se amplió el test real de MRW: Shipped/cancelado → creación confirmada → fallo PDF → recuperación, sin segundo envío, fecha persistida y cancelación retirada.

Ruling: se retira el trigger provisional y se limpia el estado en el patch de creación confirmada de cada proveedor. Cubre MRW aunque falle el PDF y evita intervenir en imports/ediciones genéricas; si fuera incorrecto, un reemplazo podría quedar sin sondeo. Regresiones de los handlers comprueban los campos que impiden el sondeo y la recuperación del PDF.

La primera suite Node descubrió un único fallo de harness: eliminaba solo el primer export del helper, ahora con dos exports. Se usa replaceAll, sin excluir ni rebajar las pruebas. Suite posterior 1281/1281; regresiones MRW/pago finales 4/4. Suite general y build finales se anotan al terminar.

[Galería 390/1280/1440 claro/oscuro](20261022-relabel-review/README.md), con inventario y acciones disabled conservados; capturas inspeccionadas. Sin solicitudes comerciales reales, facturas, suscripciones ni cambios MFA.

## Rollback preparado

Frontend: revertir este cambio a la versión publicada de 2a. Backend: restaurar los cuatro bundles de creación/cotización guardados después de publicar 2a, preservando verify_jwt y los guards de envío externo. Sin rollback SQL ni borrado de registros; ninguna operación de cancelación se elimina. Antes de desplegar habrá que capturar las versiones exactas vigentes y aplicar solo los pequeños deltas revisados, conservando auth/MFA igual que en 2a.

Una ejecución general simultánea con Node terminó 591/592 por timeout de 30 s en pickup-reports-sql (prueba sin cambios), sin errores de aserción. Se repite la suite completa con dos workers y Node después, conservando el timeout y todas las pruebas. No se cambia código de recogidas ni se oculta el fallo.

Resultado de repetición completa: **592/592 Vitest**, 104 archivos, dos workers, 199,27 s; conserva los timeouts originales. Build completo correcto con los avisos de tamaño de chunks ya existentes. Node final se anota tras su terminación. git diff --check correcto.
Node final secuencial: **1281/1281**, cero fallos, 31,06 s. Se comprueba además la regresión MRW posterior a persistir fecha antes del PDF, sin segundo envío. Sin cambios pendientes de implementación; detener antes de publicar 2b.
