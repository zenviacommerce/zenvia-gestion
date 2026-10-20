# Sistema de diseño y consistencia de layout — propuesta para revisión

Fecha: 20 de octubre de 2026. **Fase 1: análisis; no aplicada a la interfaz.**

## Objetivo y alcance

Ordenar los patrones existentes de ZENVIA Gestión sin rediseñar la marca, alterar cálculos, permisos o flujos de trabajo. Mantener Inter, la identidad verde azulado, la navegación y los datos de cada pantalla. La prioridad es reducir scroll innecesario en móvil, alinear controles y hacer predecibles las mismas acciones.

Esta propuesta cubre las doce pantallas principales, Recibos y ocho formularios/modales. Las capturas proceden de producción con sesión real, tema claro y bundle `index-Duin0MgL.js`, commit `58687e42f63f0cc4a0c62fdc0582926668ed6c89`. Se usaron viewports de **390, 1280 y 1440 × 1000 px**; los modales, 390 y 1440. Son capturas de viewport, no de toda la página. El ancho útil puede ser 15 px menor por la barra de desplazamiento del navegador.

**Evidencia:** [índice de 61 capturas](design-review-20261020/README.md) y [mediciones del DOM](design-review-20261020/measurements.json). Se navegó y se abrieron/cancelaron formularios; no se guardaron datos, enviaron invitaciones/tickets ni generaron pedidos, facturas, etiquetas o informes. La vista temporal del navegador se restauró. La auditoría visual de esta fase es de tema claro; el tema oscuro se revisó en código y queda como comprobación visual obligatoria en cada fase de implementación.

## Inventario observado

Las cifras indican columnas ocupadas, salvo que se mencione un hueco. D = escritorio; M = 390 px. Los datos pueden variar durante el día: las capturas sirven para layout, no para conciliar cifras entre pantallas.

| Pantalla | KPI a 1280 / 1440 | KPI móvil | Lista y filtros actuales | Evidencia |
|---|---|---|---|---|
| Resumen | Finanzas 4 / 4; operativa 5 / 5 | Finanzas 2; operativa 1 | Secciones, movimientos y resumen de costes; periodo compartido | [Capturas](design-review-20261020/README.md#pantallas) |
| Pedidos | Ventas 4 / 4 para 5 tarjetas; estados 6 / 6 para 7 | 1 en ambos grupos | Tabla con scroll, checkbox fijo; tarjetas móviles; selección persistente y filtros propios | [Móvil KPI](design-review-20261020/pedidos-detalle-390-kpis.png) |
| Facturación | 4 / 5 | 1 | Tabla y tarjetas móviles explícitas; filtros de cliente, país, estado y cobro | [1440](design-review-20261020/facturacion-1440.png) |
| Recibos | 4 / 4 | 1 | Tarjetas móviles generadas por `UnifiedListExperience`; el periodo está después de los KPI | [390](design-review-20261020/recibos-390.png) |
| Gastos | 4 / 4 | 2, con desbordamiento de contenido | Periodo general y selector de periodo repetido; tabla y tarjetas móviles generadas | [Desbordamiento](design-review-20261020/gastos-390-kpis.png) |
| Productos | 4 / 5 | 1 | Maestro con tabla/tarjetas y filtros de categoría, proveedor, IVA y situación | [390](design-review-20261020/productos-390.png) |
| Clientes | 4 / 5 | 1 | Maestro con tabla/tarjetas; búsqueda, filtros y acciones masivas | [1280](design-review-20261020/clientes-1280.png) |
| Proveedores | 4 huecos para 3 KPI / igual | 1 | Maestro con tabla/tarjetas y clasificación | [1440](design-review-20261020/proveedores-1440.png) |
| Amazon | Carrusel de periodos; tarjetas de 330 px | Carrusel, tarjetas de 300 px | Tabla analítica con scroll horizontal; tabs y filtros propios | [390](design-review-20261020/amazon-390.png) |
| Shopify | Mismo patrón de carrusel | Mismo patrón de carrusel | Tabla analítica con scroll; estado vacío y conexión diferenciados | [Vacío](design-review-20261020/shopify-vacio-390.png) |
| Soporte | 3 / 3 | 1 | Lista de tickets, filtros y estado vacío | [390](design-review-20261020/soporte-390.png) |
| Configuración | No aplica | No aplica | Navegación lateral de secciones, horizontal en móvil; formularios propios | [1280](design-review-20261020/configuracion-1280.png) |
| Administración | 3 / 3 | 2 y tercer KPI a todo el ancho | Tabs de usuarios/auditoría y editor de permisos | [390](design-review-20261020/administracion-390.png) |

Amazon y Shopify **no** renderizan actualmente las antiguas rejillas `.amazonKpiGrid` o `.amazonProfitKpis`: usan `AmazonPeriodCards` y `ShopifyPeriodCards`. No se debe modificar CSS inactivo suponiendo que controla sus resúmenes.

## Inconsistencias por patrón

| Patrón | Evidencia actual | Criterio propuesto |
|---|---|---|
| Rejillas KPI | 1, 2, 3, 4, 5 o 6 columnas con excepciones por pantalla. En Pedidos móvil el primer KPI empieza a ~1115 px; en Facturación a ~1014 px. | Dos columnas en móvil y contrato explícito de densidad; revisar también altura de cabecera/acciones/periodo. |
| Contenido de KPI | Gastos móvil: contenedor **345 px**, contenido **527 px**. El importe multimoneda impone ancho mínimo y recorta la segunda columna. | `minmax(0,1fr)`, hijos con `min-width:0` y saltos entre importes/divisas. No reducir el texto hasta hacerlo ilegible. |
| Tarjetas | Gaps 10/12/14/15 px; padding, iconos, radios y sombras repartidos entre estilos globales y de página. | Una superficie, padding y jerarquía de icono/título/valor; variantes semánticas explícitas. |
| Cabeceras | Eyebrow y título comunes, pero Shopify tiene su variante; Facturación/Gastos añaden tabs superiores. Acciones móviles se apilan y retrasan la lista. | `PageHeader` con zona de contexto, título, descripción y acciones; no forzar la misma coordenada vertical cuando existen tabs. |
| Filtros | Alturas 40/42/44 px y mínimos móviles 48 px; Pedidos fija 42 px. Etiquetas de 10/11/12,5 px y capitalización diferente. Periodo duplicado en Gastos. | `FilterBar`/`FilterField` con altura única por breakpoint, etiquetas alineadas, una fila de texto con elipsis y nombre completo accesible. Un único periodo por ámbito. |
| Tabs | Amazon/Shopify subrayadas; Pedidos segmentadas para estados; Facturación/Gastos usan tarjetas de navegación distintas. | Separar navegación entre secciones de filtros de estado; no mezclar ambas semánticas. |
| Tablas/listas | Tarjetas explícitas en maestros, Pedidos y facturas; tarjetas generadas desde DOM en Gastos/Recibos; tablas analíticas con scroll en canales. | Un contrato de tabla y uno de tarjeta móvil, con adaptación por tipo de dato; preservar las tablas analíticas densas. |
| Selección y paginación | Distintas ubicaciones/formatos. Pedidos ya conserva IDs y permite selección de todos los resultados del servidor. | Barra de selección y paginación comunes; conservar exactamente el alcance y la selección completa. |
| Botones | Variantes primario/secundario/peligro e iconos, pero con padding, alturas y anchos distintos. Algunos cierres solo contienen un icono sin nombre accesible. | Variantes y tamaños comunes, nombre accesible obligatorio y estados de espera/disabled consistentes. |
| Modales | En producción: Producto/Proveedor/Soporte/Admin 720 px; Cliente 780; Pedido 900; Factura/Recibo 1260. En móvil ocupan 362–375 px y empiezan a alturas diferentes. | Tamaños declarados según tarea, mismo contenedor, scroll y acciones. El editor de líneas necesita una variante amplia; no todos deben tener el mismo ancho. |
| Formularios | Producto/Cliente usan `FormModal`, `FormSection`, `FormGrid`; Proveedor, pedidos, facturación, Soporte/Admin y Configuración mantienen estructuras propias. | Reutilizar los campos y secciones existentes; adaptar el contenedor progresivamente, sin reescribir validaciones. |
| Vacío/carga/error | Estados específicos en canales; mensajes locales en otras páginas. Ausencia de datos, datos incompletos y fallo no siempre tienen jerarquía común. | Componentes de estado distintos; ningún fallo se convierte en cero o en ausencia de resultados. |
| Tipografía y color | Inter y teal ya son comunes; tamaños, grises, pesos y valores hexadecimales locales siguen dispersos. | Tokens semánticos y una escala pequeña; el contenido principal de una misma lista conserva la misma jerarquía. |
| Cascada CSS | Normalización repartida en `interface-normalization`, `modern-forms`, `mobile-ui-normalization`, `theme-consistency` y `responsive-hardening`, con numerosos `!important`. | Un propietario por componente y una capa de tokens; retirar reglas antiguas solo al migrar/verificar su pantalla. |

## Reglas globales propuestas

### Tokens

Conservar los colores actuales de `theme-consistency.css` como punto de partida; los nombres describen su función, no una pantalla. No introducir una paleta nueva.

| Familia | Propuesta |
|---|---|
| Espaciado | Escala 4, 8, 12, 16, 24, 32, 40, 48 px. Gap KPI 12 móvil / 16 escritorio; sección 24 móvil / 32 escritorio. |
| Padding de página | 16 px móvil; 24 tablet; 32 escritorio. El contenedor puede reducirse al convivir con navegación lateral. |
| Radios | Campo/botón 10 px; tarjeta 16 px; modal 18 px; bottom sheet 20 px solo en esquinas superiores; píldora para estados. |
| Sombras | Una sombra suave para superficies elevadas y otra para overlays. En oscuro, priorizar borde y superficie, evitando sombras fuertes. |
| Texto | Inter con fallback actual. Cuerpo 14 px; secundario 13; ayuda 12; etiqueta 12–13; H1 29 escritorio / 24 móvil; H2 20; H3 16. Pesos 400/500/600/700. |
| KPI | Valor 24 escritorio / 20 móvil, peso 700; label 12–13; descripción 12. Dígitos tabulares en importes y columnas numéricas. No usar color como único indicador. |
| Controles | Altura 42 px escritorio / 48 px móvil. Inputs móviles de texto a 16 px para evitar zoom automático en iOS. Área táctil de iconos/checkbox al menos 44 × 44 px, aunque el glifo sea menor. |
| Color claro | Fondo `#f6f8fb`; superficie `#fff`; suave `#f8fafc`; texto `#172033`; secundario `#64748b`; borde `#e2e8f0`. |
| Color oscuro | Fondo `#090f1c`; superficie `#111827`; suave `#0f172a`; elevada `#172033`; texto `#e5e7eb`; secundario `#94a3b8`; borde `#334155`. |
| Acción/estado | Mantener teal actual (`#0f766e` como acción); tokens separados para hover/foco, éxito, aviso, error e información. El contraste se comprueba con el par texto/fondo real. |
| Capas | Capas documentadas para columna sticky, cabecera sticky, menú, backdrop, modal y toast; evitar valores locales arbitrarios. |

### Responsive y KPI

Los breakpoints siguientes organizan el contenido, no cambian la navegación: se conserva su breakpoint móvil actual de 900 px. El contenedor principal debe poder encoger con `min-width:0`. La tabla siguiente es un contrato inicial, que se validará también con sidebar y zoom de texto.

| Viewport | Layout | `KpiGrid` por defecto |
|---|---|---|
| < 768 px | Una columna de secciones; controles táctiles | **2 columnas**, `repeat(2,minmax(0,1fr))` |
| 768–1023 px | Contenido adaptable al espacio restante | 3 columnas; 4 solo si el ancho útil soporta el contenido sin comprimirlo |
| 1024–1279 px | Escritorio compacto | 4 columnas |
| ≥ 1280 px | Escritorio | 4 columnas; variante `dense` de 6 para KPI operativos cortos, si hay espacio útil suficiente |

Un KPI destacado puede ocupar dos columnas móviles **solo con un motivo declarado**: aviso operativo crítico o contenido que perdería legibilidad. No asignar ancho completo a toda una familia de KPI. No alterar valores/monedas para que quepan. Los importes multimoneda se separan en líneas, manteniendo cada importe y su divisa juntos.

Finanzas y operativa conservan sus secciones. Amazon/Shopify mantienen el carrusel compartido de comparación de periodos en esta primera normalización; sus métricas interiores siguen una rejilla de dos columnas. Convertirlo en otra estructura sería una decisión posterior de producto.

### Contrato de componentes

| Componente | Responsabilidad | Reutilización inicial |
|---|---|---|
| `PageHeader` | Contexto, título, descripción y acciones, orden/preferencia responsive | Adaptar `.pageHead`; una acción principal visible, secundarias con wrapping controlado. Un menú de acciones adicionales se propondrá por pantalla si hace falta. |
| `KpiGrid` + `StatCard` | Columnas, gap, spans declarados y jerarquía del contenido | **Reutilizar `StatCard`**, no crear otro KPI paralelo. |
| `Section` | Título, explicación, acciones y separación entre grupos | Unificar `.cardHead`, títulos de panel y secciones de Configuración. |
| `FilterBar` + `FilterField` | Grid, etiquetas, búsqueda, anchos y reset | Reutilizar `SelectField`, `SearchableSelect` y `PeriodFilterPanel`. |
| `SectionTabs` / `StatusFilter` | Navegación / filtro de estado, respectivamente | Tabs subrayadas compartidas de canales; segmentados para estados de pedidos. |
| `DataTable` | Ordenación, scroll contenido, sticky, selección y estados | Reutilizar `SortableTableHeader`, `Pagination` y `BulkSelectionToolbar`. |
| `MobileList` / `RecordCard` | Identidad, estado, importes, metadatos y acciones | Adaptar las tarjetas actuales; sustituir generación por DOM de forma gradual y probada. |
| `SelectionBar` | N seleccionados, revisar/quitar, acciones y alcance | Conservar IDs fuera de la página, alcance y confirmaciones existentes; la presentación no modifica las reglas de cada acción. |
| `FormModal` / `FormSection` / `FormGrid` | Contenedor, campos, scroll, acciones y mensajes | Extender las primitivas existentes; conservar los servicios/validaciones propios de cada formulario. |
| `EmptyState` / `LoadingState` / `ErrorState` | Estado explícito del panel con acción relevante | Distinguir vacío real, filtros sin resultados, desconectado, incompleto, error transitorio y datos antiguos. |
| `Button` / `IconButton` / `StatusBadge` | Variantes, tamaños, foco y estados semánticos | Primero normalizar clases existentes; evitar introducir dos APIs de botones a la vez. |

### Filtros, listas y selección

- Escritorio: grid con búsqueda flexible y campos de ancho mínimo coherente; etiquetas alineadas por arriba y controles con igual altura. A 1280 px, pasar filtros secundarios a otra fila antes de comprimir el texto o desbordar.
- Móvil: búsqueda a todo el ancho; pares de filtros solo si cada uno sigue siendo legible/táctil. Para cinco filtros largos como Pedidos, una columna es válida; el bloque debe tener una jerarquía compacta y no competir con la acción principal. No ocultar filtros activos.
- Textos largos de select: una línea con elipsis, valor completo en el nombre accesible/tooltip y dentro del desplegable. No elevar una etiqueta porque el valor de su control ocupa dos líneas.
- Listas operativas y maestros: tarjeta móvil con selección, identidad, estado, importe y acciones. La tarjeta usa la misma fuente de datos y la misma selección que la tabla.
- Tablas analíticas densas: scroll horizontal dentro de su contenedor, primera columna identificativa fija cuando sea viable, cabecera y foco visibles. No convertir decenas de métricas en una tarjeta vertical interminable.
- Columna checkbox sticky con superficie opaca y separación visual; número de pedido/identidad también fijo cuando su ancho lo permita. Mantener el trabajo ya publicado en #254/#255.
- Paginación y alcance consistentes arriba/abajo según la longitud. `Seleccionar página` y `Seleccionar todos los que coinciden` mantienen sus significados distintos. No limitar una acción masiva silenciosamente a lo visible ni reiniciar selección al buscar.

### Modales, formularios y estados

- Tamaños explícitos propuestos: pequeño 480 px, estándar 720, grande 900, editor de líneas 1200; siempre limitados al viewport. La variante amplia de facturas/recibos se conserva por su editor, no se fuerza al modal estándar.
- Móvil: un contenedor consistente, margen superior mínimo y safe areas; acciones accesibles y cuerpo que desplaza sin perderlas. Evitar anchos distintos por overrides de cada formulario y dobles scrolls. Comprobar también teclado virtual.
- Cierre con nombre accesible, Escape y retorno del foco; no cerrar por backdrop un formulario con cambios sin la protección ya prevista. No modificar reglas de confirmación de acciones sensibles.
- Labels visibles y ayuda debajo del campo; error asociado al campo más un resumen si procede. Asterisco/obligatoriedad coherentes. No depender solo del placeholder.
- Carga inicial: esqueleto que reserve el tamaño del panel; refresco: mantener el contenido con estado de actualización. Una tarjeta lenta no bloquea las otras.
- Error transitorio: explicación y Reintentar en ese panel. No aplica, sin cobertura, desconectado e incompleto son estados distintos y no llevan un reintento engañoso.
- Datos financieros incompletos no se presentan como cero ni como un margen real. El pendiente «margen parcial 100 % sin coste» sigue registrado; esta fase no cambia su cálculo ni su texto.

## Fuentes existentes y estrategia de adopción

Puntos de partida: `src/components/StatCard.tsx`, `PeriodFilterPanel.tsx`, `Pagination.tsx`, `SortableTableHeader.tsx`, `BulkSelectionToolbar.tsx`, `ShippingProviderStatus.tsx`, `ActionDialogHost.tsx` y `src/components/forms/`. Maestros: `master-data.css`; formularios: `shared-forms.css`/`modern-forms.css`; canales: `amazon.css`; filtros: `interface-normalization.css`; tema: `theme-consistency.css`; excepciones responsive: `responsive-hardening.css`. El orden de importación de `main.tsx` forma parte del resultado actual.

No cambiar todo el CSS global de una vez ni añadir una nueva capa de `!important` sobre las anteriores. Cada migración retira únicamente las reglas que pasan a ser propiedad del componente común, comprobando otras pantallas que usaban esos selectores.

## Fases propuestas, pendientes de revisión

1. **KPI y contención:** tokens mínimos + `KpiGrid` sobre `StatCard`; primero Resumen y Pedidos; después Gastos (incluido multimoneda), Facturación/Recibos y maestros. Mismas cifras, acciones y filtros.
2. **Cabeceras/filtros/tabs:** contrato de header, alturas, anchos y etiquetas; integrar las correcciones recientes de Pedidos sin regresiones.
3. **Tablas y tarjetas:** contrato de selección/identidad/paginación; sustituir tarjetas generadas por DOM pantalla a pantalla. Mantener el carrusel y las tablas analíticas de canales salvo decisión expresa.
4. **Formularios/modales/estados:** contenedor y variantes compartidas; migrar formularios existentes con sus validaciones y servicios; normalizar vacío, carga y errores.
5. **Cierre de cascada:** retirar overrides ya sustituidos, documentar excepciones justificadas y comprobar claro/oscuro.

Cada fase tendrá PR y capturas antes/después a 390/1280/1440 px; CI en verde; revisión visual y despliegue solo dentro de la autorización de esa fase, con rollback de Vercel anotado. Verificar búsqueda, ordenación, selección completa, paginación, formularios, foco y zoom al 200 %, además de imports/etiquetas/MFA existentes. No comprar etiquetas ni crear documentos reales para demostrar layout.

**Regla de continuidad:** tras aprobar e implantar estos componentes, toda pantalla nueva utiliza sus contratos; cualquier excepción se explica en la PR. Esta fase no implementa componentes ni cambia `src/`, SQL o Edge Functions.

## Punto de parada y orden posterior

Orden actualizado por el propietario el 20 de octubre de 2026: terminar Shopify y las fases de diseño de Gestión; después auditar y alinear ZENVIA PLATFORM (admin.zenviacommerce.com); solo entonces cerrar MFA y continuar con la solicitud de desarrollador público SP-API y la validación de cifras frente a Seller Central.

Platform empieza con **auditoría sin cambios**: capturas móvil/escritorio y mediciones de carga/RPC/EXPLAIN; propuesta y **DETENERSE para revisión**. Evaluar reutilización de tokens, PageHeader, KpiGrid/StatCard, FilterBar, DataTable/MobileList, selección persistente/columna fija, modales/estados y responsive. Clientes/workspaces y tickets necesitan paginación/búsqueda/filtros en servidor, KPI agregados, índices medidos, cargas de detalle mínimas, refresco por eventos y respaldo sin recarga, conservación de selección/búsqueda y caché compartida invalidada al crear/editar clientes, tickets y planes. Soporte: filtros por estado, prioridad, cliente y asignado, para cientos o miles de tickets. No migrar Platform antes de aprobar esa propuesta.

## Ajustes aprobados — 20 de octubre de 2026

Este documento está **aprobado como contrato de diseño**. La fase 1 fue revisada y aprobada para publicar por el propietario, en un despliegue posterior y separado de Shopify. Las fases siguientes conservan su revisión visual previa.

- **Acceso móvil a listas operativas:** a 390 × 1000 px, con el estado inicial de referencia, el borde superior del primer elemento real de Pedidos, Facturación y Gastos debe estar antes de 1800 px desde el inicio del documento (dos pantallazos con al menos 200 px de lista visibles al terminar el segundo). Registrar coordenada absoluta y número de alturas de viewport antes/después en cada fase. La posición se mide sobre el primer elemento de datos, no sobre el título o cabecera vacía. En estados sin resultados, medir el comienzo del estado vacío. Registrar filtros/avisos activos; no ocultar información ni cambiar cifras para cumplir el límite. El primer KPI de Pedidos rondaba 1115 px: la fase 1 medirá y reducirá ese coste vertical.
- **Acciones móviles de cabecera:** una fila horizontal con overflow accesible o menú «Más»; nunca una pila vertical de botones. Cabecera compacta, manteniendo todas las acciones, nombres accesibles y confirmaciones.
- **Adopción obligatoria:** toda pantalla y componente nuevos usan los componentes del contrato disponibles (PageHeader, KpiGrid sobre StatCard y los restantes a medida que se incorporan). No crear rejillas o superficies de KPI paralelas. Una excepción requiere motivo explícito en la PR. Añadir una comprobación ligera en CI y pruebas de layout para las pantallas migradas; las pantallas heredadas se migran por fases, sin forzar cambios globales.
- **Contención:** KpiGrid usa dos columnas móviles con `minmax(0,1fr)` y los hijos/contenido multimoneda `min-width:0`. Una sola superficie visual de tarjeta. Nunca una familia completa de KPI a ancho móvil completo.
