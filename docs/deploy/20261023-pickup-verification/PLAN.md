# Verificación de envíos antes de firmar — Implementation Plan

> Ejecución nativa por el agente actual con revisión independiente final (superpowers:executing-plans).

**Goal:** El conductor ve, comprueba o retira cada envío antes de firmar exactamente lo entregado.
**Architecture:** Lista React con comprobación por orderId y total derivado. Retirada lógica en tabla privada separada: conserva snapshot original, número y auditoría; RPC con permiso/workspace, bloqueo de documento y prohibición tras firmar. Las lecturas efectivas, membresía y PDF excluyen líneas retiradas y conservan sus notas. El servidor exige la lista completa de envíos verificados al preparar la firma.
**Tech Stack:** React/@zenvia/ui, PostgreSQL/Supabase, Deno/jsPDF.
**Spec:** Instrucción del propietario23/10: lista completa con tracking grande monoespaciado, pedido y bultos; lista móvil con scroll interno/totales fijos, casilla por envío, Marcar todos y contador; Firmar bloqueado hasta comprobar o retirar; motivo obligatorio; pedido disponible en Etiquetados para siguiente informe; PDF exacto con nota; Ver PDF. Escáner con cámara solo fase2.

## Global Constraints
- Segundo despliegue: no retrasar ni incluirse en el hotfix logo/buscador #293.
- No firmar, retirar líneas, enviar correos ni crear documentos reales en pruebas.
- No modificar snapshots históricos, numeración, sellos, MFA ni activar purga.
- Retirada por RPC autorizada al usar la UI; la migración no cambia filas existentes ni ejecuta reprocesados.
- RLS privada por workspace y auditoría sin DNI/firma ni motivos libres en logs.

## Review Focus
- Otro operador retira una línea mientras se revisa: servidor rechaza lista/revisión obsoleta.
- Reintento tras fallo de Storage: misma solicitud conserva artefactos; cambios de líneas invalidan intento anterior.
- Histórico con varios transportistas: no dividir/renumerar; no retirar después de cualquier firma.
- Todos los envíos retirados: firma deshabilitada, opción de anular; nunca PDF firmado vacío.
- Duplicados Amazon/Shopify: liberar membresía por order_key, sin crear falsos avisos.

### Task1: Retirada lógica y lectura efectiva
Files: nueva migración supabase/migrations/20261023091500_pickup_verification.sql; tests/pickup-verification-sql.test.ts; snapshot SQL previo.
- [ ] Pruebas rojas: aislamiento, motivo, retiro idempotente, firma/lease/empresa, originales intactos y total/membresía/preview efectivos.
- [ ] Tabla privada de retiradas y RPC service_role con assert actual y lock del documento; devolver informe efectivo. Sin UPDATE/DELETE de informes originales.
- [ ] Adaptar funciones privadas de lectura/lista/preview/membresía y bundle Edge/purga con guardas de fuente; rollback de definiciones exactas capturadas.
- [ ] Exigir verifiedOrderIds y revisión vigente bajo el mismo lock de prepare; paquetes derivados exactos.
- [ ] Ejecutar pruebas SQL con PGlite y comprobar permisos antes de commit.

### Task2: Lista verificable, retirada y PDF
Files: componente PickupShipmentVerification, PickupDocumentDialog, servicios, handler Edge, renderer PDF; tests UI/handler/PDF.
- [ ] Pruebas rojas: firmar bloqueado, seleccionar todos/individual, motivo requerido, totales al retirar y nota PDF.
- [ ] Lista interna antes del canvas, tracking completo, pedido y bultos; contador/totales fijos; Ver PDF y confirmación local de retirada.
- [ ] Handler valida selección y delega cambios atómicos; PDF imprime únicamente efectivos más notas de retirada, sin datos de firma en logs.
- [ ] Capturas390/1440, claro/oscuro, lista/retirada/verificado/firma; test móvil de scroll y canvas táctil.
- [ ] Revisión independiente, build, suites relevantes y CI verde.

### Task3: Publicación autorizada
- [ ] Mostrar SQL exacto y recuento de filas actuales afectadas por la migración (cero datos modificados); preparar rollback antes de producción.
- [ ] Aplicar migración aditiva, desplegar bundles exactos conservando Auth/MFA/JWT, merge de PR y esperar VercelREADY.
- [ ] Verificar en producción solo con lecturas, guardar recibos docs/deploy y avisar al propietario.

## Backlog fase2
Escanear etiquetas con cámara (BarcodeDetector o librería) para marcar los seguimientos automáticamente; fuera de este despliegue.

## Ledger23/10
- Ruling: segundo despliegue tras #293 publicado; no mezclar con2c. Verificación con datos sintéticos, sin operaciones reales.
- Ruling: conservar snapshot e items originales; retirada lógica aparte y lectura efectiva en get/list/preview/dashboard/workbench/Edge/retención. No alterar hechos del transportista: el retorno a Etiquetados se resuelve en la lectura del trabajo pendiente. Los pedidos cancelados/entregados/devueltos no se resucitan.
- Ruling: Marcar todos es una decisión explícita del repartidor. Backend verifica conjunto exacto, revisión y suma; el gesto individual no constituye prueba física automática. Cámara queda fase2.
- Ruling: se pueden retirar todas las líneas; no se firma ni envía un informe vacío y se ofrece anularlo.
- TDD: UI2rojas→verdes; SQL4rojas→verdes; ampliación legacy/active proyección verde, PDF real SQL→renderer nota roja→verde. Handler/UI20verdes. Node1286verdes. Deno correcto. Build correcto. Revisión independiente en curso.
- Rollback de contención: frontend al despliegue logo/buscador dpl_FMcC6nhtC4wyKS6xPadvThREDSPP; mantener datos de retiradas y validación SQL. No restaurar lecturas antiguas ni borrar tabla si hay retiradas: reintroduciría envíos no entregados. Las firmas pueden quedar suspendidas con el cliente anterior hasta corregir el problema. Bundles v2 y definiciones anteriores guardados en supabase/snapshots/20261023-pickup-verification-before*. Si no hay retiradas/firmas nuevas se podrán restaurar definiciones concretas revisadas, sin DROP ni borrado de datos.
- Cierre de revisión: sin bloqueantes. Se corrige la observación P3: no ofrecer retirar líneas en un histórico parcialmente firmado; conservar comprobación y vista PDF. Prueba nueva incluida.
- Capturas36antes/después390/1440claro/oscuro, lista7de9, retirada, vista PDF,8de8, firma táctil retina y firmado. Scroll interno y totales fijos, sin mover la página mientras se firma. Pie fijo con comprobados/envíos/bultos también durante la firma. PDF firmado sintético8envíos/8bultos + nota del envío9 no entregado, con logo real.
- Ensayo adicional: se cargan las definiciones exactas capturadas de producción en PGlite, se aplica la migración y se conserva activa la lectura de proyección; vuelve el pedido retirado a Etiquetados. Sin reconstruir ni actualizar pedidos reales.
- Inventario de acciones: conservar volver/cerrar, borrar firma, firmar/reintentar, envío por correo, copia al propietario, anulación, nuevo informe y PDF. Bultos pasa a derivarse de las líneas entregadas (lectura) para que no contradiga el contenido firmado; las correcciones se hacen retirando envíos con motivo.
- Estado local final:681pruebas de la suite completa verdes; casos adicionales de producción exacta y revisión parcial verdes (nuevo total esperado683). Node1286verdes, Deno/build verdes. La tabla de retiradas se indexa por workspace/orderId y workspace/order_key para no hacer joins completos por cada pedido del dashboard. SQL y capturas finales listos; CI remota pendiente.

## Publicación completada
PR#294 head5bf63e94, merge3dfd5f37. Seis workflows verdes. Vercel dpl_3doLvnXwT5fdfnxnyZsqcbGhMCDo READY con alias gestion.zenviacommerce.com. Migración aplicada por MCP como20261023074743_pickup_verification, correspondiente al archivo20261023091500_pickup_verification.sql. No se modificaron datos existentes al instalarla.

Edge documentsv3/hash22ca15f6/JWTtrue y purgev3/hash98540a57/JWTfalse. Readback runtime idéntico a los bundles comprobados; helpersAuth/MFA y políticasJWT conservados. Verificación de ACL: nuevo RPC no ejecutable por anon/authenticated; service_role sí; RLS activa. WrappersMFA sin cambios.683Vitest,1286Node, build y Deno correctos. Advisories:sin hallazgos nuevos al comparar metadata (ignorando observed_at).

Lectura posterior:3informes,0firmas,0retiradas,retención365d,purga false. Comprobación en la UI real de REC-2026-0003:9líneas,9tracking monoespaciados completos,0casillas marcadas,0de9/9envíos/9bultos en pie fijo,VerPDF presente,Firmar deshabilitado. No se ha firmado, retirado, generado ni enviado ningún informe real en pruebas. El propietario ha sido avisado de ambas publicaciones.
