# Prioridades y requisitos del propietario — 21 de octubre de 2026

Esta entrada sustituye el orden anterior. Recoge el resumen de mensajes del propietario que no se habían guardado. No aplica cambios de producto ni publica nada.

## Orden vigente

1. Platform lote B (PR #79): entregar revisión con capturas cuando GitHub CI esté verde y DETENERSE antes de publicar. El paquete @zenvia/ui ya está publicado con Gestión PR #272.
2. Justo después del lote B y antes de Platform lote C: los dos arreglos prioritarios de Gestión descritos abajo, en PRs separadas. Productos puede publicarse cuando pase CI, con rollback, capturas y verificación. Cuentas bancarias requiere capturas y DETENERSE antes de publicar.
3. Platform lote C.
4. Resto de pendientes de Gestión: primero seguimiento de envíos y después los ocho puntos ya registrados. El diagnóstico de seguimiento sigue válido; su implementación no se adelanta a los puntos anteriores.
5. MFA; solicitud de desarrollador público de SP-API; validación de números Amazon frente a Seller Central.

La excepción de Productos y cuentas bancarias antes de C es explícita. No se interpreta como autorización para publicar B ni las cuentas bancarias. Ninguna prueba emitirá facturas, recibos, etiquetas o documentos reales. No tocar el piloto MFA.

## Gestión A — periodo en Productos y otras pantallas maestras

- El periodo afecta a los KPI, no a la pertenencia de la lista de productos. Productos sin ventas en el periodo deben seguir visibles.
- Clientes es la referencia: la lista completa conserva todos sus registros y los KPI reflejan el periodo.
- Revisar Proveedores y todas las demás pantallas maestras con el mismo patrón y unificarlas. Delimitar el inventario de pantallas revisadas en la PR.
- Las columnas de ventas o unidades del periodo pueden seguir calculándose para ese periodo, sin excluir filas por no tener actividad. Mantener búsqueda, filtros propios de la entidad, ordenación, paginación y acciones.
- Pruebas de regresión con productos sin ventas y distintos periodos; validar lista estable y KPI/columnas de periodo correctos. Capturas antes/después a 390/1280/1440.
- Publicación separada autorizada por el propietario al pasar CI. Preparar rollback antes y verificar producción después; registrar evidencia en docs/deploy/.

## Gestión B — varias cuentas bancarias

El IBAN ya existe en Configuración → General, está rellenado y se muestra en facturas. Debe conservarse.

### Configuración y migración

- Lista de cuentas: alias, IBAN validado, BIC/SWIFT y titular opcionales.
- Una cuenta marcada como predeterminada; edición y eliminación sin alterar documentos emitidos.
- Migrar business_settings.iban como primera cuenta predeterminada sin perderlo. La migración debe ser idempotente y no duplicar la cuenta al repetirse. Aislamiento por empresa/tenant y permisos existentes.
- Preparar y probar rollback antes de cualquier cambio de producción. Verificar el tratamiento de documentos históricos y el flujo actual de PDF/email antes de diseñar la migración; no asumir que los históricos ya tienen snapshot.

### Facturas y recibos por transferencia

- Selector de cuenta al crear una factura o recibo con transferencia; precargar la cuenta predeterminada.
- Contemplar la opción de cuenta predeterminada por serie, conforme al requisito opcional del propietario.
- Guardar la cuenta elegida y un snapshot del IBAN en el documento emitido. Cambiar o borrar la cuenta no puede modificar una factura ya emitida ni su PDF/email.
- PDF y email muestran el IBAN de la cuenta elegida, no una lectura posterior de la cuenta predeterminada.
- Si se va a emitir con transferencia sin ninguna cuenta, mostrar exactamente: «Falta una cuenta bancaria en Configuración → General».

### Verificación y parada

- Pruebas de validación de IBAN, migración del valor actual sin pérdida/duplicación, predeterminada, selección por documento, aislamiento entre tenants y snapshot inmutable tras cambio/borrado.
- Cubrir tanto facturas como recibos, PDF y email, sin emitir ni enviar documentos reales en pruebas.
- Capturas antes/después de Configuración y pantalla de facturas a 390/1280/1440.
- DETENERSE con la revisión antes de publicar. No aplicar migraciones ni publicar por la autorización limitada concedida a Productos.

## Estado comprobado del lote B al recibir esta actualización

PR #79 abierta y en borrador, sin fusionar. Commit revisado: 979152e900c118c8697ee049d187918fa1236670. GitHub Actions run 39622514554 / Build ZENVIA Platform: completed / success. Instalación, tests, build y artefacto correctos; recibo existente con 283/283 pruebas.

Capturas: 27 antes y 51 después, a 390/1280/1440. Se han vuelto a verificar los 78 hashes de PNG y los hashes de las 32 fuentes compiladas. Son fixtures sintéticos con API simulada: no equivalen a una validación E2E de B en producción. El rollback está preparado; B permanece sin publicar.

Enlaces:
- PR: https://github.com/zenviacommerce/zenvia-platform/pull/79
- CI: https://github.com/zenviacommerce/zenvia-platform/actions/runs/39622514554
- Capturas: https://github.com/zenviacommerce/zenvia-platform/blob/feat/platform-lote-b/docs/deploy/platform-lote-b-20261021/README.md
- Recibo final: https://github.com/zenviacommerce/zenvia-platform/blob/audit/platform-lote-b-20261021/docs/deploy/platform-lote-b-20261021/ci-final.md
