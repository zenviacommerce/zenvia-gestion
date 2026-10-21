# Gestión: pertenencia de maestros y periodo de análisis

Fecha: 2026-10-21. Rama de trabajo: `fix/master-period-products-20261021`.
Base local: `95891f98`; su árbol `482bf836f86e8d73eee0c29037b29bd961d47677` fue contrastado por el responsable de integración con producción/main `5e90cb6fc6e1997ca4dd3376e3c6e15e06573699` antes del cambio.

## Contrato

El periodo de análisis modifica indicadores y datos derivados por periodo. Por defecto no oculta registros de un maestro por no tener actividad, por estar fuera del intervalo o por carecer de fecha. Los filtros propios elegidos expresamente por el usuario siguen restringiendo la lista. Los filtros explícitos de actividad o saldo pueden depender del periodo.

## Hallazgo y cambio acotado en Productos

Antes, `periodProducts` filtraba el catálogo por `lastPurchaseDate` y `shown` aplicaba los filtros propios a ese subconjunto. La lista, ordenación, páginas, selección visible y los seis KPI dependían de `shown`; por ello un periodo vacío ocultaba el catálogo completo.

Ahora `shown` aplica búsqueda, categoría, proveedor, IVA y situación al catálogo completo. Ese conjunto alimenta tabla/móvil, ordenación, páginas y selección visible. `periodProducts` aplica después el criterio temporal a `shown` y alimenta únicamente los seis KPI. Cambiar sólo el periodo conserva la página actual y la selección. Los filtros propios y la ordenación conservan su reinicio de página habitual.

No se ha redefinido la semántica de los KPI: el criterio existente es la fecha de última compra/actualización de coste representada por `lastPurchaseDate`, no ventas históricas ni movimientos de cada periodo. Los límites son inclusivos y `Todo` incluye registros sin fecha. Se mantiene el tratamiento existente de `null`, coste cero, umbrales y margen. El primer indicador se llama ahora “Productos en periodo”; el denominador de “Con precio de venta” dice “en el periodo”. La nota del selector explica su alcance y el contador de resultados ya no atribuye la lista al periodo.

| KPI | Cálculo conservado dentro de `shown ∩ periodo` |
| --- | --- |
| Productos en periodo | Número de productos, incluidos los sin coste/precio de venta |
| Con precio de venta | Precio de venta distinto de null en `salesMap` |
| Margen medio | Media aritmética de porcentajes calculables, sobre coste |
| Coste medio | Media aritmética de últimos costes distintos de null |
| Margen bajo | Margen calculable inferior al máximo de los dos umbrales configurados |
| Subidas de coste | Variación respecto al coste anterior al menos igual al umbral configurado |

## Inventario de maestros revisados

La navegación `src/components/Sidebar.tsx` contiene exactamente tres entradas en Gestión: Productos, Clientes y Proveedores.

| Maestro/superficie | Pertenencia de lista y periodo | Resultado |
| --- | --- | --- |
| Productos (`src/pages/Products.tsx`) | Antes partía de catálogo filtrado por última compra; ahora parte del catálogo completo con filtros propios | Única corrección de código de producto |
| Clientes (`src/pages/Clients.tsx`) | `clients.filter` parte de todos los clientes. El periodo filtra facturas y métricas; país/búsqueda son propios | Conforme; sin cambios |
| Clientes: Situación | `active`, `inactive`, `pending`, `settled` usan expresamente las métricas del periodo | Se conserva la elección explícita |
| Proveedores (`src/pages/Suppliers.tsx`) | `suppliers.filter` parte de todos los proveedores. El periodo filtra facturas y métricas; tipo/categoría/búsqueda son propios | Conforme; sin cambios |
| Proveedores: Actividad | `active`/`inactive` usan expresamente número de facturas del periodo | Se conserva la elección explícita |
| Tarifas de transporte (`src/components/TransportTariffsPanel.tsx`) | Versiones renderizadas desde todos los documentos cargados; fechas son vigencia de tarifa, no filtro de análisis de maestro | Sin filtro temporal implícito observado; sin cambios |
| Categorías de gasto (`src/services/expenseCategories.ts`) | Selección por estado `active` y orden, sin periodo; opciones de proveedores/productos proceden del maestro | Sin filtro temporal implícito observado; sin cambios |
| Configuración: métodos de pago, series, registros fiscales, integraciones y reglas (`src/pages/Settings.tsx`, inspección) | Opciones/editores usan configuración o estado propio activo/habilitado/proveedor; no heredan el periodo de Gestión | Revisión estática; sin cambios |

Pedidos, Facturación, Gastos, Amazon y Shopify son operaciones/canales con semántica temporal propia; no son los maestros del grupo Gestión. Sus comportamientos no se modifican. Tampoco se modifica MFA, bancos ni tareas pendientes ajenas a este alcance.

## Regresiones y evidencia

`tests/master-period-products.test.tsx` monta el componente Products real con tabla, filtros, selector de periodo, KPI, ordenación, paginación, selección y drawer reales. Sólo reemplaza el acceso externo a configuración y precios de venta. Los datos incluyen compra dentro del intervalo, compra anterior y producto sin fecha/actividad ni precio de venta.

RED antes de editar producción, mediante `npx vitest run tests/master-period-products.test.tsx`: 3 pruebas fallidas. La página 2 desaparecía al acotar el periodo; Comida devolvía una fila en lugar de dos porque se ocultaba la compra anterior; un periodo sin compras eliminaba la tabla. Se corrigieron selectores de la propia prueba antes de aceptar RED.

GREEN cubre conservación de página 2 y selección sin fecha, lista anterior al intervalo, los seis KPI y su transición a Todo, intersección KPI/filtros propios, búsqueda EAN, categoría, proveedor, IVA, situación con precio, ordenación, detalle y periodo sin resultados KPI.

`tests/master-period-directories.test.tsx` monta Clientes y Proveedores reales, sustituyendo sólo cargas externas y configuración. Demuestra tres registros visibles por defecto con un único registro activo en el periodo; los filtros explícitos activo/inactivo reducen correctamente la lista y reaccionan a Todo.

Validación:

- Regresiones focales: 2 archivos, 5/5 pruebas verdes.
- `npm test`: 54 archivos, 276/276 pruebas verdes (baseline: 271).
- `node --test $(find scripts -maxdepth 1 -name '*.test.mjs' ! -name 'mfa-real-integration.test.mjs' | sort)`: 1.243/1.243 pruebas verdes.
- `npm run build`: verde (TypeScript, Vite y verificación de icono iOS); aviso no bloqueante de tamaño de chunks.
- `git diff --check`: verde.

La prueba de integración MFA real requiere servicios y secretos de su workflow específico y se excluye con el mismo comando del workflow principal. No se ejecutan mutaciones ni SQL contra producción. La evidencia visual y el despliegue/rollback corresponden al responsable de integración.
