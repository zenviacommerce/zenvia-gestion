# Productos: periodo de indicadores y catálogo completo

Captura offline reproducible de `Products`, `SettingsProvider`, `Sidebar`, `AutoPagination` y `UnifiedListExperience` reales. No usa datos reales ni realiza escrituras. No sustituye una prueba E2E de producción.

- Antes: referencia inmutable `95891f9816313bfe11b7b910593689e267e200c5`, cargada mediante `git show` para todas las fuentes TS/TSX/CSS de `src` y `packages/ui/src`.
- Después: árbol de trabajo con la corrección de `src/pages/Products.tsx`.
- Fecha fija: 21 de octubre de 2026, UTC; idioma `es-ES`; movimiento desactivado antes del montaje; red externa bloqueada.
- 72 productos sintéticos constantes: 32 con última compra en octubre, 32 en septiembre y 8 sin fecha; 24 sin precio de venta. Página de 25 registros.
- 390, 1280 y 1440 px; 8 estados por anchura y fase; 48 PNG en total.
- CSS real: 58 imports del grafo transitivo `main`/`App` más los imports de los componentes, procesados por esbuild; `@zenvia/ui` resuelto a fuentes originales. 282 archivos fuente registrados por SHA-256 en cada fase. CSS idéntico entre fases.
- Mocks limitados a las fronteras de carga/persistencia de ajustes, mapa de ventas, Supabase, avisos y acciones; el proveedor y los helpers de ajustes son reales. Las confirmaciones se cancelan y cualquier escritura inesperada lanza un error.

## Resultado verificado

| Comprobación | Antes | Después |
|---|---|---|
| Mes actual / anterior | El catálogo cambia de identidad | Mismas identidades y 72 resultados |
| KPI por periodo | Cambia según última compra | Cambia según última compra |
| Cambiar periodo en página 2 | El filtro gobierna catálogo | Conserva página 2 e identidades |
| Buscar «Sin actividad» | 0 resultados | 8 productos sin fecha |
| Filtro propio «Sin precio de venta» en septiembre | Sólo registros del periodo | 24 productos del catálogo |
| Acciones nuevo/editar/eliminar | Disponibles | Conservadas |
| Overflow del documento | No | No |

Los estados `current-month` y `previous-month` muestran la parte superior con indicadores; `catalogue`, `current-page-2`, `previous-page-2`, `search-no-activity` y `without-sale` muestran filtros/lista; `detail` muestra la ficha sin mutaciones. El manifiesto de cada fase registra las identidades de cada captura, textos KPI y sus hashes.

Ejemplos: [antes 390 catálogo](before-products-390-catalogue.png), [después 390 catálogo](after-products-390-catalogue.png), [antes búsqueda sin actividad](before-products-1280-search-no-activity.png), [después búsqueda sin actividad](after-products-1280-search-no-activity.png), [después 1440 indicadores](after-products-1440-current-month.png).

## Reproducción

Desde la raíz del repositorio, con las herramientas offline ya disponibles en `/workspace/scratch/209f463fbd52/ui-extraction/node_modules`:

```sh
node scripts/master-period-screenshots.mjs before
node scripts/master-period-screenshots.mjs after
```

El script exige que los indicadores cambien con el periodo, las identidades permanezcan iguales después, página 2 se conserve al alternar periodos, los productos sin fecha aparezcan en búsqueda y el filtro propio reduzca el catálogo. También rechaza errores de página, overflow horizontal o pérdida de acciones. `manifest-comparison.json` resume la comprobación cruzada y la verificación de los 48 hashes PNG.
