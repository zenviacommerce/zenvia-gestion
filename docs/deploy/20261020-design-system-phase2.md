# Fase 2: cabeceras, filtros y tabs de Facturación, Gastos y Recibos

## Estado y alcance

Implementación para revisión, NO publicada. El contrato de diseño está aprobado; la publicación de fase 2 requiere revisión explícita del propietario. Rama `feature/design-system-phase2-20261020`, base actual `cfa6d3da52409d98216d696285e5f7862edb8939` (hotfix #264 ya publicado, conserva #262). La captura inicial permanece fijada en fase1 `aa8677dd`: los cambios del hotfix no alteran estas tres listas, cifras ni filtros. Se incorporan por herencia el acceso a Tarifas, el aviso y los previews corregidos, sin reescribirlos.

Sin SQL, Edge, Auth, sincronizaciones ni cambios de cálculo. Se conserva la información y las acciones existentes. Shopify y MFA fuera del alcance.

## Auditoría y aplicación

- Cabeceras locales → PageHeader; se conservan todos los botones, orden, disabled y acciones. Móvil: fila horizontal, scroll y flecha/degradado. El portal tardío Importar/Exportar de Facturación apunta a la fila compartida; PageHeader detecta sus cambios y actualiza la indicación de desbordamiento.
- Familias de KPI → KpiGrid/StatCard, dos columnas móviles y cuatro en escritorio. Una sola superficie por tarjeta, minmax(0,1fr) y contenido min-width:0. Los valores EUR y USD de Gastos siguen separados y conservan exactamente sus importes; se ajusta su tipografía al ancho útil y pueden fluir sin desbordar.
- FilterBar común conserva los campos y handlers de búsqueda, periodo y filtros actuales. Gastos conserva categoría, proveedor, estado, pago, origen y reset. Solo se retira la propiedad de layout de las reglas antiguas sobre los filtros migrados; el resto mantiene su estilo actual.
- La revisión visual detectó un propietario CSS antiguo que aún forzaba tabs de Facturación a 220 px y recortaba la segunda. El nuevo test de desbordamiento falló antes; se excluye PageTabs de esas reglas antiguas y se usan dos columnas minmax en móvil.
- PageTabs común conserva etiquetas, descripciones y cambios de sección, con selección accesible y navegación por flechas/Home/End. La página retenida de importación/Gmail no cambia de lógica ni de identidad.
- Se elimina en estas tres páginas el segundo padding móvil de cabecera, que se sumaba al desplazamiento de tabs ya existente. No se cambia la navegación ni los breakpoints globales.

## Altura hasta el primer dato de la lista

Medida desde el inicio del documento hasta la primera fila/tarjeta real; viewport de altura 1000 px y anchuras idénticas, locale es-ES. Son fixtures deterministas con los componentes reales, adaptadores de lista y cascada completa, no mediciones de la sesión del propietario. Se muestran 32 documentos sintéticos; el estrés de Gastos contiene 19.753.086,24 EUR y 15.802.469,12 USD sin sumarlos.

| Pantalla | Ancho | Antes | Después | Pantallazos después |
|---|---:|---:|---:|---:|
| Facturación | 390 | 2448 | 1349 | 1.35 |
| Gastos | 390 | 2293 | 1557 | 1.56 |
| Recibos | 390 | 1857 | 1204 | 1.20 |
| Facturación | 1280 | 1136 | 1133 | 1.13 |
| Gastos | 1280 | 1172 | 1130 | 1.13 |
| Recibos | 1280 | 912 | 879 | 0.88 |
| Facturación | 1440 | 1106 | 1087 | 1.09 |
| Gastos | 1440 | 1088 | 1097 | 1.10 |
| Recibos | 1440 | 912 | 862 | 0.86 |

Las tres cumplen <1800 px en móvil y la lista asoma en los dos primeros pantallazos. En Gastos a 1440 la lista queda 9 px más abajo: se conservan siete KPI en la rejilla homogénea y toda la información multimoneda. No se oculta contenido para mejorar la medida. Las tablas de escritorio conservan su scroll horizontal propio; no se ensanchan tarjetas ni documento para hacer caber columnas.

## Verificación

- Tests de PageTabs: selección, teclado, foco y conservación de descripciones; FilterBar: comportamiento del campo y grupo accesible; PageHeader: portal tardío y retirada del indicador al llegar al final.
- Harness: antes/después a 390/1280/1440, KPI textuales normalizados idénticos, controles y disabled idénticos, mismas acciones de cabecera (incluido portal), ninguna tarjeta/documento desbordado. Capturas móviles también en oscuro y segundo pantallazo.
- En móvil abre/cierra los modales Importar/Exportar de Facturación sin ejecutar importaciones/descargas. Comprueba búsqueda sin coincidencias y restauración; compara el comportamiento de selección móvil con la versión anterior. Facturación y Gastos ya vaciaban la selección al cambiar filtros; Recibos la conservaba. Se preserva ese comportamiento en esta fase, sin presentar la selección persistente como mejora implementada. Su unificación corresponde a la fase de DataTable/MobileList. Los mutadores de datos están bloqueados en la fixture; red bloqueada.
- El estado vacío de Facturación anterior estaba en la tabla oculta en móvil: la comprobación de búsqueda verifica que se genera el estado correspondiente y al limpiar reaparecen las filas/selección; no se presenta como una nueva mejora de EmptyState. Esa normalización corresponde a su fase posterior.
- CI añade el harness a screenshots y artefacto `design-phase2-review`. Tests completos, scripts, build y CI remoto se consignarán tras terminar.

Capturas: `docs/deploy/design-phase2-review-20261020/` (`before/after` + pantalla + ancho; manifiestos con decimales y geometría). Solo datos sintéticos. Se mantiene el harness reproducible en `scripts/design-phase2-screenshots.mjs`.

## Rollback y límite de revisión

Producción permanece en `dpl_5KjeeSo3VSXSqNJjCPaNV4oNCRFP`, commit `cfa6d3da52409d98216d696285e5f7862edb8939`, bundle `index-1XUnT9OV.js`. Es el rollback de una eventual fase 2; conserva Shopify, fase 1 y hotfix #262/#264. No hay rollback de datos. DETENER antes de merge/publicación hasta revisión del propietario; un PR/preview de revisión no cambia el dominio de producción.

## Cobertura y revisión

El test estático que exigía `stats expenseStats` y el test de tabs basado en texto JSX se sustituyen por geometría/labels/roles sobre las pantallas renderizadas; las comprobaciones de datos existentes se mantienen. Suites locales: 238 tests Vitest/44 ficheros y 1.222 tests Node. Build y guard de contrato pasan. La revisión independiente no encontró problemas bloqueantes; se excluye el icono generado por build. Como evolución del contrato quedan enlaces ARIA tab/panel y una prueba de retención Gmail más completa; se conserva la identidad de RetainedImportPage por inspección, sin afirmar una verificación real de importación.

## Conservación de acciones de cabecera

Se incorpora `assertHeaderActionsPreserved` del hotfix264 a la comprobación de Facturación/Gastos/Recibos. Compara las acciones renderizadas con la referencia anterior y falla con el nombre de la que desaparezca; incluye el portal Importar/Exportar. CI ejecuta además el test de acceso real a Tarifas y el harness Resumen/Pedidos con OrderLabelDefaults histórico/actual. El hotfix se publica por separado y su despliegue verificado es la base y rollback de esta fase; no se incorpora una regresión de Tarifas al publicar diseño.
