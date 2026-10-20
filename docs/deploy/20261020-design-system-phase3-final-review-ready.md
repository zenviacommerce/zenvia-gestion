# Lote3 listo para revisión · Gestión

PR #267, head 61553d95a65c09afaedbcaa210d5bff3558bc348. Las seis comprobaciones y Vercel están en verde, incluidos build×2, Auth, Auth/Vault desechable y capturas de todas las fases. 257/257 Vitest,1224/1224 Node offline y build locales correctos. Lote3 permanece draft, sin fusionar y sin publicar.

[PR](https://github.com/zenviacommerce/zenvia-gestion/pull/267) · [Galería390/1280/1440 y alturas](https://github.com/zenviacommerce/zenvia-gestion/tree/feature/design-system-phase3-final-20261020/docs/deploy/design-phase3-final-20261020) · [Recibo CI](design-phase3-final-ci-20261020.json).

## Verificación final de todas las pantallas

| Pantallas | Evidencia y comprobación |
|---|---|
| Resumen y Pedidos | Fase1: KPI, variantes de aviso, acciones de cabecera, tarifas, filtros y selección |
| Facturación, Gastos y Recibos | Fase2: filtros iguales en una línea, búsqueda separada, multimoneda, acciones/tabs y equilibrio KPI |
| Productos, Clientes y Proveedores | Lote1: paginación nativa, selección de filtros, acciones y KPI móviles/escritorio |
| Amazon y Shopify | Lote2: cinco periodos, cifras con entradas iguales, tabs, acciones y refresco; lectura real de producción en recibo separado |
| Soporte | Lote3: alcances, acciones, KPI y variantes de tickets |
| Configuración | Lote3: todas las secciones, formularios intactos, navegación responsive, cancelación con datos sin guardar |
| Administración | Lote3: Usuarios/Auditoría, acciones, filtros y estados |
| Gmail | Lote3: cuenta/periodo, botones, KPI, estados e importación seleccionada conservados |

La auditoría AST recorre16 archivos de pantallas y componentes comunes: cero wrappers de cabecera/KPI heredados fuera de PageHeader/StatCard, sin excepciones por pantalla. No certifica eliminación de todo CSS histórico ni sustituye carruseles analíticos especializados. Pruebas visuales con datos sintéticos y red bloqueada; no equivalen a validación de todos los flujos reales autenticados. Capturas 390/1280/1440 por fase y1568/1920 para equilibrio KPI.

## Cambios, desviaciones y parada

Se incluye Gmail para no dejar una cabecera/KPI heredados; no cambia la lógica de importación. Configuración conserva todas sus secciones y la cancelación de cambios sin guardar, también con teclado. El primer bloque móvil pasa266→307px para mantener las descripciones; es un formulario, no una lista. Soporte891→701px, Usuarios602→523, Auditoría831→683, Gmail1277→1200. Todas las medidas de escritorio y móvil están en la galería. Revisión independiente sin hallazgos pendientes.

Producción y rollback futuro: lote2 #266, main a03f10ca6e90f8d03765fbc4d90bba18bdee945d, deployment dpl_AvXMo7EGoQY32WAgU2JGhQpb14cX, bundle index-lLeCVOf1.js. No SQL, Edge, Auth ni datos que revertir. La comparación real del lote2 está documentada por separado: Shopify idéntico; Amazon cambió entre lecturas y no se afirma igualdad completa.

DETENER: no fusionar/publicar lote3 hasta revisión explícita del propietario. El cierre de la migración de Gestión queda preparado; Platform y el cierre/ampliación MFA siguen el orden acordado, sin iniciarlos en este lote.
