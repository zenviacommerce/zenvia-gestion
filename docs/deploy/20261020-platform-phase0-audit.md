# Platform · Fase 0: auditoría y propuesta (sin implementación)

Fecha: 20 de octubre de 2026. Estado: **DETENER para revisión**. Gestión cerrada; Platform permanece sin cambios de código, esquema, funciones, configuración ni publicación.

## Resultado y prioridad

La interfaz actual funciona con 2 clientes, 4 planes, 1 usuario interno, 56 entradas de auditoría y 0 tickets / 0 facturas centrales. No demuestra capacidad para 500 clientes y 5.000 tickets.

Se rompería primero la lectura global por instancias: el Resumen consulta simultáneamente todas las instancias operativas cada minuto; Tickets las consulta en tandas de tres y reúne el resultado completo antes de devolverlo. Una página de 25 filas no limita ese trabajo. Antes de optimizar filas o CSS hay que separar las lecturas de la consola de las consultas síncronas a cada cliente.

Hay además un problema actual de exactitud: Clientes muestra usos 0 / ∞ porque el backend devuelve explícitamente cero. En el detalle real de ZENVIA hay 5 usuarios. No se corrige en esta fase. La corrección de cifras debe ir en una PR de datos separada de la migración visual, con nueva fuente y comparación documentadas.

## Referencias y alcance

- Producción: admin.zenviacommerce.com; deployment `dpl_8K29gsU9v1XSDFgHCw5FYyEhF7pc`, commit `c9a10ea3831ac05247af3349be819269be6bee85`, bundle `index-C8G9Ghgi.js`.
- Repo: zenviacommerce/zenvia-platform. Se consultó el árbol del commit desplegado mediante GitHub; el clon por HTTPS no tenía credenciales, por lo que no se utilizó como fuente.
- Supabase de Platform: `ucokhtztxozxcikrmidv`. Edge desplegada platform-admin v36, coincidente con el repo leído. Bridge del clúster Gestión v31, coincidente salvo salto de línea final con el snapshot local revisado. Provisioner desplegado v29.
- Contrato: [docs/design-system.md](../design-system.md), con decisiones aprobadas en Gestión. [Cierre de Gestión, producción y rollback](20261020-design-system-gestion-closed.md).
- Navegación autenticada real, tema claro, fechas es-ES de la aplicación. 17 escenarios × 390/1280/1440 px = **51 capturas**. Alto del viewport: 1000 px. Las imágenes de página completa pueden excluir la barra nativa de scroll de 15 px: por ejemplo, viewport390 / contenido375; se registra la anchura CSS real en evidence.json.
- No se crearon clientes, usuarios, tickets, facturas ni datos de carga. Los editores se abrieron para inventariar y se cerraron sin guardar. La navegación conserva los efectos normales existentes de la aplicación, como actualizar last_login_at en bootstrap; no se invocaron escrituras de negocio ni cambios de Auth/MFA.

[Galería y medidas completas](platform-phase0-20261020/README.md) · [Evidencia](platform-phase0-20261020/evidence.json) · [EXPLAIN e índices](platform-phase0-20261020/explain.json) · [Activos públicos](platform-phase0-20261020/public-assets.json).

## Inventario y diseño frente al contrato

| Pantalla / ámbito | Estado observado | Alineación propuesta |
|---|---|---|
| Resumen | PageHead local y statsGrid/statCard propios. En1280 hay4+1 KPI; en1440 hay5. Móvil ya tiene2 columnas, último impar a media fila. Por responder usa aviso dorado con animación y variante oscura. | PageHeader y KpiGrid/StatCard compartidos; equilibrar columnas, impar final a2 columnas en móvil. Conservar navegación de cada KPI, aviso, modo oscuro y reducción de movimiento. |
| Clientes / Workspaces | Dos acciones de cabecera apiladas en móvil; búsqueda local; sin filtros estado/plan/infraestructura; lista de tarjetas móviles y orden persistido. Usos siempre0. | Acciones en una fila/overflow o Más; FilterBar con búsqueda separada; filtros iguales de una línea; métricas reales y paginación/búsqueda/orden en servidor. |
| Detalle / Resumen | Modal ancho con Empresa y checklist de onboarding. Carga usuarios, integraciones y suscripción aunque solo se vea Empresa. | Modal/Section comunes, cabecera compacta y resumen ligero; cargar cada pestaña al activarla. |
| Detalle / Branding | Logo completo con contain; máximo150 px y contenedor propio. | ImagePreview común, conservar imagen completa y acciones cambiar/eliminar. No se ha probado una imagen nueva ni subido archivos. |
| Detalle / Usuarios | Lista de5 usuarios con todos sus permisos cargados dentro del detalle. | DataTable/MobileList y consulta paginada del workspace. Mantener acciones y último acceso. |
| Detalle / Plan | Plan, uso y prueba gratuita en un bloque propio; capacidades y contadores. | Section y tabs comunes. Conservar aplicar prueba/cambiar plan, estados y condiciones de acceso. |
| Detalle / Integraciones | Ocho cuentas visibles; tabla especializada y paginación local. | Lista común por workspace, sin pedir credenciales ni cargarla al abrir Empresa. Mantener traducciones, cuentas y último OK. |
| Detalle / Infraestructura | Estado de instancia más llamada a status que trae todas las instancias. | Usar el endpoint instance ya existente, acotado a ese workspace, en lugar de status global. Configuración global separada del detalle, con permisos intactos. |
| Detalle / Demo | Pestaña adicional solo para DEMO; botón restaurar datos. | Preservar visibilidad condicional y confirmación destructiva. Solo se inventarió; no se pulsó restaurar. |
| Planes / editor | Cuatro tarjetas, capacidades y editor propio; usa todo el catálogo y todas las suscripciones para contar por plan. | Card/Section/modal compartidos; catálogo cacheado por versión; contadores agregados en servidor. Conservar precios, capacidades y acciones. |
| Facturación | Cinco KPI, PayPal y configuración fiscal antes de las listas. Primera suscripción:1948 px móvil,1212 px en1280,1089 px en1440. | Priorizar listas operativas; configuración en tabs/sección secundaria. KPI equilibrados. Suscripciones y facturas paginadas y filtradas en servidor. |
| Soporte / Tickets | Bandeja vacía real; filtros estado/tipo/turno en la fila de búsqueda y de anchos desiguales, sin prioridad/cliente/asignado. Búsqueda y contador locales. | FilterBar común con todos los filtros acordados y búsqueda en servidor; contadores independientes de la página. |
| Usuarios internos | Una fila, orden local, sin búsqueda/paginación en servidor. Dos acciones móviles apiladas. | Cabecera y tabla comunes, filtros/búsqueda/paginación según volumen; conservar permisos por rol y overrides. |
| Auditoría |56 entradas descargadas;25mostradas por página local. Límite backend500. | Cursor de servidor, búsqueda y filtros fecha/actor/acción; conteo real separado. |
| Configuración | **No existe ruta global**: Section solo incluye dashboard/clients/plans/billing/tickets/users/audit. Fiscal en Facturación; infraestructura en detalle; capacidades en editor de plan. | Proponer un área común o tabs coherentes que agrupe los ajustes existentes, sin inventar nuevos ajustes ni relajar permisos. Capturados los tres ámbitos existentes. |

No se observó scroll horizontal del documento ni texto de filtros a dos líneas en los51 escenarios. Eso no acredita todas las cadenas largas, todas las divisas, temas o estados posibles: las tarjetas multimoneda y textos extremos deberán probarse con fixtures sin cambiar cifras reales.

Tabs del detalle: el contenedor declara tablist, pero sus botones no tienen role=tab, aria-selected ni navegación de flechas común. El botón de cerrar modal no tiene nombre accesible. Corregir al adoptar componentes comunes.

Las acciones móviles se apilan por reglas explícitas de responsive-hardening.css; no es una excepción necesaria del producto. PageHead es otra implementación local. Los avisos, badges, iconos y estados son parte del inventario de migración, no decoración descartable.

## Carga y peticiones al abrir

Los tiempos UI son una observación de clic/recarga a contenido visible mediante automatización: incluyen su sobrecoste y no son p95 ni tiempo puro de red. Los tamaños son **Content-Length registrado por el servidor**, no tamaño JSON descomprimido ni suma de todos los bytes de red. Las duraciones Edge son execution_time_ms.

| Vista | Llamadas de datos según código desplegado | Observado en logs de la ventana | Tamaño y ejecución Edge | Clic → contenido |
|---|---|---|---|---:|
| Resumen |1bootstrap; se repite cada60s mientras visible | Bootstrap periódico identificado; falta el POST de la recarga medida |414B;1515–2932 ms en muestras periódicas |2595 ms recarga |
| Clientes |2POST paralelos: list_workspaces y list_plans |2POST y2OPTIONS |698B/692 ms +3300B/622 ms |2016 ms |
| Detalle de cliente |1workspace_detail |1POST y1OPTIONS |3313B/1866 ms |3132 ms |
| Branding/Usuarios/Plan/Integraciones/Demo del detalle |0POST adicionales: vienen en el detalle |Sin nuevo endpoint requerido por el cambio de esas tabs; sigue bootstrap global |Datos ya descargados |No se presenta como carga de servidor |
| Infraestructura |1customer-provisioner/status al abrir tab |1POST posterior al encabezado |1656B/741 ms |1442 ms **solo hasta encabezado**, no hasta completar status |
| Planes |1list_plans |1POST y1OPTIONS |3300B/574 ms |1883 ms |
| Editor de plan / fiscal / infraestructura |0POST adicionales al abrir editor con datos presentes |No se pulsó guardar |Estado local |No se atribuye un coste de servidor nuevo |
| Facturación |1billing_overview |1POST |1564B/890 ms |2322 ms |
| Tickets |1list_tickets, más repeticiones cada60s visible |1POST |44B/1208 ms, lista vacía |2513 ms |
| Usuarios |1list_users |El POST no está en el extracto pese a fila cargada |No disponible; no se inventa |1170 ms |
| Auditoría |1list_platform_audit |1POST |5961B/495 ms |1976 ms |

Ventana de logs:21:31:30–21:44:10UTC. Una lectura final acotada confirmó huecos: no es un HAR completo. **Ausencia en logs no significa cero peticiones.** Los conteos del código y los observados se mantienen separados. No se atribuyen a la UI los POST periódicos de53B a provisioner que no coinciden con una acción observada.

La superficie de navegador no expone Resource Timing ni HAR; no se extrajeron sesiones/tokens ni se instrumentó fetch de producción. Antes de dar objetivos p95 se necesita instrumentación consentida de action/request_id, bytes, duración, consultas y fan-out, o un HAR sanitizado. Este límite de medición queda abierto, no se sustituye por cifras estimadas.

Activos públicos, petición independiente desde el entorno de auditoría: HTML6710B/~4820 ms; JS155213B gzip/~4283 ms; CSS16852B gzip/~4558 ms. No son tiempos del navegador del propietario ni demuestran lentitud del origen; incluyen ruta de red/entorno. Las tres peticiones son un mínimo conocido del arranque, no inventario completo de recursos.

## Datos, caché, refresco y trabajo innecesario

- Clients.refresh descarga todos los workspaces y vuelve a pedir todo el catálogo de planes. Filtro y orden son locales. Cambiar de pantalla desmonta estado de consulta; no hay caché de resultados persistente entre pantallas.
- api.ts solo deduplica peticiones **en vuelo**. pendingReads se elimina al terminar y se vacía al mutar. No proporciona caché compartida con invalidación por entidad.
- PaginatedList construye todos los children, filtra filas y corta25 en el cliente. El número de nodos DOM visible no prueba paginación de servidor. La firma de claves puede reiniciar página al cambiar resultados. No hay selección masiva persistente común.
- bootstrap obtiene tres contadores locales con COUNT en servidor y suma contadores recibidos por bridge. **No son KPI calculados en el navegador**, pero sí una agregación síncrona de todas las instancias. Además escribe last_login_at en cada ciclo.
- list_plans y billing_overview cuentan/suman arrays en Edge. Los KPI de facturación están en Edge, no en cliente; aun así descargan colecciones completas desde DB. El histórico de facturas se corta a200.
- list_workspaces devuelve users.value, amazonAccounts.value y monthlyOrders.value=0, no agregados reales.
- workspace_detail hace consultas de empresa, branding, todos los usuarios e integraciones, suscripción y snapshot, firma un logo y llama a Auth listUsers(page 1,perPage 1000) de toda la instancia. Es coste innecesario para abrir Empresa y un límite funcional cuando la instancia compartida supera1000 usuarios.
- Hay búsquedas lineales por fila en los accesores de orden (planes.find y subscriptions.find). Deben resolverse con mapas o joins del servidor; no añadir cálculos de negocio caros a los renderizados.
- Tickets y Resumen se respaldan cada60s y al volver visible; no hay flujo de eventos/invalidation equivalente al patrón15–30s de Gestión. Clientes/Planes/Facturación/Usuarios/Auditoría dependen de montaje/refresco manual o guardado propio. El refresco silencioso conserva filas existentes, pero falta un contrato común de datos obsoletos/errores.
- list_tickets devuelve warnings de instancias fallidas, pero el tipo/consumidor frontal solo usa tickets. bootstrap omite resultados rechazados sin indicar incompletitud. Puede mostrar totales parciales como completos ante un fallo; no se provocó un fallo en producción.

## EXPLAIN y RPC

Se ejecutaron seis SELECT con EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON), sin DDL ni llamadas de escritura. Se conservaron planes e índices en explain.json.

| Consulta equivalente a la desplegada | Filas reales | Ejecución DB | Plan observado |
|---|---:|---:|---|
| Clientes por created_at, sin LIMIT |2|0,122 ms|Seq Scan + Sort |
| Auditoría por created_at DESC LIMIT 500 |56|0,187 ms|Seq Scan + Sort + Limit |
| Facturas por issue_date DESC LIMIT 200 |0|0,100 ms|Seq Scan + Sort + Limit |
| Usuarios por created_at, sin LIMIT |1|5,090 ms|Seq Scan + Sort |
| Tickets por owner y actividad LIMIT 500 |0|0,207 ms|Seq Scan + Sort + Limit (tabla vacía) |
| Contadores abiertos/por responder de owner |1fila agregada,0 tickets|0,110 ms|Aggregate |

Planes tomados con privilegios de lectura administrativa, equivalentes al acceso de datos del servicio para estas tablas; no miden validación Auth, latencia HTTP, Vault ni bridge. Con tan pocas filas, un Seq Scan es normal y no justifica añadir índices a ciegas.

Ya existen índices de tickets(owner_id,last_activity_at DESC), (owner_id,status,last_activity_at DESC), creador/actividad y turno/estado/actividad; de auditoría por created_at y actor/created_at; de facturas por workspace/fecha y status/fecha; de clientes por provisionamiento/estado. El coste de cientos de llamadas no se arregla añadiendo otro índice a una consulta de0,2 ms.

Las rutas de lista actuales son acciones Edge con SELECT, no RPC de paginación/contadores. Los RPC de planes son de escritura y los de resolución de secretos no se ejecutaron para probar rendimiento. No se presentan planes ficticios de RPC inexistentes. Las futuras RPC de lectura agregada/paginada deben medirse en staging con500/5000 filas representativas antes de aprobar índices.

## Proyección:500 clientes y5000 tickets

**Proyección de código, no prueba de carga realizada.**

1. **Resumen primero:** Promise.allSettled sobre500 instancias abre hasta500bridges simultáneos por ciclo/operador, más resolución de instancia/credencial. Cada bridge de bootstrap hace5 lecturas/counts. Con Tickets abierto se añade otro barrido completo por minuto. Son hasta1000invocaciones remotas/minuto/operador;10 operadores,10000. Compartir clúster no elimina el fan-out actual por workspace. Se arriesgan pool/concurrencia y contadores incompletos antes de que el render de5 KPI sea el problema.
2. **Tickets después:**500 clientes con concurrencia3 requieren167 tandas. A100 ms por tanda serían16,7s; a500 ms,83,5s; son ejemplos aritméticos, no latencias medidas. El límite por bridge es8s por defecto; clientes lentos/fallidos multiplican esperas y generan resultados parciales. Incluso con solo10 tickets por cliente, se consultan500 instancias para mostrar25 filas.
3. **Pérdida de historial:** más de500 tickets en un cliente ya se truncan. La búsqueda local no puede encontrar lo que nunca se descargó. Auditoría500 y facturas200 tienen el mismo problema. Con5000 tickets distribuidos, el backend reúne miles de filas y el navegador filtra/ordena/construye elementos antes de cortar25.
4. **Detalle y usos:** sobre1000 usuarios compartidos, Auth page 1 no cubre todos para el fallback de último acceso. Abrir Empresa trae datos de otras tabs; Infraestructura trae todas las instancias y hasta200 eventos globales; ya existe action=instance con filtro por workspace y50 eventos que el frontend no usa. Los usos cero son incorrectos hoy, sin esperar a500 clientes.
5. **UX:** Facturación ya incumple el objetivo de lista<1800 px en móvil y no la muestra en el primer viewport de escritorio probado. Las acciones apiladas y KPI huérfanos empeoran con nuevas acciones/monedas.

## Propuesta de datos y escala

**Lote A · contrato de lecturas y exactitud.** Índice central de soporte y métricas de workspace, alimentados por eventos servidor-servidor idempotentes y conciliación incremental con solapamiento/cursor por instancia que no avance al fallar. Cada registro conserva workspace_id y permisos de consola; ningún secreto de bridge llega al cliente. Para instancias compartidas, agrupar trabajo por proyecto en el reconciliador. Para dedicadas, concurrencia acotada fuera del camino de la pantalla. Totales indican vigencia, cobertura e instancias pendientes, sin convertir fallos en cero.

**Lote B · listas de servidor.** Clientes y tickets:25por página, búsqueda/filtros/orden en servidor, desempate estable por id y cursor compuesto para actividad/fecha. Tickets:estado,prioridad,cliente,asignado,tipo y turno; contadores agregados con los mismos filtros sobre el conjunto completo. Auditoría y facturas con cursor real, no LIMITfijo como histórico total. Extender índices solo tras EXPLAIN con datos representativos; reutilizar los existentes cuando sirvan.

**Lote C · detalle y caché.** Resumen de cliente ligero; endpoints por pestaña/workspace; datos de acceso desde perfiles del propio workspace y Auth consultado solo para usuarios necesarios. Catálogo por versión. Caché compartida por clave/tenant/filtros; invalidación al crear/editar clientes,tickets,planes y perfiles; eventos más consulta visible de15–30s. Mantener filas, búsqueda, selección y scroll, sin recarga completa ni resultados antiguos sobrescribiendo filtros nuevos.

## Compartir el sistema de diseño sin duplicación

Recomendación: **paquete privado versionado @zenvia/ui**, consumido por ambos repositorios con versión exacta y lockfile. Mantiene despliegues y rollback independientes. Extraer primero desde los componentes aprobados de Gestión, no reescribir una versión parecida en Platform.

Contenido: tokens/CSS con nombres de ámbito, PageHeader, KpiGrid, StatCard, PageTabs, FilterBar, Section, EmptyState, ImagePreview, controles y contratos visuales/a11y; después DataTable/MobileList, paginación y selección con adaptadores de servidor. El aviso Por responder debe mapearse a la variante semántica conservando sus reglas, y las acciones de cada pantalla deben tener inventario probado.

Fuera del paquete: Auth, clientes Supabase, tenant routing, permisos, consultas de negocio, bridge, cron, credenciales, datos y conexiones Realtime. Esos adaptadores pertenecen a cada aplicación. Compartir UI no mezcla sesiones ni amplía cohort MFA.

Alternativa:monorepo con packages/ui y aplicaciones separadas. Reduce publicación del paquete, pero requiere mover repositorios y revisar root/build/preview de Vercel; mayor cambio de entrega para esta etapa. Una carpeta común copiada entre repositorios, submódulo o duplicación manual no garantiza sincronía; no se recomienda. Si ya se decide un monorepo futuro, la misma API del paquete permite migrar sin rediseñar componentes.

Antes de extraer: inventariar imports/CSS dependientes de Gestión y eliminar suposiciones sobre contenedores globales, probar tema claro/oscuro y movimiento reducido. Publicar una versión inicial sin cambio visual en Gestión, con las galerías y pruebas actuales como contrato; después consumirla en Platform por lotes. No actualizar automáticamente ambas apps con una versión sin revisión.

## Lotes propuestos y criterios de aceptación

| Orden | Alcance | Evidencia necesaria antes de publicar |
|---|---|---|
| A | Lecturas agregadas, índice de soporte y métricas reales | Exactitud/paridad; fallo parcial visible; idempotencia; EXPLAIN y carga en staging500 clientes/5000 tickets; rollback de cada cambio de datos |
| B | Paquete UI + Resumen/Clientes y detalle | Antes/después390/1280/1440; mismas acciones, variantes y cifras;25 filas de servidor, búsqueda y selección persistentes |
| C | Tickets + Usuarios/Auditoría | Filtros completos, counters del conjunto, búsqueda en servidor; eventos/respaldo visible; pruebas de permisos y de no truncar historial |
| D | Planes/Facturación/Configuración | Misma fiscalidad/PayPal/acciones; lista antes de configuración, KPI equilibrados/multimoneda y previews completos |
| E | Cierre | Inventario entero, cero variantes nuevas fuera del paquete, tests de acciones/semántica/filtros y verificación autenticada |

Objetivos propuestos, pendientes de aprobación: ninguna consulta de pantalla con fan-out proporcional a clientes;25 filas por respuesta; conteos independientes de página; límite visual móvil de1800 px hasta primera fila/estado de lista, preferible primer viewport operativo; acciones en una fila/overflow;2 columnas móviles y último impar a2; filtros sin2líneas; ningún overflow multimoneda.

Para carga: instrumentar y pactar p95 antes de prometerlo. Referencia de aceptación a ensayar: RPC SQL de listas<100 ms en staging representativo y clic a lista<2s en una ruta de red definida, con10 operadores simulados **fuera de producción**. Son objetivos, no resultados alcanzados.

## Parada

No se aplica esta propuesta ni se publica nada en Platform. Su deployment y commit deben seguir siendo los iniciales al entregar. Falta aprobación de alcance/orden de los lotes, no más cambios de Gestión. El cierre/ampliación global de MFA continúa después de Gestión/Platform según el propietario; este informe no lo autoriza ni cambia su vigilancia.


## Fuentes de código reproducibles

[App y pantallas](https://github.com/zenviacommerce/zenvia-platform/blob/c9a10ea3831ac05247af3349be819269be6bee85/src/App.tsx) · [API/caché](https://github.com/zenviacommerce/zenvia-platform/blob/c9a10ea3831ac05247af3349be819269be6bee85/src/api.ts) · [Paginación local](https://github.com/zenviacommerce/zenvia-platform/blob/c9a10ea3831ac05247af3349be819269be6bee85/src/components/PaginatedList.tsx) · [Edge de administración](https://github.com/zenviacommerce/zenvia-platform/blob/c9a10ea3831ac05247af3349be819269be6bee85/supabase/functions/platform-admin/index.ts). Las versiones desplegadas v36/v31/v29 se verificaron mediante lectura de Supabase; no se cambiaron. [SQL reproducible](platform-phase0-20261020/queries.sql).
