# Fase 3 · lote 2: Amazon y Shopify (NO PUBLICADO)

## Auditoría y alcance aprobado

El propietario aprueba/publica lote 1 #265 y autoriza preparar Amazon/Shopify con revisión antes de publicar. Contrato existente docs/design-system.md; cambios acotados a presentación, sin nueva funcionalidad. Amazon y Shopify usan cabeceras/tabs/filtros propios; las cinco tarjetas de periodo y las tablas son componentes analíticos especializados que deben conservarse.

## Aplicación

PageHeader común conserva Actualizar datos, icono, estados deshabilitados, callbacks y condición de administrador/demo de Amazon; Shopify mantiene el estado de conexión en acciones. PageTabs común con contador Sin vincular, navegación por teclado y las seis/tres pestañas originales. FilterBar común con dos filtros iguales, texto en una línea y elipsis; se muestran compactos también en móvil. El gap de página es el único dueño del espacio entre secciones, sin duplicar márgenes. Carruseles, valores, fechas, previsiones, notas de calidad, Más/fechas, tablas y vinculación permanecen en sus componentes originales.

## Protección de datos y refresco

Hashes de los componentes de periodos/productos y servicios analíticos, y comparación exacta de hooks/callbacks de las páginas contra 002b953d, consignados en source-parity.json. No se cambian cálculos, RPC, SQL, Edge, Auth ni fuentes. Shopify conserva Realtime, invalidación y respaldo visible de 25 s; Amazon conserva el refresco por trabajos pendientes, conectividad y acciones actuales. La prueba de navegador simula eventos y callbacks manuales contra fixtures; nunca pulsa Actualizar datos en producción.

## Evidencia

Galería design-phase3-commerce-20261020/ con antes/después 390/1280/1440, Resumen y Productos, segunda pantalla móvil, alturas y manifiestos. Se cargan todas las tarjetas del carrusel antes de comparar y se vuelve a Hoy. Se comparan texto de todos los periodos, variantes positivas/negativas, botones, fila de producto, tabs y acciones. Se exige ausencia de overflow de documento y filtros de igual ancho/sin texto en dos líneas. Datos sintéticos, es-ES, red bloqueada; no constituye comprobación visual del propietario sobre sus datos.

## Tests y límites

PageTabs: test observado rojo sin badge y verde al conservar contador y navegación por teclado. Suite local completa: 250 tests pasan. Tests Node de Shopify actualizados al DOM semántico compartido y observers reales de happy-dom; comprobación de estilos claros/oscuros conservada. La infraestructura offline requirió UUID sintético porque about:blank no es contexto seguro; no modifica código de producción. No cambia el volumen de datos ni la paginación. Las tarjetas de periodo conservan el carrusel existente; no se sustituyen por KPI resumidos ni se ocultan cifras para reducir altura.

## Rollback preparado, sin ejecutar

Si se autoriza publicar lote 2, volver al lote 1 validado: main 0d34847a567b7baf4ffeb54fba1c97ffa4a176d6, deployment dpl_Aso26hWc9uXcmmcC5ppWpcMJFFys, bundle index-e22tGZwY.js; comprobar alias y sesión. Alternativa revertir futuro merge por PR/CI. Sin rollback de datos. DETENER antes de fusionar/publicar lote 2.

## Revisión independiente y validación final local

Revisión read-only de 247a2224: sin hallazgos críticos/importantes; nueve hashes y seis comparaciones de manifiestos confirmados de forma independiente. Observación menor de asociación tabs/paneles resuelta: IDs estables por pantalla, aria-controls y aria-labelledby apuntan al panel activo. Test observado en rojo sin asociación y verde con ella; harness exige la relación en las seis capturas. No cambia la geometría de las capturas ni el código de refresco.

Validación local final: 250/250 Vitest en 47 ficheros, 1222/1222 tests Node (mismo conjunto de CI excluyendo solo el smoke real que ejecuta su job dedicado), build y contrato en verde. Seis escenarios antes y seis después sin fallos. El recibo remoto se guardará al completar CI sobre el commit exacto de la PR. Los errores Auth sintéticos impresos durante tests no se interpretan como errores de producción.

## Aprobación y retoque de singular antes de publicar

El propietario aprueba #266 y autoriza publicación con comprobación real de cifras antes/después. countLabel común usa formas explícitas en español: reembolso/reembolsos, opción/opciones y servicio/servicios; Shopify corrige «1 reembolsos» y el importador de tarifas «1 servicios detectados». Amazon y contadores de transporte reutilizan el helper. Solo textos: no cambia cálculos. source-parity.json registra las dos excepciones de texto en componentes de periodo; servicios de analítica siguen intactos. Test de cinco casos observado fallando sin helper y pasando después. Suite completa local: 255/255. Rollback preparado antes de publicar: 0d34847a / dpl_Aso26hWc9uXcmmcC5ppWpcMJFFys / index-e22tGZwY.js. Referencias reales de cinco tarjetas de cada canal leídas de la sesión del propietario antes de publicar; resultado en recibo posterior.
