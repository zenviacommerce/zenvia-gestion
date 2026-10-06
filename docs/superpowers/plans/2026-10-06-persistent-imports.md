# Importaciones persistentes — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if the user selects delegation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todas las importaciones de Gestión continúan en servidor y recuperan progreso, resultados y revisiones al regresar.

**Architecture:** Una cola persistente con elementos, reclamación atómica y checkpoints dirige adaptadores por módulo. Un servicio documental autoalojado ejecuta lectura/OCR e IA local; las pantallas observan tareas y revisan candidatos guardados. Amazon mantiene su cola y se muestra en el centro común.

**Tech Stack:** React 19, TypeScript, Supabase Postgres/Storage/Edge Functions/Cron, servicio Python con Ollama.

**Spec:** `docs/superpowers/specs/2026-10-06-persistent-imports-design.md`, aprobado por el usuario el 2026-10-06.

## Global Constraints

- Continuar al navegar, recargar o cerrar la pestaña después de confirmar subida y tarea en servidor.
- Conservar validaciones fiscales, reglas de proveedor/cliente, numeración y revisión/activación de tarifas.
- Todos los canales de gastos invocan el mismo motor; no añadir llamadas de IA de pago.
- Empresa y permisos se obtienen del contexto autenticado, nunca del owner_id del cliente.
- Tokens se renuevan en servidor y no se guardan en tareas, resultados ni mensajes.
- Originales y candidatos quedan persistidos; el polling observa y no ejecuta tareas.
- Cancelar no revierte altas terminadas; reintentar procesa solo elementos fallidos reintentables.
- Mantener estilos e indicadores existentes; trabajar en `feat/persistent-imports` y validar en desarrollo antes de producción.

## Review Focus

- PDFs con varias facturas/abonos y fotos multipágina conservan separación y revisión; no se fusionan altas distintas.
- Cuentas Gmail sin refresh token persistente no aceptan una tarea que prometa ejecución independiente.
- Una caída después del alta, antes de confirmar el resultado, no duplica factura, proveedor ni cliente.
- Cambiar empresa mientras se sube o consulta no mezcla documentos, resultados ni indicadores.
- Revocar permisos o suspender una empresa mientras hay trabajo pendiente impide nuevas escrituras.

---

### Task 1: Cola persistente, permisos e idempotencia

**Files:** Crear migración con `supabase migration new persistent_import_jobs`; crear `shared/imports/contracts.ts`, `shared/imports/state.ts`, `scripts/persistent-import-state.test.mjs`, `supabase/tests/persistent_import_jobs.sql`.

**Interfaces:** `ImportKind = 'gmail_scan' | 'expense_document' | 'sales_document' | 'transport_tariff' | 'shopify_orders' | 'sendcloud_orders' | 'envia_shipments'`. `ImportJob` y `ImportItem` contienen estado, etapa, identificadores, tiempos, contadores y resultado JSON; nunca File/token. RPC `import_claim_items(limit_count)` devuelve elementos con `lease_token`; `import_finish_item(item_id, lease_token, outcome)` rechaza leases vencidos; `import_cancel_job(job_id)` y `import_retry_job(job_id)` verifican permisos del solicitante.

- [ ] Escribir pruebas de transición: terminal no vuelve a running; waiting_review no cuenta como importado; cancelación preserva resultados importados.
- [ ] Ejecutar `node --test scripts/persistent-import-state.test.mjs`; comprobar fallo por módulos ausentes.
- [ ] Implementar tablas `import_jobs`, `import_job_items`, claves de idempotencia por empresa, índices de reclamación, leases, recuperación, backoff y RPCs. Habilitar RLS y grants explícitos según app_users y permisos del módulo; funciones internas solo service_role. Añadir referencia única del elemento a los registros creados para reconciliar reinicios.
- [ ] Ejecutar pruebas Node y SQL en desarrollo: dos workers no reclaman el mismo lease, empresa ajena no ve/escribe filas, permisos revocados impiden commit, repetir una clave devuelve la tarea existente.
- [ ] Commit `feat: add persistent import queue and guarded transitions`.

### Task 2: API, worker y continuidad sin navegador

**Files:** Crear `supabase/functions/import-jobs/index.ts`, `supabase/functions/import-worker/index.ts`, `supabase/functions/_shared/imports/{repository,worker,registry}.ts`, `scripts/import-worker.test.mjs`; crear migración de Cron con CLI.

**Interfaces:** API autenticada acepta acciones `enqueue`, `list`, `detail`, `review`, `cancel`, `retry`; entrada `{kind, requestKey, accountId?, sourceDocumentIds?, options?}`. `ImportAdapter.execute(context, item): Promise<ImportOutcome>` recibe owner validado, cliente admin interno y lease. Outcome es checkpoint, review, imported, duplicate, skipped o error con clasificación reintentable. API devuelve `{job, items?}` sin secretos.

- [ ] Escribir pruebas del ejecutor con repositorio/adaptadores inyectados: timeout recuperable, error permanente, reanudación de checkpoint y resultado de lease obsoleto rechazado.
- [ ] Ejecutar `node --test scripts/import-worker.test.mjs`; comprobar fallos previstos.
- [ ] Implementar API y worker de lotes acotados, autorización por módulo, validación de cuentas/originales, revalidación antes de guardar y saneamiento de errores. Configurar arranque inmediato y Cron periódico con secreto interno, sin reutilizar JWT del usuario como credencial del worker.
- [ ] Ejecutar pruebas y prueba de integración sin cliente: encolar, detener polling, ejecutar Cron y verificar finalización; reiniciar tras commit para confirmar alta única.
- [ ] Commit `feat: execute persistent imports independently of browser sessions`.

### Task 3: Motor documental compartido y servicio local

**Files:** Crear `shared/imports/documentRules.ts`, `supabase/functions/_shared/imports/{documentEngine,expenseAdapter,salesAdapter,tariffAdapter}.ts`, `tools/document-worker/{app.py,requirements.txt,README.md}`, `scripts/import-document-rules.test.mjs`, `tools/document-worker/tests/test_documents.py`. Modificar `src/services/{invoiceImportPipeline,salesInvoiceImport,transportTariffs}.ts` para consumir reglas compartidas.

**Interfaces:** Servicio `POST /analyze` autenticado recibe original(es), tipo y opciones validadas; devuelve texto, páginas, candidatos, evidencias y advertencias JSON. `analyzeDocument(context, sourceIds, kind)` usa `DOCUMENT_WORKER_URL` y `DOCUMENT_WORKER_SECRET`; el servicio usa `OLLAMA_BASE_URL` y `OLLAMA_MODEL`. `validateDocumentCandidate(candidate, kind)` determina listo/revisión/error y no inventa datos ausentes.

- [ ] Escribir fixtures de factura fiscal incompleta, PDF con varias facturas y abonos, fotos multipágina, CSV con separador decimal español y tarifa sin tramos: resultados preservados o enviados a revisión, nunca altas ficticias.
- [ ] Ejecutar `node --test scripts/import-document-rules.test.mjs` y `python -m unittest discover -s tools/document-worker/tests`; comprobar fallos previstos.
- [ ] Extraer reglas puras existentes; implementar extracción de PDF, imágenes y hojas en servidor, llamada Ollama y candidatos persistentes. Instalar dependencias con versiones verificadas y fijadas. Compartir lógica de gastos entre Gmail/archivo/cámara y reutilizar reglas de ventas y tarifas. Añadir límites de tamaño/páginas y errores reintentables cuando el servicio no esté disponible.
- [ ] Ejecutar pruebas y una integración con modelo local: fecha/divisa/impuestos/proveedor/líneas, ausencia de llamadas a OpenAI y recuperación de indisponibilidad. Verificar health del proveedor configurado; si falta URL no declarar esta parte desplegada.
- [ ] Commit `feat: run shared document imports through self-hosted analysis`.

### Task 4: Gmail y sincronizaciones como adaptadores persistentes

**Files:** Crear `supabase/functions/_shared/imports/{gmailAdapter,orderAdapters}.ts`, `scripts/import-source-adapters.test.mjs`; modificar `supabase/functions/{integration-accounts,shopify-orders,sendcloud-orders,envia-shipping}/index.ts`, `src/services/{gmail,gmailImport,gmailStableSearch,orders}.ts`. Extraer funciones de integración a módulos compartidos si las funciones actuales mezclan autenticación y ejecución.

**Interfaces:** `scanGmailPage(context, accountId, checkpoint)` devuelve elementos, siguiente checkpoint y métricas; claves de adjunto incluyen empresa/cuenta/mensaje/adjunto. `refreshGmailTokenForWorker(admin, ownerId, accountId)` verifica cuenta y utiliza Vault. Los adaptadores de pedidos reciben cuenta y cursor, devuelven registros procesados y siguiente checkpoint. Registro Task 2 dirige cada ImportKind al adaptador correspondiente.

- [ ] Escribir pruebas: Gmail con 429 reprograma; refresh token revocado falla con reconexión; credenciales de sesión no permiten enqueue independiente; adjuntos ya procesados no repiten OCR; cursor de pedidos se reanuda sin duplicados.
- [ ] Ejecutar `node --test scripts/import-source-adapters.test.mjs`; comprobar fallos previstos.
- [ ] Implementar búsqueda paginada, descarga y registro Gmail en servidor; cache de extracción por original/reglas; adaptadores por cuenta para pedidos/envíos y renovación de credenciales. Sustituir ejecución directa del navegador por enqueue, conservando opciones de periodo/histórico actuales. No alterar la cola Amazon.
- [ ] Ejecutar pruebas y pruebas Gmail/sincronizaciones existentes relevantes; comprobar progreso con navegador cerrado en desarrollo.
- [ ] Commit `feat: migrate Gmail and order imports to persistent adapters`.

### Task 5: Estado global, historial y recuperación de revisiones

**Files:** Crear `src/services/importJobs.ts`, `src/context/ImportJobsContext.tsx`, `src/components/ImportJobHistory.tsx`, `scripts/import-jobs-client.test.mjs`; modificar `src/App.tsx`, `src/components/ActivityCenter.tsx`, `src/services/activity.ts`, `src/pages/{Gmail,Orders}.tsx`, `src/components/{UploadInvoiceModal,BulkInvoiceImportModal,SalesInvoiceImportModal,TransportTariffsPanel}.tsx`.

**Interfaces:** `enqueueImport(input): Promise<ImportJob>`, `uploadImportSources(files): Promise<string[]>`, `loadImportJobs(): Promise<ImportJob[]>`, `loadImportJob(id): Promise<{job,items}>`, `reviewImportItem(id,candidate): Promise<ImportItem>`. `useImportJobs()` expone tareas, carga, refresh y acciones. Identidad de consultas y subidas ligada a empresa/sesión; respuestas antiguas no actualizan nueva empresa. Originales se recuperan con autorización desde Storage.

- [ ] Escribir pruebas de cliente con reloj/API simulados: reconstrucción al montar, carga al focus/online, respuesta de empresa anterior ignorada, cierre de modal no cancela y subida interrumpida nunca se etiqueta «En segundo plano».
- [ ] Ejecutar `node --test scripts/import-jobs-client.test.mjs`; comprobar fallos previstos.
- [ ] Implementar proveedor global observador, indicador e historial con estilos actuales y enlace a sección; mostrar tareas Amazon existentes sin encolarlas de nuevo. Migrar componentes para recuperar resultados y formularios; confirmar revisiones con versión para evitar sobrescrituras. Actualizar listas/KPIs al finalizar, deduplicar notificaciones y permitir reintento/cancelación explícitos.
- [ ] Ejecutar pruebas y `npm run build`; comprobar cada entrada en escritorio/móvil, salir durante análisis, volver, recargar y abrir revisiones con originales.
- [ ] Commit `feat: recover import progress and reviews throughout Gestion`.

### Task 6: Verificación completa y preparación de despliegue

**Files:** Crear `scripts/persistent-imports-e2e.test.mjs`, `docs/validation/persistent-imports.md`; actualizar `tools/document-worker/README.md` y las instrucciones de despliegue existentes.

**Interfaces:** Utilizar APIs/RPCs y fixtures definidos en Tasks 1–5; evidencia por entrada con job id, estados, resultado y número de altas. El informe diferencia validación automatizada, integración real y dependencias sin configurar.

- [ ] Escribir pruebas de aceptación para entradas documentales, Gmail y pedidos: navegador ausente, recuperación de lease, revisión persistente, alta idempotente, error parcial y aislamiento.
- [ ] Ejecutar `node --test scripts/persistent-imports-e2e.test.mjs`; comprobar fallos hasta que estén desplegados esquema y workers de desarrollo.
- [ ] Configurar desarrollo con migraciones, funciones, Cron y servicio local; ejecutar los escenarios sin alterar datos reales. Revisar advisors/RLS y obtener evidencia de Cron ejecutando sin cliente. Resolver fallos en su tarea propietaria.
- [ ] Ejecutar compilación, pruebas afectadas y suite E2E; registrar resultados y dependencias necesarias del servicio autoalojado. Hacer revisión de rama completa antes de integración.
- [ ] Commit `test: verify persistent import lifecycle across Gestion`; preparar despliegue de producción con rollback documentado. No afirmar despliegue si el servicio documental y Cron no están comprobados.

## Revisión del plan

Cada requisito del diseño tiene tarea: persistencia/idempotencia/aislamiento (1–2), motor local y canales compartidos (3–4), recuperación/UX (5), aceptación y continuidad real (6). Los cinco riesgos de Review Focus tienen pruebas en 1–5. Las interfaces usan ImportKind/ImportOutcome del contrato común; la creación de documentos utiliza el elemento persistente como clave de alta. Ejecución propuesta: nativa, secuencial en esta sesión, porque worker, adaptadores y formularios dependen del mismo contrato.

Estado: plan preparado y revisado; pendiente de revisión del usuario y selección del método de ejecución. Sin cambios de producto ni de producción en esta fase.
