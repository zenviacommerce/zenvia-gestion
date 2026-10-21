# Hotfix #270 publicado — 21/10/2026

Publicado en Gestión, commit `946d932b7e0f705953f7ea228b7ff374f7cb876a`, deployment `dpl_22J1RTb1BF39etPX5Kcmkf5MtPQo` READY y dominio correcto. HTML público sirve `index-DMsvERAZ.js`. CI completa de la PR en verde (5 workflows) y build de main también en verde; árbol de main idéntico al probado.

#1023: error preexistente desde 59583b97 por redondear base antes del IVA; no causado por diseño/caché/paginación. Preparación y persistencia corregidas para 40,98 EUR. Emisor, series y registro IVA ya no desaparecen ante fallo de otra carga. Seis desgloses fiscales reales anonimizados #1020–#1025 coinciden exactamente en total e IVA.

259 pruebas de aplicación y 1.239 Node/SQL en la versión final; build y capturas de toda Gestión pasan. Recibo creado y numerado con funciones SQL originales en base aislada, total sin IVA y rollback limpio. Facturas manuales/Amazon mantienen reglas; Amazon no ofrece emisión directa desde el pedido en la app actual. La revisión independiente detectó y resolvió la dependencia de visibilidad RLS mediante helper privado booleano por workspace; se prueba sin acceso a Pedidos.

Snapshot y rollback preparados antes de la migración 20261021115856. Verificación posterior 14:08:47 Madrid: mismas 27 facturas y 45 líneas, hashes idénticos. #1023 todavía sin factura en ese instante. No se ha emitido/enviado ni reservado numeración real durante las pruebas.

Rollback frontend: deployment anterior `dpl_J6RLpKEotrEC2ddFMVeySm8YobV2`; SQL exacto en [rollback.sql](rollback.sql), ensayado en PostgreSQL aislado. Restaurar no elimina ni recalcula documentos reales que el propietario emita después.

Evidencia visual: capturas locales antes/después 390/1280/1440 del componente real, con importes fiscales reales y nombres/direcciones de prueba; no son una sesión autenticada de producción. Se verificaron deployment y HTML públicos. El conector no permitió leer logs de build/bypass (403); la descarga del contenido JS agotó 20 s, sin evidencia adicional del contenido del bundle. No se afirma verificación visual autenticada.

Desviaciones: primera ejecución local simultánea agotó el timeout de un test de recogidas; suite completa posterior con concurrencia acotada pasó. Primera CI desechable faltaba document_kind/fiscal_treatment, presentes en producción: fixture del runner alineado y CI completa repetida en verde. No cambios de Auth/MFA/Edge en producción.

Se avisó al propietario para recargar Pedidos y abrir #1023. @zenvia/ui continúa pausado; el siguiente arreglo autorizado de ordenación se realiza en PR y despliegue independientes.
