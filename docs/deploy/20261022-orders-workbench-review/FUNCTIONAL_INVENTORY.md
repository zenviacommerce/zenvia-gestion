# Inventario funcional antes/después

Revisión del 22/10/2026. Base: `21622348044745dd54978f69ac80f39321f39533`. Implementación en rama de revisión; no desplegada.

| Función anterior | Ubicación después | Protección/verificación |
|---|---|---|
| Pendientes, Etiquetados, Enviados y Cancelados | Pestañas superiores con contador de servidor | SQL real en PGlite con proyección activa/desactivada/pendiente; paginación y contadores independientes de página |
| Amazon/Shopify/Manual pendientes | Opciones del filtro Canal con contador | Canal inicial Todos; sin persistir un canal accidentalmente |
| Todos los pedidos | Añadir filtro → Ver todos los pedidos | Acceso secundario conservado; tabla, selección y acciones existentes |
| Incidencias de seguimiento | Pestaña Incidencias | Exception o movimiento real antiguo; terminales excluidos; fecha civil Madrid; no usar fecha de consulta/creación de etiqueta |
| Total vendido, IVA estimado, Neto sin IVA, Ticket medio | Resumen → Ventas y costes de pedidos | Un único juego de métricas; mismo periodo de Resumen; EUR; país fiscal conservado tras purga; preferencias antiguas reciben las cuatro opciones nuevas sin restaurar tarjetas antiguas ocultas |
| Coste transportistas y desglose | Misma sección de Resumen | Agregados completos más candidatos de tarifa fuera de página; costes sin valorar visibles; no presentar errores como cero |
| Métricas fiscales de facturas | Resumen, sección fiscal existente | Separadas de importes de pedidos; no se sustituyen ni se suman dos veces |
| Tarifas de transporte | Más acciones en cabecera, móvil y escritorio | Botón React nativo abre el panel existente; inyector antiguo no lo duplica ni elimina |
| Impresión directa y formato AUTO/A6/10×15/A5/A4 | Más acciones en cabecera, móvil y escritorio | Cliente de impresión opcional; descarga PDF y preferencias conservadas |
| Nuevo pedido y Actualizar pedidos | Cabecera siempre visible | Modal y sincronización existentes; pruebas abren/cancelan sin escribir |
| Facturación manual de Shopify | Más acciones en cabecera, móvil y escritorio | Selección y relectura existentes; sin facturar documentos reales en capturas |
| Generar etiquetas seleccionadas/pendientes | Pendientes | Comprobación de elegibilidad, purga PII, relectura y confirmación de selección oculta conservadas |
| Cotización y comparación por proveedor | Flujo de preparación existente | Aislamiento de respuestas, reintentos, reglas, pesos y validación existentes |
| Exportación ZIP, nombres de etiqueta y errores parciales | Flujo de generación existente | Prueba con PDF/ZIP sintético; ninguna compra real |
| Generar informe de recogida | Etiquetados; también Enviados y vista secundaria Todos | Selección de IDs, previsualización, bultos, duplicados e idempotencia existentes |
| Historial y reimpresión de informes | Pestaña Informes; historial de cada pedido sigue como modal | Mismo servicio y PDF guardado; abrir/reimprimir sin crear un nuevo informe |
| Buscador, canal, destino, transportista, informe y seguimiento | Buscador + Añadir filtro + chips | Filtros contextuales, chips quitables y restablecimiento; filas del servidor sin segundo filtrado divergente |
| Periodo | Solo Enviados y Cancelados | Las demás vistas son colas sin periodo; pruebas con pedidos fuera del mes actual |
| Selección entre páginas, filtros y pestañas | Barra de selección y Ver selección | Límite de 2.000, selección indeterminada, confirmación de ocultos, revisión por IDs y cancelación de respuestas obsoletas |
| Orden de tres estados, columnas y columna fija | Misma tabla y tarjetas móviles | Cabeceras compartidas; orden global del servidor; inventario de columnas antes/después |
| Detalle, edición, preparar, descargar, imprimir, factura y confirmación Shopify | Detalle de pedido existente | Historial de seguimiento, datos, validaciones y controles de privacidad conservados |
| Imágenes/productos, precio de envío, bultos y fechas | Misma tabla/tarjetas/detalle | Capturas con fixtures completos; nulidad de fecha no elimina filas devueltas por servidor |
| Refresco visible ≥60 s y Realtime desconectado al ocultar | Servicio existente sin nuevo sondeo | Pruebas de refresco/visibilidad existentes; sin cron ni suscripción adicional |
| Aislamiento de cuenta, permisos y MFA | RPC aditiva y límites existentes | Wrapper autorizado propio; sin sustituir el RPC anterior; prueba de denegación de MFA/permiso/otro tenant |

## Navegación y revisión visual

Cada pestaña dispone de `?page=orders&tab=…`, historial de navegador y última pestaña en caché de vista separada por usuario y workspace. Se conserva la página montada al navegar por la aplicación y se sincroniza la entrada aceptada; acceder desde Pendientes de Resumen limpia los filtros de esa entrada. Los permisos y el bloqueo de cambios sin guardar de Configuración siguen aplicándose.

La galería aporta 42 capturas completas antes/después a 390, 1280 y 1440 px, más vistas de primer pantallazo. Las pruebas de interacción son de solo lectura con fixtures y red bloqueada; no certifican conexiones físicas de impresión ni sustituyen una comprobación autenticada tras un futuro despliegue.

## Despliegue pendiente y reversión

1. Revisar y aprobar UI/SQL antes de publicar. La migración nueva `20261022114001_orders_workbench.sql` es aditiva: crea funciones y registra su wrapper; no contiene DELETE, UPDATE de datos de negocio ni DROP.
2. Tras aprobación, instalar primero la RPC aditiva. No sustituye `orders_dashboard_pickup_v1`, sus permisos ni los interruptores de proyección existentes. Validar en producción permisos, igualdad de filas existentes y contadores antes del frontend.
3. Publicar el frontend aprobado y comprobar las seis pestañas, Resumen, selección y acciones de cabecera.
4. Reversión: restaurar el despliegue anterior del frontend. El RPC previo sigue intacto; la RPC nueva puede quedar sin uso sin borrar nada. No cambiar interruptores, cron ni datos de pedidos para revertir la interfaz.

Registrar envío externo queda pendiente después de este rediseño: diseño aprobado con transportista/tracking obligatorios, cuenta o integración seleccionable, auditoría de quién lo registra y protección contra sobrescritura. No se implementa en esta rama.

## Ajustes de revisión autorizados

En Incidencias y Enviados las columnas Pedido, Cliente, Transportista y Seguimiento aparecen primero; el resto permanece accesible. Seguimiento añade el texto visible del transportista, antigüedad del movimiento y una acción externa, sin abrir simultáneamente el detalle. En móvil el acceso externo queda fuera del botón de detalle. Cuando falta URL, se resuelve a demanda mediante el servicio existente, respetando la purga PII. Prueba React de columnas, motivo y acceso a demanda, más comprobación geométrica en el harness.
