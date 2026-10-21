# Publicación autorizada @zenvia/ui — preflight 21-10-2026

El propietario aprueba expresamente PR #272 y autoriza publicarla, verificar producción y continuar sin pausa con Platform B. El lote B se detiene con capturas antes de publicar.

## Evidencia previa

- Head aprobado: 95891f9816313bfe11b7b910593689e267e200c5; CI 6/6 success comprobado de nuevo.
- Main/producción: 45441a470dd2ff30fc4d78020a0cc1309290bf6d; deployment dpl_CB76xZWQJmZppTwhoBE6LY8cYKVe; estado READY; proyecto prj_L6nGgpq78QTEnZByUNtjtmF5rGkv (zenvia-gestion), dominio gestion.zenviacommerce.com.
- 66 PNG idénticos sin tolerancias; package, React peers y CSS compilado verificados. Sin cambios SQL/Edge/Auth/MFA.

## Rollback preparado ANTES del merge

Reasignar producción al deployment verificado `dpl_CB76xZWQJmZppTwhoBE6LY8cYKVe` mediante Vercel request_rollback, projectId `prj_L6nGgpq78QTEnZByUNtjtmF5rGkv`, deploymentId `dpl_CB76xZWQJmZppTwhoBE6LY8cYKVe`. Alternativa CLI autenticada: `vercel rollback dpl_CB76xZWQJmZppTwhoBE6LY8cYKVe`. Si se utiliza rollback, comprobar dominios y reactivar la asignación automática solo cuando corresponda. En Git, revertir el commit de publicación que resulte del merge; no resetear main ni deshacer otros cambios. No hay reversión de datos o migraciones porque esta extracción no los modifica.

Merge condicionado al SHA aprobado; verificar nuevo deployment READY y su commit, bundle/CSS servidos, carga pública y capturas autorizadas sin emitir documentos reales. Diario posterior con recibo de producción.

## Prioridad del propietario (sustituye todo orden anterior)

1. Completar TODO Platform: paquete @zenvia/ui, lote B y lote C.
2. Después Gestión: primero seguimiento fiable de envíos (nuevo punto de prioridad alta), luego los ocho puntos del backlog existente.
3. Solo entonces MFA, solicitud de desarrollador público de Amazon SP-API y validación de números de Amazon frente a Seller Central.

### Gestión: seguimiento (implementación posterior a Platform)

Diagnóstico por proveedor MRW directo/Sendcloud/Envia adelantado ahora SOLO LECTURA, en paralelo e independiente. Evidencia aportada por propietario, todavía a verificar: 36 sendcloud/MRW SHIPPED desde24/09;29 MRWdirect SHIPPED desde05/10 y4 READY_TO_SEND desde12/10; última actualizaciónMRW19/10; estados heterogéneos y null.

Cuando corresponda: (1) diagnóstico webhook/poll/cron y fecha de fallo, (2) estado común pre_transit/in_transit/out_for_delivery/delivered/exception-incident/returned/cancelled conservando detalle, (3) webhooks y sondeo acotado con backoff/observabilidad, sin consultar entregados, (4) estado+fecha en Pedidos, filtro incidencias y aviso de atasco sin movimiento en X días, (5) poner al día los envíos activos con reproceso controlado. No se implementa ni reprocesa en este paso.

### Ocho puntos conservados, sin ejecutar ahora

1. Registrar envío externo en detalle. 2. Reetiquetar tras cancelar etiqueta. 3. Cancelar envíos desde Zenvia. 4. Derivar cancelación del código, no de texto que contenga cancelado. 5. Papelera de pedidos con motivo/bloqueos y diseño previo. 6. Sin coste cuando falte coste. 7. Amazon Mes anterior 331 ms. 8. Token propio Amazon en Integraciones.

Corrección manual ya comunicada y registrada: pedido 407-0024766-5208363 → MRW/Sendcloud, tracking01009F045746; no se repite esta escritura.
