# Importaciones persistentes en Zenvia Gestión

## Objetivo aprobado

Todas las importaciones deben continuar al cambiar de sección y recuperar su estado al regresar. Se adopta la propuesta de tareas persistentes en backend, con progreso global, resultados por documento, concurrencia limitada y deduplicación. También deben sobrevivir a recargar o cerrar la pestaña una vez que los archivos hayan terminado de subirse y la tarea esté confirmada por el servidor.

## Situación verificada

Revisión de main en d6ad0c0. El esquema de producción confirma `gmail_imports`, `source_documents`, `integration_accounts`, `invoices`, `sales_invoices` y `amazon_sync_jobs`.

| Entrada | Implementación actual | Adaptación necesaria |
| --- | --- | --- |
| Gmail: búsqueda y descarga | `Gmail.tsx`, `gmailStableSearch.ts`, `gmail.ts` | Paginación y checkpoints persistidos; descarga por cuenta desde servidor |
| Gmail: análisis y alta | `gmailImport.ts`, `invoiceImportPipeline.ts` | Adaptador al motor común ejecutado por worker |
| Gastos: archivo, cámara y lotes | `UploadInvoiceModal.tsx`, `BulkInvoiceImportModal.tsx` | Subir originales y registrar elementos; recuperar análisis y revisiones |
| Facturas de venta: archivo y cámara | `SalesInvoiceImportModal.tsx`, `salesInvoiceImport.ts` | Análisis persistente y creación de borradores bajo las reglas actuales |
| Tarifas: PDF, XLSX, CSV y reanálisis | `TransportTariffsPanel.tsx`, `transportTariffs.ts` | Extracción en servidor y borrador persistente recuperable |
| Pedidos de Shopify y Sendcloud; envíos de Envia | `orders.ts`, funciones de integración | Ejecución por lotes con checkpoints en la cola común |
| Amazon | Cola `amazon_sync_jobs` y worker existentes | Mostrar su progreso en el centro común, conservando su ejecución actual |

Los componentes documentales guardan candidatos en estado React; los modales los borran al cerrar. `activity.ts` conserva únicamente actividades en memoria. El OCR depende de canvas y otras API del navegador: trasladar solo el estado de React no cumple el objetivo.

El endpoint de inteligencia documental de esta revisión utiliza OpenAI. La preferencia previa del usuario es IA local: esta mejora no añadirá llamadas de pago y los nuevos workers utilizarán un proveedor local/autoalojado configurado desde servidor. La disponibilidad de ese proveedor queda por verificar antes del despliegue.

## Diseño

### Persistencia y ejecución

Crear `import_jobs` y `import_job_items` con empresa, usuario iniciador, módulo, tipo, cuenta, parámetros, versión de reglas, etapas, contadores, resultados, errores, intentos, siguiente ejecución y marcas de tiempo. Cada elemento referencia originales almacenados, nunca objetos File ni tokens. Guardar candidatos serializables y referencias al original para reconstruir formularios y previsualizaciones.

Estados de tarea: en cola, ejecutándose, esperando revisión, completada, completada con incidencias, fallida y cancelada. Estados por elemento: en cola, analizando, esperando revisión, listo, guardando, importado, duplicado, omitido, error y cancelado. El resumen distingue documentos analizados de registros realmente creados.

Un worker reclama elementos atómicamente con lease, token de reclamación y vencimiento. Solo el propietario vigente del lease puede confirmar un resultado. Trabajar en lotes acotados, guardar checkpoints después de cada unidad y recuperar leases vencidos. Un disparador inmediato acelera el arranque; un disparador periódico del servidor garantiza continuidad sin depender del navegador ni de una petición HTTP larga. No basta con una promesa en segundo plano en una función efímera.

Deduplicar solicitudes por clave de idempotencia y documentos por empresa/cuenta/mensaje/adjunto o hash. Proteger las altas con restricciones y transacciones: el reinicio entre guardar una factura y confirmar el elemento debe encontrar el resultado existente. Las revisiones finales mantienen las reglas fiscales, de proveedor, cliente, series y numeración actuales. No reintentar automáticamente errores permanentes ni autorizaciones revocadas; aplicar backoff a límites de API y errores transitorios.

### Motor documental

Extraer las reglas puras compartidas del pipeline de gastos y ventas a módulos utilizables en servidor. Crear adaptadores de entrada para Gmail, archivos y cámara; todos invocan el mismo motor. Conservar validación fiscal y revisión conservadora. Procesar texto PDF, hojas de cálculo y OCR en un servicio autoalojado que acepte originales y use el modelo local; no importar canvas/DOM en Edge Functions. Persistir la extracción para evitar repetirla al abrir una revisión.

La indisponibilidad temporal del servicio conserva la tarea y muestra el motivo. Las cuentas Gmail con credenciales persistentes renuevan tokens en servidor; las cuentas que dependen de una sesión del navegador requieren reconexión y deben mostrarlo antes de aceptar una tarea independiente. No guardar tokens en payloads, resultados ni mensajes de error.

### Experiencia común

Un proveedor global consulta las tareas de la empresa y actualiza el indicador existente con los estilos de Zenvia. Cada entrada presenta etapa, unidades completadas, resultados y enlace a su sección. Mantener historial y errores legibles después de terminar. Consultar nuevamente al montar, al recuperar conexión y al volver a la ventana; el polling solo observa, no ejecuta trabajos.

Cada sección recupera sus tareas y candidatos al entrar. Cerrar modal o navegar no cancela. La cancelación explícita detiene elementos pendientes y no revierte registros ya creados. Reintentar ejecuta únicamente los elementos fallidos reintentables. Revisión humana conserva la tarea en espera y continúa al confirmar. Tarifas siguen requiriendo revisión y activación; ventas conservan creación de borradores y numeración vigente.

Durante la subida inicial mostrar «Subiendo archivos». Indicar «En segundo plano» únicamente después de confirmar almacenamiento y tarea. Las importaciones nuevas deben usar un registro común de adaptadores para heredar este comportamiento.

### Aislamiento

RLS y permisos por empresa y módulo en tareas, elementos y originales. Validar cuenta y referencias de entrada en servidor; obtener la empresa del contexto autenticado. Las operaciones internas de reclamación solo están disponibles para el worker. Revalidar permisos y estado de la empresa antes de escrituras. No confiar en owner_id enviado por el cliente.

## Secuencia de implementación

1. Revisar permisos, almacenamiento, credenciales persistentes y disponibilidad del servicio documental en el entorno de pruebas.
2. Implementar esquema, reclamación, recuperación, idempotencia y contratos compartidos.
3. Implementar worker, disparador periódico y servicio documental autoalojado.
4. Migrar búsqueda Gmail y todas las entradas documentales al motor común.
5. Integrar sincronizaciones de Shopify, Sendcloud y Envia; observar la cola Amazon existente.
6. Integrar indicador, historial, recuperación y revisión en todas las pantallas afectadas.
7. Validar en desarrollo; preparar despliegue con migraciones y funciones versionadas.

## Criterios de aceptación

- Iniciar cada tipo de importación, navegar y volver: misma tarea y resultados recuperados.
- Cerrar la pestaña tras la confirmación del servidor: el trabajo continúa sin polling del cliente.
- Reiniciar el worker durante el análisis y después del alta: recuperación sin duplicados.
- Dos solicitudes iguales y dos workers simultáneos: una ejecución efectiva por elemento.
- Errores parciales: los demás elementos continúan y el resumen refleja lo ocurrido.
- Documentos que requieren revisión: persisten al recargar y solo se crean tras validación.
- Tokens caducados, límites Gmail, pérdida de red y servicio local no disponible: estado explícito y recuperación apropiada.
- Empresa distinta y usuario sin permisos: no acceden ni modifican tareas o documentos ajenos.
- Facturas, ventas y tarifas conservan sus validaciones y pasos de confirmación actuales.
- Compilación y pruebas de integración de los flujos afectados pasan; el cron se comprueba con la pestaña cerrada.

## Estado

Diseño revisado para coherencia y alcance. Aún no se ha implementado código de producto ni modificado producción. Pendiente de revisión del diseño escrito, conforme al flujo de desarrollo activo.
