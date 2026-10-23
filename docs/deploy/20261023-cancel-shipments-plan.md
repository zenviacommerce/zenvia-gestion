# 2c — cancelar expediciones desde Gestión (sin publicar)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Implementación nativa, una revisión independiente completa al final.

**Goal:** Cancelar expediciones de Envia, Sendcloud y MRW sin liberar reetiquetado hasta confirmación.
**Architecture:** Reutilizar operaciones duraderas y leases existentes, parsing estricto de contratos oficiales, UI de detalle y modal compartido.
**Tech Stack:** Supabase PostgreSQL, Deno Edge, React y @zenvia/ui.
**Spec:** instrucciones del propietario en esta conversación; diseño recogido debajo.

## Review Focus
- Timeout tras enviar la petición: estado incierto, sin segundo POST al comprobar.
- Confirmación antigua y referencia repetida entre cuentas/proveedores: nunca borrar la etiqueta nueva.
- Cambio de orden/cuenta mientras carga la UI: no mostrar ni enviar datos del pedido anterior.
- Respuesta con texto de cancelación pero sin contrato de éxito: no confirmar por substring.
- Piloto MFA/PII y permisos: misma protección que las funciones de transporte vigentes.


Estimación anunciada:2–3h. Base publicada: main6ead7df805ab4a975697d057242b2843e1ae8688, 2b con historial persistente. Aprobación pendiente para publicar2c.

## Diseño

Acción Cancelar envío en el detalle de una etiqueta activa, con modal @zenvia/ui: pedido, transportista/cuenta, tracking y condiciones. Requiere confirmación explícita. Conserva Descargar/Imprimir/Editar y demás acciones. No se emiten facturas ni se cancelan pedidos Amazon/Shopify desde este flujo.

Estados separados: solicitud en curso, pendiente, resultado no confirmado, rechazada y confirmada. Solo la confirmación válida retira los descriptores activos; entonces2b habilita Preparar nueva etiqueta y mantiene el historial anterior. Estado incierto conserva la etiqueta y el bloqueo de reetiquetado; Comprobar cancelación consulta sin reenviar la petición. Un timeout no se reintenta automáticamente.

Se reutiliza order_cancellation_operations con actor/fecha/resultado, RLS y RPCs service-only. Se fortalece la identidad proveedor+cuenta+referencia+generación y el bloqueo de fila compartido con creación. Una confirmación antigua no puede limpiar una expedición nueva. La función antigua desplegada conserva un helper de autenticación anterior sin guard MFA; el paquete propuesto debe adoptar el helper vigente probado en producción, conservando configuración y cohorte piloto. No se despliega ahora.

Transportistas: Sendcloud interpreta200/status cancelled frente a202/cola y consultas de parcela; Envia interpreta meta cancel y confirma solo si la respuesta corresponde al tracking, sin inferir de texto libre; MRW usa CancelarEnvio oficial, requiere respuesta sin SOAP Fault y referencia coincidente. Los resultados no reconocidos quedan sin confirmar. No se promete devolución de importe ni cancelación fuera de las condiciones del transportista.

Fuentes primarias consultadas (23/10/2026):
- https://sendcloud.dev/api/v2/parcels/cancel-a-parcel
- https://sendcloud.dev/docs/tracking/tracking-statuses/
- https://docs.envia.com/reference/cancel-shipment
- https://docs.envia.com/docs/core-workflow
- https://sagec.mrw.es/mrwenvio.asmx?op=CancelarEnvio

## Plan y verificación

1. Tests rojos de los tres adaptadores con contratos oficiales, cola/rechazo/timeout/respuesta equivocada, y consulta sin mutación. Implementar parsing estricto y saneado; no registrar cuerpo SOAP/credenciales.
2. Tests SQL reales de claims/idempotencia, identidad completa, solicitudes competidoras, confirmación tardía y persistencia de historial2b. Preparar migración y rollback con definiciones vigentes capturadas; no aplicarla en producción.
3. Servicio y componentes de detalle/modal con lectura aislada, confirmación explícita y busy. Tests UI de la secuencia confirmación→pendiente→confirmada→reetiquetar, conservación de acciones y errores seguros. Mobile390sin overflow.
4. Antes/después390/1280/1440claro/oscuro, estados de los tres proveedores, inventario completo, datos sintéticos/red externa bloqueada. Suite/Node/build/Deno, revisión independiente y CI final verde. PR en borrador, detener antes de publicar. Sin cancelar ni generar expediciones reales, sin SQL destructivo ni reprocesados de producción.

## Interfaces y archivos

- Task1: crear _shared/carrierCancellationPolicy.ts con parseSendcloudCancellation(httpStatus,payload), parseEnviaCancellation(payload,tracking,carrier), parseMrwCancellation(xml,reference), devuelve {status,message}. Modificar cancelCarriers.ts para conservar HTTP status, usar parsers y consultas readonly; tests/carrier-cancellation.test.ts (rojo→verde).
- Task2: fortalecer integration_start/finish_cancellation en migración nueva; identidad de generación en p_details; conservar firmas y ACL service-only. tests/order-cancellation-sql.test.ts ejecuta definiciones de producción capturadas y migración; pending bloquea claim, idempotencia, confirmación obsoleta, historial2b. Modificar order-cancellation/index.ts para p_kind label con identidad segura y estado guardado autoritativo; tests/order-cancellation-handler.test.ts.
- Task3: crear src/services/orderCancellation.ts, componentes OrderCancellationPanel.tsx y CancelShipmentModal.tsx con FormModal; conectar en OrderDrawer conservando acciones. tests/order-cancellation-ui.test.tsx. Modal permite cancelar solo la expedición mostrada y bloquea cierre/duplicados al enviar; RLS para lectura de operaciones.
- Task4: ampliar harness con escenarios de los tres proveedores (confirmar, en cola, no confirmado, rechazado), galería antes/después y manifiesto. npm test, Node, npm run build, Deno2.9.6; revisión independiente, PR borrador y seis checks verdes. No aplicar SQL/Edge ni fusionar/publicar.

Cada tarea: prueba fallando→código mínimo→prueba pasando→commit+diario. Sin dependencias nuevas.
