# Reetiquetar tras cancelar — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permitir preparar una nueva etiqueta cuando la expedición anterior está cancelada y no hay etiqueta activa, aunque el canal conserve Shipped.

**Architecture:** Regla compartida entre UI y validación Amazon con prueba de cancelación por timestamp confirmado o código de máquina. Mantener las cancelaciones del pedido, la protección de PII y el lease común; al persistir una etiqueta distinta se retira el marcador de cancelación anterior para que el seguimiento pueda activarse.

**Tech Stack:** PostgreSQL/Supabase Edge Deno, React y @zenvia/ui.

**Spec:** Backlog 2b del propietario; normas y evidencia en docs/deploy/20261022-external-shipment.md. Se conserva el flujo existente de elección de servicio y creación; no se generan etiquetas reales durante las pruebas.

## Global Constraints

- Evidencia antes que afirmaciones; rollback preparado antes de tocar producción; diario en docs/deploy/ tras cada paso.
- Cambios visibles: capturas antes y después a 390/1280/1440 px y DETENTE antes de publicar, salvo autorización explícita.
- Todo cambio de UI usa @zenvia/ui y docs/design-system.md, con el test de inventario de acciones.
- No tocar el MFA piloto ni publicar 2b junto con 2a. La autorización explícita actual de publicar cubre los cuatro ajustes de 2a.

## Review Focus

- Una nota que menciona cancelación no equivale a un código cancelado: regresión de elegibilidad.
- Una etiqueta activa o un envío externo sigue protegido: regresión de descriptor de expedición.
- Un pedido cancelado o entregado no admite reemplazo: regresión de estado del canal.
- Amazon pendiente de pago sigue bloqueado: regresiones de assertAmazonOrderShippable existentes y nuevas.
- Un nuevo envío no debe heredar el bloqueo del seguimiento anterior: regresión SQL del ciclo cancelación → nueva etiqueta.

### Task 1: Elegibilidad y acción de reetiquetado

**Files:** _shared/amazonShippingEligibility.ts; src/services/orderRelabel.ts; src/services/orders.ts; src/pages/Orders.tsx; tests/order-relabel.test.ts.

**Interfaces:** canRelabelCancelledShipment(order con campos snake_case) devuelve boolean; canRelabelOrder(FulfillmentOrder) adapta el modelo UI. Se consume desde canPrepareOrder y la guardia Amazon.

- [x] Escribir pruebas de Shipped+CANCELLED+sin etiqueta, timestamp confirmado, pedido cancelado, etiqueta activa, PII, envío externo y simple mención en mensaje. Observar el fallo.
- [x] Implementar predicado compartido y adaptación del modelo, conservando la guardia Amazon pendiente de pago.
- [x] Mostrar Preparar nueva etiqueta y Etiqueta cancelada en el detalle del caso elegible; mantener el flujo de servicios y las acciones previas.
- [x] Verificar tests de pagos Amazon, elegibilidad y lease compartido; comprobar inventario visual de acciones.

### Task 2: Ciclo de cancelación y seguimiento

**Files:** Edge mrw-shipping, envia-shipping, sendcloud-orders y sendcloud-order-tools; tests/order-relabel-sendcloud.test.ts; scripts/mrw-label-retry.test.mjs.

**Interfaces:** al confirmar el proveedor una expedición nueva, su patch limpia label_cancelled_at y el tracking cancelado previo. MRW persiste referencia/fecha antes de descargar PDF; no necesita trigger ni migración.

- [x] Reproducir en rojo los guardias Sendcloud que aún rechazaban Shipped y corregir ambos endpoints con la excepción acotada.
- [x] Probar en los handlers reales la cotización, creación, bandera de cancelación y limpieza del tracking anterior con guardado desactivado; Envia no hereda el código CANCELLED.
- [x] Probar MRW creación → fallo PDF → recuperación sin segundo envío, con fecha/seguimiento persistidos antes del PDF.
- [x] Ruling: retirar el trigger provisional y limpiar los campos en el patch de creación confirmada de cada proveedor — cubre MRW aunque no llegue su PDF y evita intervenir en imports/ediciones genéricas — coste si fuera incorrecto: un reemplazo podría quedar sin sondeo; las regresiones cubren esos campos y la recuperación.

### Task 3: Entrega revisable

- [x] Capturas antes/después 390/1280/1440 claro/oscuro con datos sintéticos, nota de sustitución de bloqueo por acción explícita.
- [x] Suite general, Node, build y revisión independiente; diario y PR en borrador con rollback. Detenerse antes de publicar 2b para revisión visual.
