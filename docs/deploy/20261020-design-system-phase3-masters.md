# Fase 3 · lote 1 · maestros (NO PUBLICADO)

## Cierre de fase 2 y autorización

El propietario confirmó en navegador `index-DlLrR06h.js` y cerró fase 2: Facturación con los cuatro filtros alineados, búsqueda separada y Limpiar filtros alineado. Producción confirmada anteriormente en main `ed63ce7aecff7c7a296b5fface372f89ee4b8bf7`, Vercel `dpl_9RMFEKn4AhoTo738mzvfBbdqCURS`. Su rollback de fase 2 sigue documentado en el recibo de publicación: `cfa6d3da` / `dpl_5KjeeSo3VSXSqNJjCPaNV4oNCRFP`.

El propietario autoriza preparar fase 3 según contrato y DETENERSE antes de publicar cada lote. Rama `feature/design-system-phase3-masters-20261020`, basada en la fase 2 publicada.

## Auditoría

Productos/Clientes tenían StatCard en rejillas heredadas; Proveedores conservaba tres KPI HTML. Las tarjetas móviles ya eran React: no se reescriben sus métricas. Las acciones de escritorio se inyectaban desde UnifiedListExperience mediante clics diferidos a un drawer. El cambio de filtros vaciaba la selección; el seleccionar todos reemplazaba el conjunto entero. Filtros heredados de anchos desiguales y KPI móvil con familias a una columna. Se captura referencia anterior a 390/1280/1440 con 32 registros sintéticos por pantalla.

## Aplicación del lote

Adopción PageHeader/KpiGrid/StatCard/FilterBar; DataTable/MobileList con propiedad React explícita y scroll contenido; selección/identidad fijas en escritorio. RowActions usa los mismos callbacks del drawer, sin inyección DOM en estas tablas. Selección persistente por ID a través de filtros/orden/páginas; seleccionar/deseleccionar el alcance actual conserva el resto. Revisión y retirada de registros ocultos; confirmaciones enumeran toda la selección antes de la mutación, manteniendo las protecciones de borrado. No se ejecutan mutaciones en pruebas ni producción. Valores completos de selectores disponibles en tooltip nativo y menú, con elipsis en el filtro.

KpiGrid común equilibra filas, incluido siete KPI 4 + 3. A 1568 CSS px el harness ya tenía cuatro columnas; el caso 6 + 1 se reproduce en 1920. Se aplica al componente compartido, por tanto a todas las pantallas migradas; móvil sigue dos columnas. No añadir avisos inferidos: el manifiesto compara todas las variantes anteriores.

## Evidencia

Carpetas `design-phase3-masters-20261020/` y `design-phase3-kpi-review-20261020/`, galerías, manifiestos y alturas exactas. Cifras, opciones, acciones de cabecera y semántica comparadas contra main ed63ce7a. Pruebas de selección en búsqueda/paginación/ordenación, revisión de ocultos y confirmación cancelada; dos acciones por fila sin duplicación del observer; scroll con columnas fijas; detalles abren/cierran. Red bloqueada; servicios mutadores fallan si se invocan. Reflow/claro/oscuro y regresiones de pantallas ya migradas se consignan con la validación final.

## Límites y desviaciones

Las cargas y paginación de datos de maestros siguen siendo de cliente. El lote no introduce RPC, migraciones ni llamadas nuevas al backend y no se presenta como mejora de escala. Clientes y Proveedores pueden añadir altura en escritorio al separar búsqueda y equilibrar KPI, sin eliminar información. No cambia el texto/cálculo de margen sin coste, pendiente independiente. Amazon/Shopify, Soporte y Configuración/Administración quedan para los lotes siguientes después de revisión de este. La publicación requiere aprobación expresa de este lote.

## Rollback preparado (sin ejecutar)

No se fusiona ni publica. Si se autoriza posteriormente, rollback de frontend a la fase 2 validada: `dpl_9RMFEKn4AhoTo738mzvfBbdqCURS`, commit `ed63ce7aecff7c7a296b5fface372f89ee4b8bf7`, bundle `index-DlLrR06h.js`; comprobar alias y sesión. Alternativa: revertir el futuro merge por PR y CI. Sin rollback de datos.

## Verificaciones adicionales

Pruebas específicas observadas en rojo y verde: equilibrio de KpiGrid (sin variables de columnas), valor completo de filtros sin tooltip y observer heredado que inyectaba acciones móviles en una lista marcada nativa. Se corrigen con sus tests. Suite Node de CI: 1.222/1.222; regresiones de fase 1 y fase 2: todos los escenarios pasan tras regenerar referencias desde sus commits inmutables, en lugar de usar manifiestos antiguos guardados.

Una ejecución local de la suite completa con capturas de Chromium simultáneas agotó 30 s en `tests/pickup-reports-sql.test.ts` (PGlite); 248 de 249 pasaron. Se repite la suite completa sin las capturas simultáneas, sin ampliar timeouts ni omitir el test. El resultado final y CI remota se registran en el recibo del lote. Los 5xx impresos por auth-resilience son respuestas sintéticas del test, no errores de producción.

El reflow se verifica a 640 CSS px (ancho disponible equivalente a un escritorio de 1280 al 200 %), sin afirmar una prueba del zoom real del navegador del propietario. El manifiesto registra ausencia de desbordamiento, acciones y selección conservadas. Se comprueba foco del contenedor de tabla, selección al pasar de escritorio a móvil y botones móviles sin recorte, de al menos 44 px.

Validación final local: suite completa 249/249 (46 ficheros) al repetir sin Chromium simultáneo; `pickup-reports-sql.test.ts` pasa en 17,1 s. La nueva prueba del observer también pasa. La comprobación táctil mide el rectángulo completo de 44 px (incluye borde), no clientHeight, para no restar dos píxeles del área real.

## Revisión independiente

Revisión read-only de 168e6f6e: sin problemas críticos/importantes; valores/opciones/variantes y callbacks confirmados por diff. Se refuerza el harness con sus observaciones menores: inventario completo de etiquetas de opciones (no solo trigger cerrado), captura de errores emitidos al final de las interacciones y comprobación del registro destinatario de Eliminar en las tres pantallas; Editar comprueba el callback por registro en Productos/Proveedores. El editor interno de Clientes conserva su implementación y se revisa por diff, sin guardar datos. La nueva pasada de nueve escenarios pasa sin fallos.

## Correspondencia entre captura y medición

Se mide la geometría inmediatamente antes de la captura principal, antes de abrir filtros o recorrer interacciones. La repetición de los nueve escenarios confirma exactamente ambos manifiestos guardados: primera lista móvil Productos 1855,1 → 1148,5 px, Clientes 1590,2 → 1057,7 px y Proveedores 1475,2 → 1044,7 px. No hay cambios de aplicación en este ajuste del harness. Las cifras redondeadas antiguas de la descripción de la PR se sustituyen por estas mediciones.
