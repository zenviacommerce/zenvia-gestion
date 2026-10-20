# Fase 1 — revisión antes de publicar

Componentes reales Resumen/Pedidos/Sidebar y cascada CSS completa, con los mismos datos sintéticos antes/después. Red bloqueada; ninguna operación sobre producción. Baseline inmutable: `58687e42`. No son capturas autenticadas de cifras actuales.

| Pantalla | 390 antes / después | 1280 antes / después | 1440 antes / después |
|---|---|---|---|
| Resumen | [Antes](before-dashboard-390.png) / [Después](after-dashboard-390.png) | [Antes](before-dashboard-1280.png) / [Después](after-dashboard-1280.png) | [Antes](before-dashboard-1440.png) / [Después](after-dashboard-1440.png) |
| Pedidos | [Antes](before-orders-390.png) / [Después](after-orders-390.png) | [Antes](before-orders-1280.png) / [Después](after-orders-1280.png) | [Antes](before-orders-1440.png) / [Después](after-orders-1440.png) |

En móvil, el [segundo pantallazo anterior de Pedidos](before-orders-390-second.png) se compara con el [segundo posterior](after-orders-390-second.png): el primer pedido asoma antes de1800px. [Resumen: segundo pantallazo](after-dashboard-390-second.png).

Muestras adicionales: [multimoneda](after-multicurrency-390.png), [Resumen oscuro](after-dashboard-390-dark.png) y [Pedidos oscuro](after-orders-390-dark.png).

## Medidas

| Pantalla/ancho | Primer KPI antes → después | Primer contenido después de KPI antes → después |
|---|---:|---:|
| dashboard / 390 | 774.3 → 515.6 px | 1664.6 → 1178.0 px |
| dashboard / 1280 | 375.3 → 372.3 px | 844.3 → 969.7 px |
| dashboard / 1440 | 375.3 → 372.3 px | 814.1 → 952.9 px |
| orders / 390 | 1155.8 → 519.2 px | 3158.8 → 1785.2 px |
| orders / 1280 | 474.9 → 468.9 px | 1558.9 → 1449.7 px |
| orders / 1440 | 474.9 → 468.9 px | 1475.9 → 1358.3 px |

En Resumen, la última columna mide el comienzo de las secciones posteriores, no una lista operativa equivalente a Pedidos. El límite de1800px se exige a Pedidos en esta fase; Facturación/Gastos quedan para sus migraciones. Los estados con avisos adicionales y los importes reales pueden modificar la altura: cada fase repite la medición con su estado declarado.

Los manifiestos incluyen coordenadas absolutas, columnas computadas, textos y estados de controles, desbordamiento y errores. Se comparan las12 tarjetas de Pedidos y las11 de Resumen, incluidos valores financieros no nulos. Una sola fila móvil de acciones, acceso por foco a «Nuevo pedido», apertura/cancelación sin guardar y conservación de selección verificadas. Ningún filtro/cálculo/handler de negocio se cambia.

`node scripts/design-phase1-screenshots.mjs before` y luego `after` reproducen la comparación. Se necesitan Playwright1.58.2 y Chromium (el workflow visual ya los instala). En el contenedor restringido se usó Chromium empaquetado con `SHIPPING_CHROMIUM_PACKAGE=1`.

## Decisiones de esta fase

- Pedidos reúne sus12 KPI en una rejilla, en el orden original; así evita el hueco al final de la familia de cinco tarjetas sin cambiar contenido. Resumen conserva las secciones Finanzas y Operativa.
- Cuatro columnas a1280/1440: seis solo a partir de1920, cuando el ancho útil permite conservar importes e iconos legibles. Móvil: dos columnas, sin spans de familia.
- Cabecera, presets y acciones masivas tienen overflow horizontal accesible; todos sus controles siguen en el DOM y conservan estados/handlers. Los selects flotantes existentes usan portal.
- Se retira la regla de fechas apiladas a390px solo para las páginas migradas. El formulario y los filtros conservan valores y opciones. Los cinco filtros de Pedidos se disponen en dos columnas móviles.
- Se reutiliza StatCard; KpiGrid no añade superficie. Nuevos valores ReactNode permiten varias divisas en líneas separadas sin sumarlas.
- La comprobación AST impide nuevos wrappers heredados en páginas/componentes y exige primitivas compartidas para nuevas páginas/KPI. El inventario heredado permite migración gradual. Es una barrera ligera, no una prueba de todos los posibles estilos dinámicos.

**DETENIDO antes de merge/publicación.** El contrato #259 ya está fusionado; la fase1 requiere revisión visual del propietario.
