# Circuito de corrección — diseño y plan de ejecución

Especificación vinculante: decisiones del propietario del 24/10/2026 para ampliar #306 antes de cualquier publicación. No se solicita una aprobación adicional de diseño: el circuito pedido está definido y la revisión final sigue pendiente.

## Decisiones

Ampliar el editor actual, con componentes de @zenvia/ui, frente a crear otro editor fiscal. El borrador rectificativo se crea transaccionalmente desde la original, sin consumir número; el propietario elige R1–R5 y S/I, explica el motivo y edita las líneas. S precarga los valores originales (importe correcto final); I precarga las líneas a cero (diferencia explícita, evitando confundir un abono total). El número solo se asigna al emitir en serie rectificativa. El vínculo usa número/fecha de la original, y existe navegación en ambos sentidos. El estado Rectificada es derivado de rectificativas emitidas no anuladas, sin alterar el documento fuente. Anulada es derivado de la tabla de anulaciones, preservando el estado comercial original. No se cambia contabilidad ni cobros retrospectivos.

Anular requiere declarar operación inexistente o emisión duplicada, motivo y confirmación; para cambios de importes se dirige a rectificativa. Se registra por la RPC existente, conservando el original y su número. No se infiere automáticamente la procedencia jurídica. No se permite anular documentos con correcciones activas. La operación queda auditada incluso con captura disabled.

Legado: no tocar ni corregir F202650/F202654 ni otras emitidas. No generar registros retroactivos. El encadenamiento empieza con la primera emisión posterior a la activación shadow aprobada; la obligación de remisión futura no se confunde con esta observación en sombra.

## Restricciones globales

- Sin SQL ni publicación en producción. PR #306 en borrador.
- Sin AEAT, certificados, Google Cloud, PayPal ni suscripciones.
- Guardas de emitidos y MFA intactas; solo borradores editables/borrables.
- Migración adicional separada, rollback coordinado, sin DML sobre emitidas históricas.
- Capturas y pruebas con datos sintéticos locales, escritorio y móvil.

## Tareas

1. Backend y contratos: pruebas RED de creación atómica, S/I, motivo, tenant/MFA, bloqueo de anuladas y emisión; migración adicional con metadatos, RPC segura y lectura de estados. Mantener huellas del manifiesto canónicas. Verificar GREEN en PGlite y PostgreSQL real/CI.
2. UI/servicios/PDF: pruebas RED de selectores, motivo, líneas, intentos de editar, vínculos, estados y anulación con doble confirmación. Implementar en editor existente y modal de anulación @zenvia/ui; corregir PDF y estados derivados. GREEN de pruebas de comportamiento e inventario.
3. Evidencia y paquete: flujo sintético emitir→inmutabilidad→rectificar→anular; capturas antes/después a 1440/390 y claro/oscuro, PDF revisable; inventario DDL/DML y rollback, diario de corte histórico, plan de activación actualizado. Suite, build, contratos, revisión independiente y CI del head. Detener antes de producción.

## Focos de revisión

Concurrencia emisión/anulación/rectificación; identidad y snapshot originales; S frente a I con importe positivo/negativo/cero; recibos y facturas legado; cambios de modalidad al reabrir un borrador; estados derivados sin reescritura; MFA canónica; doble click/reintentos y errores conservando borrador; paginación y buscadores sin regresión.
